// Finnhub analyst-consensus service. Fetches Wall-Street recommendation trends
// from Finnhub's free-tier `/stock/recommendation` endpoint and reduces them to
// a typed AnalystConsensus the UI can render directly.
//
// Credential: token is read from CUSTOM_CRED_FINNHUB_IO_TOKEN (secure custom
// credential injected at runtime) or FINNHUB_API_KEY. The base URL defaults to
// https://finnhub.io/api/v1 but honours CUSTOM_CRED_FINNHUB_IO_URL when it
// looks like a usable API base. Nothing is hardcoded or committed.
//
// Behaviour is graceful by design: a missing token, an uncovered ticker
// (ETFs / funds / ambiguous symbols return an empty array), or a provider error
// each map to an explicit status + message rather than a fabricated verdict.
// Results are cached in-memory (6h TTL) to stay well under free-tier limits.

import type {
  AnalystConsensus,
  AnalystConsensusLabel,
  AnalystRecommendationPeriod,
} from "@shared/schema";

const DEFAULT_BASE = "https://finnhub.io/api/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — recommendation trends update monthly
const NEG_CACHE_TTL_MS = 30 * 60 * 1000; // 30m for unavailable/error so we retry sooner
const FETCH_TIMEOUT_MS = 8000;
const MAX_HISTORY = 6;

const cache = new Map<string, { at: number; data: AnalystConsensus }>();

function getToken(): string {
  return (
    process.env.CUSTOM_CRED_FINNHUB_IO_TOKEN ||
    process.env.FINNHUB_API_KEY ||
    ""
  ).trim();
}

// Resolve the API base. CUSTOM_CRED_FINNHUB_IO_URL may be a bare host
// (https://finnhub.io) or a full API base (https://finnhub.io/api/v1). We
// normalise either to a `/api/v1` base so the endpoint path always resolves.
function getBaseUrl(): string {
  const raw = (process.env.CUSTOM_CRED_FINNHUB_IO_URL || "").trim();
  if (!raw) return DEFAULT_BASE;
  let cleaned = raw.replace(/\/+$/, "");
  if (/\/api\/v\d+$/i.test(cleaned)) return cleaned;
  // Bare host or unexpected path → append the known free-tier API base path.
  try {
    const u = new URL(cleaned);
    return `${u.protocol}//${u.host}/api/v1`;
  } catch {
    return DEFAULT_BASE;
  }
}

function labelForMean(mean: number | null): AnalystConsensusLabel | null {
  if (mean == null || !Number.isFinite(mean)) return null;
  // 1 = Strong Buy ... 5 = Strong Sell (lower is more bullish).
  if (mean <= 1.5) return "Strong Buy";
  if (mean <= 2.5) return "Buy";
  if (mean <= 3.5) return "Hold";
  if (mean <= 4.5) return "Sell";
  return "Strong Sell";
}

function reducePeriod(raw: {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}): AnalystRecommendationPeriod {
  const strongBuy = Number(raw.strongBuy) || 0;
  const buy = Number(raw.buy) || 0;
  const hold = Number(raw.hold) || 0;
  const sell = Number(raw.sell) || 0;
  const strongSell = Number(raw.strongSell) || 0;
  const total = strongBuy + buy + hold + sell + strongSell;
  // Weighted mean on a 1..5 scale (1 = Strong Buy).
  const meanScore =
    total > 0
      ? (strongBuy * 1 + buy * 2 + hold * 3 + sell * 4 + strongSell * 5) / total
      : null;
  return {
    period: raw.period,
    strongBuy,
    buy,
    hold,
    sell,
    strongSell,
    total,
    meanScore: meanScore != null ? Number(meanScore.toFixed(2)) : null,
    label: labelForMean(meanScore),
    bullishPercent:
      total > 0 ? Number((((strongBuy + buy) / total) * 100).toFixed(1)) : null,
    bearishPercent:
      total > 0 ? Number((((sell + strongSell) / total) * 100).toFixed(1)) : null,
  };
}

function unavailable(symbol: string, message: string): AnalystConsensus {
  return {
    status: "unavailable",
    symbol,
    source: "finnhub",
    asOf: Date.now(),
    lastUpdated: null,
    latestPeriod: null,
    totalAnalysts: null,
    strongBuy: null,
    buy: null,
    hold: null,
    sell: null,
    strongSell: null,
    consensusLabel: null,
    meanScore: null,
    bullishPercent: null,
    bearishPercent: null,
    trendDirection: null,
    history: [],
    message,
  };
}

function errored(symbol: string, message: string): AnalystConsensus {
  return { ...unavailable(symbol, message), status: "error" };
}

export async function getAnalystConsensus(
  rawTicker: string,
): Promise<AnalystConsensus> {
  const symbol = rawTicker.trim().toUpperCase();
  if (!symbol) return unavailable(symbol, "No ticker provided.");

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const token = getToken();
  if (!token) {
    const data = unavailable(
      symbol,
      "Analyst consensus needs a Finnhub API token. Set CUSTOM_CRED_FINNHUB_IO_TOKEN (or FINNHUB_API_KEY) — start the server with the finnhub.io credential to enable it.",
    );
    // Cache the no-token state briefly so we don't re-check on every request.
    cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
    return data;
  }

  const base = getBaseUrl();
  const url = `${base}/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;

  let json: unknown;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) {
      const data = errored(
        symbol,
        "Finnhub rejected the API token (401/403). Check the finnhub.io credential.",
      );
      cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
      return data;
    }
    if (res.status === 429) {
      const data = errored(
        symbol,
        "Finnhub rate limit reached — try again shortly.",
      );
      cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
      return data;
    }
    if (!res.ok) {
      const data = errored(symbol, `Finnhub error ${res.status}.`);
      cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
      return data;
    }
    json = await res.json();
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    const data = errored(
      symbol,
      aborted ? "Finnhub request timed out." : `Finnhub request failed: ${(e as Error).message}`,
    );
    cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
    return data;
  }

  if (!Array.isArray(json) || json.length === 0) {
    // Empty array = no analyst coverage (typical for ETFs / funds / uncovered
    // small caps / ambiguous tickers). This is an expected, graceful state.
    const data = unavailable(
      symbol,
      "No analyst coverage from Finnhub for this ticker (common for ETFs, funds, or thinly-covered names).",
    );
    cache.set(symbol, { at: Date.now(), data });
    return data;
  }

  // Periods come newest-first from Finnhub; sort defensively by period desc.
  const periods = (json as AnalystRecommendationPeriod[])
    .map((p) => reducePeriod(p as never))
    .filter((p) => p.total > 0)
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));

  if (periods.length === 0) {
    const data = unavailable(
      symbol,
      "Finnhub returned recommendation rows but no analyst counts for this ticker.",
    );
    cache.set(symbol, { at: Date.now(), data });
    return data;
  }

  const latest = periods[0];
  const prior = periods[1] ?? null;

  let trendDirection: AnalystConsensus["trendDirection"] = null;
  if (prior?.meanScore != null && latest.meanScore != null) {
    const delta = prior.meanScore - latest.meanScore; // positive = mean dropped = more bullish
    trendDirection =
      delta > 0.15 ? "improving" : delta < -0.15 ? "deteriorating" : "stable";
  }

  const data: AnalystConsensus = {
    status: "available",
    symbol,
    source: "finnhub",
    asOf: Date.now(),
    lastUpdated: latest.period,
    latestPeriod: latest.period,
    totalAnalysts: latest.total,
    strongBuy: latest.strongBuy,
    buy: latest.buy,
    hold: latest.hold,
    sell: latest.sell,
    strongSell: latest.strongSell,
    consensusLabel: latest.label,
    meanScore: latest.meanScore,
    bullishPercent: latest.bullishPercent,
    bearishPercent: latest.bearishPercent,
    trendDirection,
    history: periods.slice(0, MAX_HISTORY),
    message: `${latest.total} analyst${latest.total === 1 ? "" : "s"} · consensus ${latest.label ?? "—"} (as of ${latest.period}).`,
  };

  cache.set(symbol, { at: Date.now(), data });
  return data;
}
