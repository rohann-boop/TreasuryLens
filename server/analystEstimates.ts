// Analyst-estimates service. Fetches forward-looking consensus figures from
// Finnhub — revenue estimates, EPS estimates, and the Wall-Street price target
// — and reduces them to a typed AnalystEstimates the scenario model can use as
// a *separate source input* (distinct from the recommendation-trend consensus
// in analystConsensus.ts).
//
// Credential plumbing is shared via finnhubClient.ts. Behaviour is graceful by
// design: a missing credential, an uncovered ticker, a premium-only endpoint on
// the free tier, a quota error, or a provider failure each map to an explicit
// status + message rather than a fabricated estimate. Results are cached
// in-memory (6h TTL; shorter for unavailable/error) to stay under free-tier
// limits. No secret is ever logged.
//
// Endpoint feasibility note: Finnhub's /stock/revenue-estimate,
// /stock/eps-estimate and /stock/price-target are premium on some plans. We
// attempt them and treat a 402/403 as "unavailable on this tier" — the app
// continues to work exactly as before when they are not entitled.

import type { AnalystEstimates, AnalystEstimatesStatus } from "@shared/schema";
import { getFinnhubJson, hasFinnhubCredential } from "./finnhubClient";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — estimates update slowly
const NEG_CACHE_TTL_MS = 30 * 60 * 1000; // 30m for unavailable/error

const cache = new Map<string, { at: number; data: AnalystEstimates }>();

function emptyEstimates(symbol: string): AnalystEstimates {
  return {
    status: "unavailable",
    symbol,
    source: "finnhub",
    asOf: Date.now(),
    revenueEstimate: null,
    revenueEstimateYear: null,
    revenuePeriod: null,
    revenueAnalystCount: null,
    impliedRevenueCagrPct: null,
    epsEstimate: null,
    epsEstimateYear: null,
    epsPeriod: null,
    epsAnalystCount: null,
    priceTarget: null,
    priceTargetHigh: null,
    priceTargetLow: null,
    priceTargetAnalystCount: null,
    priceTargetAsOf: null,
    message: "Analyst estimates unavailable.",
  };
}

function unavailable(symbol: string, message: string): AnalystEstimates {
  return { ...emptyEstimates(symbol), status: "unavailable", message };
}

function errored(symbol: string, message: string): AnalystEstimates {
  return { ...emptyEstimates(symbol), status: "error", message };
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function yearFromPeriod(period: unknown): number | null {
  if (typeof period !== "string") return null;
  const m = period.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

// Finnhub estimate endpoints return { data: [{ period, revenueAvg / epsAvg,
// numberAnalysts, ... }], freq, symbol }. Revenue figures are reported in
// *millions of USD*. We pick the nearest forward annual estimate (period in the
// future, smallest year ≥ current year), falling back to the latest row.
interface EstimateRow {
  period?: string;
  revenueAvg?: number;
  epsAvg?: number;
  numberAnalysts?: number;
}

function pickForwardRow(rows: EstimateRow[]): EstimateRow | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const currentYear = new Date().getUTCFullYear();
  const withYear = rows
    .map((r) => ({ r, year: yearFromPeriod(r.period) }))
    .filter((x) => x.year != null) as { r: EstimateRow; year: number }[];
  if (withYear.length === 0) return rows[0] ?? null;
  // Prefer the nearest year that is >= current year; else the latest available.
  const forward = withYear
    .filter((x) => x.year >= currentYear)
    .sort((a, b) => a.year - b.year);
  if (forward.length > 0) return forward[0].r;
  return withYear.sort((a, b) => b.year - a.year)[0].r;
}

async function fetchRevenueEstimate(
  symbol: string,
  out: AnalystEstimates,
): Promise<"ok" | "premium" | "unavailable" | "error"> {
  const res = await getFinnhubJson(
    `/stock/revenue-estimate?symbol=${encodeURIComponent(symbol)}&freq=annual`,
  );
  if (res.kind === "premium") return "premium";
  if (res.kind === "ok") {
    const data = (res.json as { data?: EstimateRow[] })?.data ?? [];
    const row = pickForwardRow(data);
    if (row) {
      // revenueAvg is in millions of USD on Finnhub.
      const revM = numOrNull(row.revenueAvg);
      out.revenueEstimate = revM != null ? revM * 1e6 : null;
      out.revenuePeriod = typeof row.period === "string" ? row.period : null;
      out.revenueEstimateYear = yearFromPeriod(row.period);
      out.revenueAnalystCount = numOrNull(row.numberAnalysts);
      return out.revenueEstimate != null ? "ok" : "unavailable";
    }
    return "unavailable";
  }
  return res.kind === "error" || res.kind === "non-json" ? "error" : "unavailable";
}

async function fetchEpsEstimate(
  symbol: string,
  out: AnalystEstimates,
): Promise<"ok" | "premium" | "unavailable" | "error"> {
  const res = await getFinnhubJson(
    `/stock/eps-estimate?symbol=${encodeURIComponent(symbol)}&freq=annual`,
  );
  if (res.kind === "premium") return "premium";
  if (res.kind === "ok") {
    const data = (res.json as { data?: EstimateRow[] })?.data ?? [];
    const row = pickForwardRow(data);
    if (row) {
      out.epsEstimate = numOrNull(row.epsAvg);
      out.epsPeriod = typeof row.period === "string" ? row.period : null;
      out.epsEstimateYear = yearFromPeriod(row.period);
      out.epsAnalystCount = numOrNull(row.numberAnalysts);
      return out.epsEstimate != null ? "ok" : "unavailable";
    }
    return "unavailable";
  }
  return res.kind === "error" || res.kind === "non-json" ? "error" : "unavailable";
}

async function fetchPriceTarget(
  symbol: string,
  out: AnalystEstimates,
): Promise<"ok" | "premium" | "unavailable" | "error"> {
  const res = await getFinnhubJson(
    `/stock/price-target?symbol=${encodeURIComponent(symbol)}`,
  );
  if (res.kind === "premium") return "premium";
  if (res.kind === "ok") {
    const obj = res.json as {
      targetMean?: number;
      targetHigh?: number;
      targetLow?: number;
      numberAnalysts?: number;
      lastUpdated?: string;
    };
    out.priceTarget = numOrNull(obj?.targetMean);
    out.priceTargetHigh = numOrNull(obj?.targetHigh);
    out.priceTargetLow = numOrNull(obj?.targetLow);
    out.priceTargetAnalystCount = numOrNull(obj?.numberAnalysts);
    out.priceTargetAsOf =
      typeof obj?.lastUpdated === "string" ? obj.lastUpdated.slice(0, 10) : null;
    return out.priceTarget != null ? "ok" : "unavailable";
  }
  return res.kind === "error" || res.kind === "non-json" ? "error" : "unavailable";
}

export async function getAnalystEstimates(rawTicker: string): Promise<AnalystEstimates> {
  const symbol = rawTicker.trim().toUpperCase();
  if (!symbol) return unavailable(symbol, "No ticker provided.");

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  if (!(await hasFinnhubCredential())) {
    const data = unavailable(
      symbol,
      "Analyst estimates need a Finnhub credential. Provide the finnhub.io custom credential, or set FINNHUB_API_KEY.",
    );
    cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
    return data;
  }

  const out = emptyEstimates(symbol);

  // Fetch the three endpoints concurrently; each fails gracefully on its own.
  let rev: Awaited<ReturnType<typeof fetchRevenueEstimate>> = "unavailable";
  let eps: Awaited<ReturnType<typeof fetchEpsEstimate>> = "unavailable";
  let pt: Awaited<ReturnType<typeof fetchPriceTarget>> = "unavailable";
  try {
    [rev, eps, pt] = await Promise.all([
      fetchRevenueEstimate(symbol, out).catch(() => "error" as const),
      fetchEpsEstimate(symbol, out).catch(() => "error" as const),
      fetchPriceTarget(symbol, out).catch(() => "error" as const),
    ]);
  } catch {
    const data = errored(symbol, "Analyst estimate fetch failed.");
    cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
    return data;
  }

  const results = [rev, eps, pt];
  const anyOk = results.includes("ok");
  const allPremium = results.every((r) => r === "premium");
  const anyError = results.includes("error");

  let status: AnalystEstimatesStatus;
  let message: string;
  if (anyOk) {
    status = "available";
    const parts: string[] = [];
    if (rev === "ok" && out.revenueEstimate != null)
      parts.push(`revenue est. ${out.revenuePeriod ?? ""}`.trim());
    if (eps === "ok" && out.epsEstimate != null)
      parts.push(`EPS est. ${out.epsPeriod ?? ""}`.trim());
    if (pt === "ok" && out.priceTarget != null)
      parts.push(`price target ${out.priceTargetAnalystCount ?? 0} analysts`);
    message = `Analyst estimates from Finnhub: ${parts.join(", ")}.`;
  } else if (allPremium) {
    status = "unavailable";
    message =
      "Analyst estimates not entitled on the current Finnhub plan (revenue/EPS/price-target are premium endpoints).";
  } else if (anyError) {
    status = "error";
    message = "Analyst estimates could not be fetched (provider error or quota).";
  } else {
    status = "unavailable";
    message =
      "No analyst estimates from Finnhub for this ticker (common for ETFs, funds, non-US issuers, or thinly-covered names).";
  }

  out.status = status;
  out.message = message;
  out.asOf = Date.now();

  const ttlBackdate = status === "available" ? 0 : CACHE_TTL_MS - NEG_CACHE_TTL_MS;
  cache.set(symbol, { at: Date.now() - ttlBackdate, data: out });
  return out;
}
