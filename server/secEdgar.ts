// SEC EDGAR fundamentals provider. No API key required, but the SEC requires
// a descriptive User-Agent including a contact email per
// https://www.sec.gov/about/policies/edgar-data-policy.
//
// Public surface:
//   getEquityFundamentals(ticker) -> EquityFundamentals | null
//
// Strategy:
//   1. Resolve ticker -> CIK via a small built-in map for known tickers,
//      falling back to https://www.sec.gov/files/company_tickers.json.
//   2. Fetch companyfacts JSON for the CIK.
//   3. Establish an "anchor date" — the latest period-end across the
//      headline core facts (Assets / StockholdersEquity / Revenues). Anchor
//      is what "now" means for this filer; balance-sheet values must fall
//      within FRESHNESS_WINDOW_DAYS of the anchor or we reject them as
//      stale and surface the rejection in `staleFacts`. This prevents the
//      old failure mode where a deprecated tag's "latest" entry was years
//      out of date (e.g. Tesla's `LongTermDebtNoncurrent` last filed 2014).
//   4. Compute TTM where it makes sense (income statement + cash flow) by
//      summing the last four quarters whose end date sits inside the
//      freshness window. Balance-sheet items use the latest point-in-time
//      value within the window.
//   5. Cache responses in-memory with a long TTL — SEC filings update daily
//      at most.

import type {
  AnalystEstimates,
  EquityFundamentals,
  EquityRevenueResponse,
  FundamentalValue,
  RevenueBridge,
  RevenueBridgeYear,
  RevenuePoint,
} from "@shared/schema";
import { getAnalystEstimates } from "./analystEstimates";

const SEC_USER_AGENT = "TreasuryLens rohanr@me.com";
const HEADERS: Record<string, string> = {
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/json",
};

// 6 hours — companyfacts updates at most once per filing/day.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Ticker map cache lasts longer; the public list is updated infrequently.
const TICKER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Maximum age (days) a fact's period end may have versus the company anchor
// date before being treated as stale. Set to ~14 months so the most recent
// 10-K (annual) plus normal filing slack still passes when no fresher 10-Q
// is available, but a multi-year-old deprecated tag does not.
const FRESHNESS_WINDOW_DAYS = 420;

interface CompanyFactsResponse {
  cik: number;
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<string, ConceptFacts>;
    dei?: Record<string, ConceptFacts>;
  };
}

interface ConceptFacts {
  label?: string;
  description?: string;
  units?: Record<string, FactUnitEntry[]>;
}

interface FactUnitEntry {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

interface CompanyTickersJson {
  [k: string]: { cik_str: number; ticker: string; title: string };
}

const STATIC_TICKER_TO_CIK: Record<string, string> = {
  TSLA: "0001318605",
  AAPL: "0000320193",
  MSFT: "0000789019",
  GOOGL: "0001652044",
  AMZN: "0001018724",
  META: "0001326801",
  NVDA: "0001045810",
  BRK_B: "0001067983",
  // Common bitcoin treasury equities — included for completeness even when
  // the Buffett Index uses the bitcoin_treasury framework for them.
  MSTR: "0001050446",
};

let tickerMapCache: { at: number; map: Map<string, string> } | null = null;
const factsCache = new Map<
  string,
  { at: number; data: CompanyFactsResponse | null }
>();
const fundamentalsCache = new Map<
  string,
  { at: number; data: EquityFundamentals | null }
>();

function pad10(cik: string | number): string {
  const s = String(cik).replace(/^0+/, "");
  return s.padStart(10, "0");
}

async function fetchTickerMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (tickerMapCache && now - tickerMapCache.at < TICKER_CACHE_TTL_MS) {
    return tickerMapCache.map;
  }
  try {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: HEADERS,
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j = (await r.json()) as CompanyTickersJson;
    const map = new Map<string, string>();
    for (const k of Object.keys(j)) {
      const row = j[k];
      if (row?.ticker && row?.cik_str != null) {
        map.set(row.ticker.toUpperCase(), pad10(row.cik_str));
      }
    }
    tickerMapCache = { at: now, map };
    return map;
  } catch {
    return new Map();
  }
}

export async function resolveCik(ticker: string): Promise<string | null> {
  const t = ticker.toUpperCase();
  const stat = STATIC_TICKER_TO_CIK[t];
  if (stat) return stat;
  const map = await fetchTickerMap();
  return map.get(t) ?? null;
}

/**
 * Point-in-time common-stock shares outstanding for a U.S. issuer. Prefers
 * the dei `EntityCommonStockSharesOutstanding` cover-page fact (which is the
 * issuer's own recent count) and falls back to us-gaap CommonStockShares-
 * Outstanding. Returns absolute share count; null on miss or non-US issuer.
 *
 * Used by stock-picks to compute market cap when a quote provider is
 * unavailable (price × shares is acceptably accurate for a watchlist UI).
 */
export async function getSharesOutstanding(
  ticker: string,
): Promise<{ value: number; end: string; tag: string } | null> {
  const cik = await resolveCik(ticker);
  if (!cik) return null;
  const facts = await fetchCompanyFacts(cik);
  const root = facts?.facts;
  if (!root) return null;
  // Look back ~18 months for a reasonably-fresh figure. Multi-class issuers
  // (META, GOOGL) don't report dei.EntityCommonStockSharesOutstanding, so we
  // fall back to weighted-average share counts taken from a single quarterly
  // entry — same magnitude as the issuer-reported number for these names.
  const maxAgeMs = 540 * 86400000;
  const now = Date.now();
  const isFresh = (endIso: string) => {
    const t = Date.parse(`${endIso}T00:00:00Z`);
    return Number.isFinite(t) && now - t <= maxAgeMs;
  };
  const candidates: Array<{ scope: "dei" | "us-gaap"; tag: string }> = [
    { scope: "dei", tag: "EntityCommonStockSharesOutstanding" },
    { scope: "us-gaap", tag: "CommonStockSharesOutstanding" },
    { scope: "us-gaap", tag: "CommonStockSharesIssued" },
    // Last-resort fallbacks for multi-class filers without a single common
    // shares fact. Use the latest single-period entry (NOT a TTM sum).
    { scope: "us-gaap", tag: "WeightedAverageNumberOfDilutedSharesOutstanding" },
    { scope: "us-gaap", tag: "WeightedAverageNumberOfSharesOutstandingBasic" },
  ];
  for (const c of candidates) {
    const concept = c.scope === "dei" ? root.dei?.[c.tag] : root["us-gaap"]?.[c.tag];
    if (!concept || !concept.units) continue;
    const unitKey =
      Object.keys(concept.units).find((u) => u.toLowerCase() === "shares") ??
      Object.keys(concept.units)[0];
    const entries = concept.units[unitKey];
    if (!entries || !entries.length) continue;
    const sorted = [...entries]
      .filter((e) => Number.isFinite(e.val) && e.val > 0 && isFresh(e.end))
      .sort((a, b) => (a.end < b.end ? 1 : -1));
    const top = sorted[0];
    if (!top) continue;
    return { value: top.val, end: top.end, tag: c.tag };
  }
  return null;
}

async function fetchCompanyFacts(
  cik: string,
): Promise<CompanyFactsResponse | null> {
  const padded = pad10(cik);
  const cached = factsCache.get(padded);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;
  try {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) {
      factsCache.set(padded, { at: now, data: null });
      return null;
    }
    const j = (await r.json()) as CompanyFactsResponse;
    factsCache.set(padded, { at: now, data: j });
    return j;
  } catch {
    factsCache.set(padded, { at: now, data: null });
    return null;
  }
}

function pickUnit(concept: ConceptFacts | undefined): {
  unit: string;
  entries: FactUnitEntry[];
} | null {
  if (!concept?.units) return null;
  // Prefer USD, then USD/shares, then shares, then any first unit.
  const preferred = ["USD", "USD/shares", "shares"];
  for (const u of preferred) {
    if (concept.units[u]?.length) return { unit: u, entries: concept.units[u] };
  }
  const k = Object.keys(concept.units)[0];
  if (!k) return null;
  return { unit: k, entries: concept.units[k] };
}

function durationDays(start: string | undefined, end: string): number {
  if (!start) return 0;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.round((e - s) / 86400000);
}

function isAnnual(entry: FactUnitEntry): boolean {
  return durationDays(entry.start, entry.end) >= 330;
}

function isQuarter(entry: FactUnitEntry): boolean {
  const d = durationDays(entry.start, entry.end);
  return d >= 80 && d <= 100;
}

function dateDiffDays(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((da - db) / 86400000));
}

/**
 * Pick the latest point-in-time entry whose `end` falls within
 * `windowDays` of `anchorEnd`. Returns null when no entry meets the cutoff —
 * caller is expected to record the staleness.
 */
function latestPointInTimeFresh(
  entries: FactUnitEntry[],
  anchorEnd: string | null,
  windowDays: number,
): { entry: FactUnitEntry | null; staleCandidate: FactUnitEntry | null } {
  if (!entries.length) return { entry: null, staleCandidate: null };
  // Most-recent end first; filing date breaks ties so amended filings win.
  const sorted = [...entries].sort((a, b) => {
    if (a.end !== b.end) return a.end < b.end ? 1 : -1;
    const fa = a.filed ?? "";
    const fb = b.filed ?? "";
    return fa < fb ? 1 : -1;
  });
  if (!anchorEnd) return { entry: sorted[0], staleCandidate: null };
  for (const e of sorted) {
    if (dateDiffDays(e.end, anchorEnd) <= windowDays) {
      return { entry: e, staleCandidate: null };
    }
  }
  return { entry: null, staleCandidate: sorted[0] };
}

/**
 * Pick the latest "annualised" value for a duration-style fact: prefer the
 * sum of the last four quarters covering ~365 days ending on the most recent
 * quarter inside the freshness window. Fall back to the most recent FY 10-K
 * value if quarterly data is incomplete.
 */
function latestTtmFresh(
  entries: FactUnitEntry[],
  anchorEnd: string | null,
  windowDays: number,
): {
  entry: FactUnitEntry | null;
  valueOverride?: number;
  staleCandidate: FactUnitEntry | null;
} {
  if (!entries.length) return { entry: null, staleCandidate: null };

  const inWindow = (e: FactUnitEntry) =>
    !anchorEnd || dateDiffDays(e.end, anchorEnd) <= windowDays;

  const quarters = entries.filter(isQuarter).filter(inWindow);
  if (quarters.length >= 4) {
    const sortedQ = [...quarters].sort((a, b) => (a.end < b.end ? 1 : -1));
    const chosen: FactUnitEntry[] = [];
    const used = new Set<string>();
    for (const q of sortedQ) {
      if (chosen.length === 4) break;
      const key = `${q.start}-${q.end}`;
      if (used.has(key)) continue;
      used.add(key);
      chosen.push(q);
    }
    if (chosen.length === 4) {
      const sum = chosen.reduce((a, x) => a + x.val, 0);
      return { entry: chosen[0], valueOverride: sum, staleCandidate: null };
    }
  }
  const annuals = entries.filter(isAnnual).filter(inWindow);
  if (annuals.length) {
    const sorted = [...annuals].sort((a, b) => (a.end < b.end ? 1 : -1));
    return { entry: sorted[0], staleCandidate: null };
  }
  // Nothing fresh — record the freshest stale candidate so we can explain.
  const sortedAll = [...entries].sort((a, b) => (a.end < b.end ? 1 : -1));
  return { entry: null, staleCandidate: sortedAll[0] ?? null };
}

function toFundamentalValue(
  tag: string,
  unit: string,
  entry: FactUnitEntry,
  override?: number,
): FundamentalValue {
  return {
    value: override ?? entry.val,
    unit,
    end: entry.end,
    fy: entry.fy ?? null,
    fp: entry.fp ?? null,
    form: entry.form ?? null,
    filed: entry.filed ?? null,
    accn: entry.accn ?? null,
    tag,
  };
}

type Mode = "ttm" | "instant";

interface SelectionContext {
  anchorEnd: string | null;
  windowDays: number;
  stale: Array<{ field: string; tag: string; end: string; ageDays: number }>;
  missing: string[];
}

function findLatest(
  facts: NonNullable<CompanyFactsResponse["facts"]>,
  field: string,
  candidates: string[],
  mode: Mode,
  ctx: SelectionContext,
): FundamentalValue | null {
  const usGaap = facts["us-gaap"] ?? {};
  const dei = facts.dei ?? {};
  let bestStale: { tag: string; entry: FactUnitEntry } | null = null;

  for (const tag of candidates) {
    const concept = usGaap[tag] ?? dei[tag];
    const picked = pickUnit(concept);
    if (!picked) continue;
    if (mode === "instant") {
      const instant = picked.entries.filter((e) => !e.start);
      const list = instant.length ? instant : picked.entries;
      const r = latestPointInTimeFresh(list, ctx.anchorEnd, ctx.windowDays);
      if (r.entry) return toFundamentalValue(tag, picked.unit, r.entry);
      if (r.staleCandidate && !bestStale) bestStale = { tag, entry: r.staleCandidate };
    } else {
      const r = latestTtmFresh(picked.entries, ctx.anchorEnd, ctx.windowDays);
      if (r.entry) return toFundamentalValue(tag, picked.unit, r.entry, r.valueOverride);
      if (r.staleCandidate && !bestStale) bestStale = { tag, entry: r.staleCandidate };
    }
  }

  if (bestStale && ctx.anchorEnd) {
    ctx.stale.push({
      field,
      tag: bestStale.tag,
      end: bestStale.entry.end,
      ageDays: dateDiffDays(bestStale.entry.end, ctx.anchorEnd),
    });
  } else {
    ctx.missing.push(field);
  }
  return null;
}

function findAnnualSeries(
  facts: NonNullable<CompanyFactsResponse["facts"]>,
  candidates: string[],
): { entry: FactUnitEntry; tag: string; unit: string }[] {
  const usGaap = facts["us-gaap"] ?? {};
  const dei = facts.dei ?? {};
  for (const tag of candidates) {
    const concept = usGaap[tag] ?? dei[tag];
    const picked = pickUnit(concept);
    if (!picked) continue;
    const annuals = picked.entries.filter(isAnnual);
    if (annuals.length >= 2) {
      const sorted = [...annuals].sort((a, b) => (a.end < b.end ? 1 : -1));
      const seen = new Set<string>();
      const out: { entry: FactUnitEntry; tag: string; unit: string }[] = [];
      for (const e of sorted) {
        if (seen.has(e.end)) continue;
        seen.add(e.end);
        out.push({ entry: e, tag, unit: picked.unit });
      }
      return out;
    }
  }
  return [];
}

/**
 * Anchor date = latest period-end across a set of headline tags we expect
 * every active filer to publish currently. Used as the freshness reference
 * for every other fact. We pick the *most recent* period-end that any of
 * these tags reports — that's the company's "now".
 */
function computeAnchorDate(
  facts: NonNullable<CompanyFactsResponse["facts"]>,
): string | null {
  const usGaap = facts["us-gaap"] ?? {};
  const candidates: string[] = [
    "Assets",
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "Liabilities",
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
  ];
  let best: string | null = null;
  for (const tag of candidates) {
    const concept = usGaap[tag];
    const picked = pickUnit(concept);
    if (!picked) continue;
    for (const e of picked.entries) {
      if (!best || e.end > best) best = e.end;
    }
  }
  return best;
}

function ratio(num: number | null, den: number | null): number | null {
  if (num == null || den == null || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return null;
  }
  return num / den;
}

function pct(num: number | null, den: number | null): number | null {
  const r = ratio(num, den);
  return r == null ? null : r * 100;
}

export async function getEquityFundamentals(
  ticker: string,
): Promise<EquityFundamentals | null> {
  const t = ticker.toUpperCase();
  const cached = fundamentalsCache.get(t);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  const cik = await resolveCik(t);
  if (!cik) {
    fundamentalsCache.set(t, { at: now, data: null });
    return null;
  }
  const facts = await fetchCompanyFacts(cik);
  if (!facts?.facts) {
    fundamentalsCache.set(t, { at: now, data: null });
    return null;
  }

  const f = facts.facts;
  const anchorEnd = computeAnchorDate(f);
  const ctx: SelectionContext = {
    anchorEnd,
    windowDays: FRESHNESS_WINDOW_DAYS,
    stale: [],
    missing: [],
  };

  const revenue = findLatest(
    f, "revenue",
    ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "ttm", ctx,
  );
  const grossProfit = findLatest(f, "grossProfit", ["GrossProfit"], "ttm", ctx);
  const operatingIncome = findLatest(
    f, "operatingIncome",
    ["OperatingIncomeLoss", "IncomeLossFromContinuingOperations"],
    "ttm", ctx,
  );
  const netIncome = findLatest(
    f, "netIncome",
    ["NetIncomeLoss", "ProfitLoss"],
    "ttm", ctx,
  );
  const assets = findLatest(f, "assets", ["Assets"], "instant", ctx);
  const liabilities = findLatest(f, "liabilities", ["Liabilities"], "instant", ctx);
  const equity = findLatest(
    f, "equity",
    ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "instant", ctx,
  );
  const cashAndEquivalents = findLatest(
    f, "cashAndEquivalents",
    [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    "instant", ctx,
  );
  const longTermDebt = findLatest(
    f, "longTermDebt",
    ["LongTermDebtNoncurrent", "LongTermDebt"],
    "instant", ctx,
  );
  const currentDebt = findLatest(
    f, "currentDebt",
    ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"],
    "instant", ctx,
  );
  // Total debt: prefer a direct combined tag; otherwise sum the parts only
  // when at least one is fresh. We must NOT synthesise a total from a stale
  // long-term + stale current pair — that's how the 2018 figure leaked in.
  let totalDebt: FundamentalValue | null = null;
  // Probe the direct tag without spamming `missing` for it.
  const directProbe: SelectionContext = {
    anchorEnd,
    windowDays: FRESHNESS_WINDOW_DAYS,
    stale: [],
    missing: [],
  };
  const directTotal = findLatest(
    f, "totalDebt",
    ["DebtAndCapitalLeaseObligations", "LongTermDebtAndCapitalLeaseObligations"],
    "instant", directProbe,
  );
  if (directTotal) {
    totalDebt = directTotal;
  } else if (longTermDebt || currentDebt) {
    const v = (longTermDebt?.value ?? 0) + (currentDebt?.value ?? 0);
    const anchor = longTermDebt ?? currentDebt;
    if (anchor) {
      totalDebt = { ...anchor, value: v, tag: "LongTermDebt+CurrentDebt" };
    }
  }
  if (!totalDebt) {
    // Surface the failure so the UI / scoring can mark it missing.
    if (directProbe.stale.length) ctx.stale.push(...directProbe.stale.map((s) => ({ ...s, field: "totalDebt" })));
    else ctx.missing.push("totalDebt");
  }

  const operatingCashFlow = findLatest(
    f, "operatingCashFlow",
    [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    "ttm", ctx,
  );
  // Capex is reported as a positive outflow in PaymentsToAcquirePropertyPlantAndEquipment.
  // Normalise to negative-as-outflow so FCF = OCF + capex sums correctly.
  const capexRaw = findLatest(
    f, "capex",
    ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "ttm", ctx,
  );
  const capex: FundamentalValue | null = capexRaw
    ? { ...capexRaw, value: -Math.abs(capexRaw.value) }
    : null;
  let freeCashFlow: FundamentalValue | null = null;
  if (operatingCashFlow && capex) {
    freeCashFlow = {
      ...operatingCashFlow,
      value: operatingCashFlow.value + capex.value,
      tag: "OCF+Capex",
    };
  } else if (operatingCashFlow) {
    freeCashFlow = { ...operatingCashFlow, tag: "OCF (capex unavailable)" };
  } else {
    ctx.missing.push("freeCashFlow");
  }
  const dilutedShares = findLatest(
    f, "dilutedShares",
    [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingDiluted",
    ],
    "ttm", ctx,
  );
  const eps = findLatest(
    f, "eps",
    ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    "ttm", ctx,
  );

  // Annual series for growth / share-count trend. Use the most recent
  // entries regardless of freshness gate — by construction they're already
  // dedup'd on fiscal-year end and we only pull the recent tail.
  const revenueSeries = findAnnualSeries(f, [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "SalesRevenueNet",
  ]);
  const epsSeries = findAnnualSeries(f, [
    "EarningsPerShareDiluted",
    "EarningsPerShareBasic",
  ]);
  const sharesSeries = findAnnualSeries(f, [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingDiluted",
    "CommonStockSharesOutstanding",
  ]);

  const revenueGrowth =
    revenueSeries.length >= 2 && revenueSeries[1].entry.val !== 0
      ? ((revenueSeries[0].entry.val - revenueSeries[1].entry.val) /
          Math.abs(revenueSeries[1].entry.val)) *
        100
      : null;
  const epsGrowth =
    epsSeries.length >= 2 && epsSeries[1].entry.val !== 0
      ? ((epsSeries[0].entry.val - epsSeries[1].entry.val) /
          Math.abs(epsSeries[1].entry.val)) *
        100
      : null;

  let shareCountTrend: "rising" | "flat" | "falling" | null = null;
  let shareCountChangePct: number | null = null;
  if (sharesSeries.length >= 3) {
    const recent = sharesSeries.slice(0, Math.min(5, sharesSeries.length));
    const oldest = recent[recent.length - 1].entry.val;
    const newest = recent[0].entry.val;
    if (oldest > 0) {
      shareCountChangePct = ((newest - oldest) / oldest) * 100;
      if (shareCountChangePct > 1) shareCountTrend = "rising";
      else if (shareCountChangePct < -1) shareCountTrend = "falling";
      else shareCountTrend = "flat";
    }
  }

  const grossMargin = pct(grossProfit?.value ?? null, revenue?.value ?? null);
  const operatingMargin = pct(
    operatingIncome?.value ?? null,
    revenue?.value ?? null,
  );
  const netMargin = pct(netIncome?.value ?? null, revenue?.value ?? null);
  const fcfMargin = pct(freeCashFlow?.value ?? null, revenue?.value ?? null);
  const roe = pct(netIncome?.value ?? null, equity?.value ?? null);
  const debtToEquity = ratio(totalDebt?.value ?? null, equity?.value ?? null);

  // "latestFiling" — pick the most recent filed date across the headline facts.
  const filedCandidates: { form: string; filed: string; periodEnd: string }[] = [];
  for (const v of [
    revenue,
    netIncome,
    operatingIncome,
    operatingCashFlow,
    assets,
    equity,
  ]) {
    if (v?.filed && v.form) {
      filedCandidates.push({ form: v.form, filed: v.filed, periodEnd: v.end });
    }
  }
  filedCandidates.sort((a, b) => (a.filed < b.filed ? 1 : -1));
  const latestFiling = filedCandidates[0] ?? null;

  // Deduplicate the bookkeeping arrays.
  const seenStale = new Set<string>();
  const dedupStale = ctx.stale.filter((s) => {
    const k = `${s.field}|${s.tag}|${s.end}`;
    if (seenStale.has(k)) return false;
    seenStale.add(k);
    return true;
  });
  const seenMissing = new Set<string>();
  const dedupMissing = ctx.missing.filter((m) => {
    if (seenMissing.has(m)) return false;
    seenMissing.add(m);
    return true;
  });

  const fundamentals: EquityFundamentals = {
    source: "sec_edgar",
    ticker: t,
    cik: pad10(cik),
    entityName: facts.entityName ?? null,
    asOf: now,
    revenue,
    grossProfit,
    operatingIncome,
    netIncome,
    assets,
    liabilities,
    equity,
    totalDebt,
    currentDebt,
    longTermDebt,
    cashAndEquivalents,
    operatingCashFlow,
    capex,
    freeCashFlow,
    dilutedShares,
    eps,
    grossMargin,
    operatingMargin,
    netMargin,
    fcfMargin,
    roe,
    debtToEquity,
    revenueGrowth,
    epsGrowth,
    shareCountTrend,
    shareCountChangePct,
    latestFiling,
    anchorDate: anchorEnd,
    freshnessWindowDays: FRESHNESS_WINDOW_DAYS,
    staleFacts: dedupStale,
    missingFields: dedupMissing,
  };
  fundamentalsCache.set(t, { at: now, data: fundamentals });
  return fundamentals;
}

// =============================================================================
// Historical revenue series for the Conviction Ideas revenue panel.
//
// Returns annual + quarterly revenue points sourced from SEC EDGAR
// companyfacts. Operating companies that file with the SEC resolve to a
// status of "available"; tickers with no CIK/ticker mapping (foreign-only,
// ambiguous, or unverified placeholders) resolve to "not-available"; and
// issuers that map to a CIK but report no revenue concept at all (most
// ETFs/funds/trusts/non-operating entities) resolve to "not-meaningful".
//
// Caching is independent of the fundamentals cache (the revenue series is a
// different projection of companyfacts) but reuses the same long TTL since
// the underlying filings update at most daily.
// =============================================================================

const revenueCache = new Map<
  string,
  { at: number; data: EquityRevenueResponse }
>();

const REVENUE_TAGS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet",
];

function fyLabel(entry: FactUnitEntry): string {
  const year = entry.fy ?? (entry.end ? Number(entry.end.slice(0, 4)) : null);
  return year != null ? `FY${year}` : entry.end;
}

function quarterLabel(entry: FactUnitEntry): string {
  const year = entry.end ? entry.end.slice(0, 4) : "";
  if (entry.fp && /^Q[1-4]$/.test(entry.fp)) return `${entry.fp} ${year}`;
  // Derive a calendar quarter from the period-end month as a fallback.
  const month = entry.end ? Number(entry.end.slice(5, 7)) : 0;
  const q = month >= 1 && month <= 12 ? Math.ceil(month / 3) : 0;
  return q ? `Q${q} ${year}` : entry.end;
}

function toRevenuePoint(entry: FactUnitEntry, kind: "annual" | "quarterly"): RevenuePoint {
  return {
    end: entry.end,
    label: kind === "annual" ? fyLabel(entry) : quarterLabel(entry),
    value: entry.val,
    fy: entry.fy ?? null,
    fp: entry.fp ?? null,
    form: entry.form ?? null,
  };
}

function dedupeByEnd(entries: FactUnitEntry[]): FactUnitEntry[] {
  // Keep the most recently filed entry for any given period end (amended
  // filings win). Input is assumed sorted ascending by end.
  const byEnd = new Map<string, FactUnitEntry>();
  for (const e of entries) {
    const prev = byEnd.get(e.end);
    if (!prev || (e.filed ?? "") >= (prev.filed ?? "")) byEnd.set(e.end, e);
  }
  return Array.from(byEnd.values()).sort((a, b) => (a.end < b.end ? -1 : 1));
}

function collectRevenueEntries(
  facts: NonNullable<CompanyFactsResponse["facts"]>,
): { entries: FactUnitEntry[]; unit: string } | null {
  const usGaap = facts["us-gaap"] ?? {};
  // Merge across the candidate tags so issuers that switched tags over time
  // still get a continuous series. Prefer USD units.
  const merged: FactUnitEntry[] = [];
  let unit = "USD";
  for (const tag of REVENUE_TAGS) {
    const concept = usGaap[tag];
    const picked = pickUnit(concept);
    if (!picked) continue;
    unit = picked.unit;
    for (const e of picked.entries) {
      if (Number.isFinite(e.val) && e.start) merged.push(e);
    }
  }
  if (!merged.length) return null;
  return { entries: merged, unit };
}

// =============================================================================
// Revenue bridge — a deterministic, year-by-year revenue walk built from three
// labelled sources, in priority order:
//   1. SEC actuals      — reported annual revenue (10-K) for the recent past.
//   2. Analyst estimates — forward annual consensus where a provider returns it
//                          (anchors the near-term FY2026E/FY2027E years).
//   3. TreasuryLens model — a growth-fade extrapolation that fills the horizon
//                          once analyst coverage runs out. No LLM; the fade is a
//                          fixed template so it is cheap and reproducible.
// Every year carries a `source` badge so the UI never blurs the line between a
// reported fact, a consensus number and a TreasuryLens assumption.
//
// The fade decays the most recent observed YoY growth toward a terminal rate
// scaled by company size (bigger companies revert toward GDP-plus). It mirrors
// the scenario model's intent but is kept self-contained here so the revenue
// panel does not depend on the heavier scenario pipeline.
// =============================================================================

// Number of forward years (analyst + model) we aim to show beyond the last
// reported actual, and how many historical actuals to include for context.
const BRIDGE_FORWARD_YEARS = 4;
const BRIDGE_ACTUAL_YEARS = 3;

// Terminal YoY growth the model fade decays toward, by revenue scale. Larger
// businesses mean-revert lower. Picked deterministically from latest revenue.
function terminalGrowthForScale(latestRevenue: number): number {
  const b = latestRevenue;
  if (b >= 200e9) return 5; // mega
  if (b >= 50e9) return 7; // large
  if (b >= 10e9) return 9; // mid
  if (b >= 1e9) return 11; // small
  return 13; // micro
}

function clampGrowth(pct: number): number {
  // Keep model growth in a sane band so a single noisy print can't explode the
  // walk. Bounds are intentionally wide; the fade does the real shaping.
  return Math.max(-25, Math.min(60, pct));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function yoyPct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || !Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) {
    return null;
  }
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function buildRevenueBridge(
  annual: RevenuePoint[],
  estimates: AnalystEstimates,
): RevenueBridge {
  // Actuals: the most recent reported fiscal years, oldest-first. We need at
  // least one to seed the bridge; without it there is nothing to walk forward.
  const actuals = annual
    .filter((p) => p.value != null && Number.isFinite(p.value))
    .slice(-Math.max(BRIDGE_ACTUAL_YEARS, 2));
  if (actuals.length === 0) {
    return {
      status: "unavailable",
      years: [],
      estimateSource: null,
      estimateStatus: estimates.status ?? null,
      modelNote: "",
      note: "A revenue bridge needs at least one reported annual figure from SEC filings.",
    };
  }

  const years: RevenueBridgeYear[] = [];
  for (let i = 0; i < actuals.length; i++) {
    const p = actuals[i];
    const fy = p.fy ?? Number(p.end.slice(0, 4));
    const prev = i > 0 ? actuals[i - 1].value : null;
    years.push({
      fy,
      label: `FY${fy}`,
      value: p.value,
      growthPct: i > 0 ? round2(yoyPct(p.value, prev) ?? NaN) : null,
      source: "sec-actual",
      note: p.form ? `Reported in ${p.form}` : "SEC reported actual",
    });
  }

  const lastActual = actuals[actuals.length - 1];
  const lastActualFy = lastActual.fy ?? Number(lastActual.end.slice(0, 4));
  let prevValue = lastActual.value as number;
  let lastFilledFy = lastActualFy;

  // Analyst-estimate years: forward annual consensus rows for fiscal years
  // strictly after the last reported actual. These anchor the near-term walk.
  const analystYears =
    estimates.status === "available"
      ? [...(estimates.revenueByYear ?? [])]
          .filter((r) => r.fy > lastActualFy && r.value > 0)
          .sort((a, b) => a.fy - b.fy)
      : [];
  let estimateSource: string | null = null;
  for (const r of analystYears) {
    if (years.length - actuals.length >= BRIDGE_FORWARD_YEARS) break;
    // Fill any gap years between the last filled year and this estimate with a
    // straight-line interpolation labelled as model, so the walk stays
    // contiguous rather than skipping fiscal years.
    for (let gapFy = lastFilledFy + 1; gapFy < r.fy; gapFy++) {
      if (years.length - actuals.length >= BRIDGE_FORWARD_YEARS) break;
      const steps = r.fy - lastFilledFy;
      const idx = gapFy - lastFilledFy;
      const interp = prevValue + ((r.value - prevValue) * idx) / steps;
      years.push({
        fy: gapFy,
        label: `FY${gapFy}E`,
        value: round2(interp),
        growthPct: round2(yoyPct(interp, prevValue) ?? NaN),
        source: "treasurylens-model",
        note: "Interpolated between reported and consensus years",
      });
      prevValue = interp;
    }
    if (years.length - actuals.length >= BRIDGE_FORWARD_YEARS) break;
    estimateSource = estimates.source;
    years.push({
      fy: r.fy,
      label: `FY${r.fy}E`,
      value: r.value,
      growthPct: round2(yoyPct(r.value, prevValue) ?? NaN),
      source: "analyst-estimate",
      analystCount: r.analystCount,
      note:
        r.analystCount != null
          ? `Consensus of ${r.analystCount} analyst${r.analystCount === 1 ? "" : "s"}`
          : "Analyst consensus estimate",
    });
    prevValue = r.value;
    lastFilledFy = r.fy;
  }

  // TreasuryLens model years: extend with a growth fade until we reach the
  // forward-year target. The fade starts from the most recent realised YoY
  // growth (analyst if present, else the last actual's YoY) and decays toward a
  // size-scaled terminal rate.
  const forwardCount = years.length - actuals.length;
  if (forwardCount < BRIDGE_FORWARD_YEARS) {
    // Seed growth: the YoY of the last filled year, else the last actual YoY.
    let startGrowth =
      years[years.length - 1].growthPct ??
      yoyPct(lastActual.value, actuals.length >= 2 ? actuals[actuals.length - 2].value : null) ??
      terminalGrowthForScale(prevValue);
    startGrowth = clampGrowth(startGrowth);
    const terminal = terminalGrowthForScale(prevValue);
    const remaining = BRIDGE_FORWARD_YEARS - forwardCount;
    for (let k = 1; k <= remaining; k++) {
      // Linear fade from start → terminal across the remaining model years.
      const t = remaining > 1 ? (k - 1) / (remaining - 1) : 1;
      const g = clampGrowth(startGrowth + (terminal - startGrowth) * t);
      const fy = lastFilledFy + 1;
      const value = prevValue * (1 + g / 100);
      years.push({
        fy,
        label: `FY${fy}E`,
        value: round2(value),
        growthPct: round2(g),
        source: "treasurylens-model",
        note: "TreasuryLens growth-fade model (no analyst coverage)",
      });
      prevValue = value;
      lastFilledFy = fy;
    }
  }

  const hasAnalyst = years.some((y) => y.source === "analyst-estimate");
  const hasModel = years.some((y) => y.source === "treasurylens-model");
  const modelNote = hasModel
    ? "TreasuryLens model years fade the most recent revenue growth toward a size-scaled terminal rate; they are assumptions, not forecasts."
    : "";
  const note = hasAnalyst
    ? "Bridge anchors near-term years on analyst revenue consensus; later years are TreasuryLens model assumptions."
    : "No analyst revenue consensus was available; forward years are TreasuryLens model assumptions only.";

  return {
    status: "available",
    years,
    estimateSource,
    estimateStatus: estimates.status ?? null,
    modelNote,
    note,
  };
}

export async function getEquityRevenue(
  ticker: string,
): Promise<EquityRevenueResponse> {
  const t = ticker.toUpperCase();
  const now = Date.now();
  const cached = revenueCache.get(t);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  const base: EquityRevenueResponse = {
    ticker: t,
    status: "not-available",
    source: "none",
    currency: "USD",
    ttmRevenue: null,
    ttmAsOf: null,
    ttmIsAnnualFallback: false,
    annual: [],
    quarterly: [],
    annualGrowthPct: null,
    cik: null,
    entityName: null,
    asOf: now,
    note: "No SEC EDGAR revenue data is available for this ticker.",
    projections: {
      status: "unavailable",
      source: null,
      points: [],
      note: "Revenue projections unavailable with current free data sources.",
    },
  };

  const cik = await resolveCik(t);
  if (!cik) {
    const out = {
      ...base,
      note: "This ticker does not map to a US SEC filer (it may be foreign-listed, an ETF/fund, or an unverified symbol). Historical revenue is not available from free SEC data.",
    };
    revenueCache.set(t, { at: now, data: out });
    return out;
  }

  const facts = await fetchCompanyFacts(cik);
  if (!facts?.facts) {
    const out = { ...base, cik: pad10(cik), note: "SEC company facts could not be retrieved for this filer right now." };
    revenueCache.set(t, { at: now, data: out });
    return out;
  }

  const collected = collectRevenueEntries(facts.facts);
  if (!collected) {
    // CIK exists but no revenue concept — typical for ETFs/funds/trusts and
    // other non-operating entities. Revenue is not a meaningful metric here.
    const out: EquityRevenueResponse = {
      ...base,
      status: "not-meaningful",
      source: "sec_edgar",
      cik: pad10(cik),
      entityName: facts.entityName ?? null,
      note: "This issuer files with the SEC but reports no revenue concept — revenue is not a meaningful metric for this entity (e.g. an ETF, fund, trust, or holding/non-operating company).",
    };
    revenueCache.set(t, { at: now, data: out });
    return out;
  }

  const annualRaw = dedupeByEnd(collected.entries.filter(isAnnual));
  const quarterlyRaw = dedupeByEnd(collected.entries.filter(isQuarter));

  // Keep a readable tail: last ~6 fiscal years and last ~8 quarters.
  const annual = annualRaw.slice(-6).map((e) => toRevenuePoint(e, "annual"));
  const quarterly = quarterlyRaw.slice(-8).map((e) => toRevenuePoint(e, "quarterly"));

  if (!annual.length && !quarterly.length) {
    const out: EquityRevenueResponse = {
      ...base,
      status: "not-meaningful",
      source: "sec_edgar",
      cik: pad10(cik),
      entityName: facts.entityName ?? null,
      note: "No annual or quarterly revenue periods could be extracted for this filer.",
    };
    revenueCache.set(t, { at: now, data: out });
    return out;
  }

  // TTM = sum of the last 4 distinct quarters when available; else the latest
  // annual value as a fallback.
  let ttmRevenue: number | null = null;
  let ttmAsOf: string | null = null;
  let ttmIsAnnualFallback = false;
  if (quarterlyRaw.length >= 4) {
    const last4 = quarterlyRaw.slice(-4);
    ttmRevenue = last4.reduce((a, e) => a + e.val, 0);
    ttmAsOf = last4[last4.length - 1].end;
  } else if (annualRaw.length) {
    const latest = annualRaw[annualRaw.length - 1];
    ttmRevenue = latest.val;
    ttmAsOf = latest.end;
    ttmIsAnnualFallback = true;
  }

  let annualGrowthPct: number | null = null;
  if (annual.length >= 2) {
    const prev = annual[annual.length - 2].value;
    const curr = annual[annual.length - 1].value;
    if (prev !== 0) annualGrowthPct = ((curr - prev) / Math.abs(prev)) * 100;
  }

  // Build the year-by-year revenue bridge. Analyst estimates are fetched here
  // (their own 6h cache keeps this cheap and avoids a fan-out on ticker
  // switches); they degrade cleanly to a model-only bridge when unavailable or
  // not entitled. A provider failure must not break the historical panel, so we
  // fall back to empty estimates on error.
  let estimates: AnalystEstimates;
  try {
    estimates = await getAnalystEstimates(t);
  } catch {
    estimates = {
      status: "error",
      symbol: t,
      source: "finnhub",
      asOf: now,
      revenueEstimate: null,
      revenueEstimateYear: null,
      revenuePeriod: null,
      revenueAnalystCount: null,
      revenueByYear: [],
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
      message: "Analyst estimates could not be fetched.",
    };
  }
  const bridge = buildRevenueBridge(annual, estimates);

  const out: EquityRevenueResponse = {
    ticker: t,
    status: "available",
    source: "sec_edgar",
    currency: collected.unit === "USD" ? "USD" : collected.unit,
    ttmRevenue,
    ttmAsOf,
    ttmIsAnnualFallback,
    annual,
    quarterly,
    annualGrowthPct,
    cik: pad10(cik),
    entityName: facts.entityName ?? null,
    asOf: now,
    note: "Historical revenue from SEC EDGAR companyfacts (annual from 10-K, quarterly from 10-Q). TTM is the sum of the last four reported quarters when available.",
    projections: {
      status: bridge.years.some((y) => y.source === "analyst-estimate")
        ? "available"
        : "unavailable",
      source: bridge.estimateSource,
      points: bridge.years
        .filter((y) => y.source === "analyst-estimate" && y.value != null)
        .map((y) => ({
          fy: y.fy,
          label: y.label,
          value: y.value as number,
          source: bridge.estimateSource ?? "analyst",
        })),
      note: bridge.note,
    },
    bridge,
  };
  revenueCache.set(t, { at: now, data: out });
  return out;
}
