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

import type { EquityFundamentals, FundamentalValue } from "@shared/schema";

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
