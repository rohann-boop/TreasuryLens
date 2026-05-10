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
//   2. Fetch companyfacts JSON for the CIK and pick the most recent values
//      for a curated list of US-GAAP tags. Multiple candidate tags are tried
//      so we degrade gracefully when a company uses a non-canonical tag.
//   3. Compute TTM where it makes sense (income statement + cash flow) by
//      summing the last four quarters. Balance-sheet items use the latest
//      point-in-time value.
//   4. Cache responses in-memory with a long TTL — SEC filings update daily
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

function latestPointInTime(
  entries: FactUnitEntry[],
): FactUnitEntry | null {
  // For instant-style facts (e.g. balance-sheet items), every entry covers a
  // point in time (`end` date, no `start`). For duration facts there is a
  // `start`. We just take the entry with the most recent `end` and the most
  // recent filing as a tiebreaker.
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => {
    if (a.end !== b.end) return a.end < b.end ? 1 : -1;
    const fa = a.filed ?? "";
    const fb = b.filed ?? "";
    return fa < fb ? 1 : -1;
  });
  return sorted[0];
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

/**
 * Pick the latest "annualised" value for a duration-style fact: prefer the
 * sum of the last four quarters covering ~365 days ending on the most recent
 * quarter. Fall back to the most recent FY 10-K value if quarterly data is
 * incomplete.
 */
function latestTtm(
  entries: FactUnitEntry[],
): { entry: FactUnitEntry; valueOverride?: number } | null {
  if (!entries.length) return null;
  const quarters = entries.filter(isQuarter);
  if (quarters.length >= 4) {
    const sortedQ = [...quarters].sort((a, b) => (a.end < b.end ? 1 : -1));
    // Try to take the four most recent non-overlapping quarters.
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
      // Use the most recent quarter's metadata as the "as of" anchor.
      const anchor = chosen[0];
      return { entry: anchor, valueOverride: sum };
    }
  }
  // Fallback: latest annual (10-K, FY/CY) value.
  const annuals = entries.filter(isAnnual);
  if (annuals.length) {
    const sorted = [...annuals].sort((a, b) => (a.end < b.end ? 1 : -1));
    return { entry: sorted[0] };
  }
  // Fallback: latest entry of any kind.
  const sorted = [...entries].sort((a, b) => (a.end < b.end ? 1 : -1));
  return { entry: sorted[0] };
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

function findLatest(
  facts: NonNullable<CompanyFactsResponse["facts"]>,
  candidates: string[],
  mode: Mode,
): FundamentalValue | null {
  const usGaap = facts["us-gaap"] ?? {};
  const dei = facts.dei ?? {};
  for (const tag of candidates) {
    const concept = usGaap[tag] ?? dei[tag];
    const picked = pickUnit(concept);
    if (!picked) continue;
    if (mode === "instant") {
      // Instant facts have no `start`. Filter accordingly so we don't pick
      // a stale duration fact when both exist (rare, but defensive).
      const instant = picked.entries.filter((e) => !e.start);
      const list = instant.length ? instant : picked.entries;
      const e = latestPointInTime(list);
      if (e) return toFundamentalValue(tag, picked.unit, e);
    } else {
      const r = latestTtm(picked.entries);
      if (r) return toFundamentalValue(tag, picked.unit, r.entry, r.valueOverride);
    }
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
      // Most-recent first
      const sorted = [...annuals].sort((a, b) => (a.end < b.end ? 1 : -1));
      // Deduplicate by fiscal-year end so multiple amendments don't double-count.
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

  const revenue = findLatest(
    f,
    ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    "ttm",
  );
  const grossProfit = findLatest(f, ["GrossProfit"], "ttm");
  const operatingIncome = findLatest(
    f,
    ["OperatingIncomeLoss", "IncomeLossFromContinuingOperations"],
    "ttm",
  );
  const netIncome = findLatest(
    f,
    ["NetIncomeLoss", "ProfitLoss"],
    "ttm",
  );
  const assets = findLatest(f, ["Assets"], "instant");
  const liabilities = findLatest(f, ["Liabilities"], "instant");
  const equity = findLatest(
    f,
    ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "instant",
  );
  const cashAndEquivalents = findLatest(
    f,
    [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    "instant",
  );
  const longTermDebt = findLatest(
    f,
    ["LongTermDebtNoncurrent", "LongTermDebt"],
    "instant",
  );
  const currentDebt = findLatest(
    f,
    ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"],
    "instant",
  );
  let totalDebt: FundamentalValue | null = null;
  const directTotal = findLatest(f, ["DebtAndCapitalLeaseObligations", "LongTermDebtAndCapitalLeaseObligations"], "instant");
  if (directTotal) {
    totalDebt = directTotal;
  } else if (longTermDebt || currentDebt) {
    const v = (longTermDebt?.value ?? 0) + (currentDebt?.value ?? 0);
    const anchor = longTermDebt ?? currentDebt;
    if (anchor) {
      totalDebt = { ...anchor, value: v, tag: "LongTermDebt+CurrentDebt" };
    }
  }
  const operatingCashFlow = findLatest(
    f,
    [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    "ttm",
  );
  // Capex is reported as a positive outflow in PaymentsToAcquirePropertyPlantAndEquipment.
  // Normalise to negative-as-outflow so FCF = OCF + capex sums correctly.
  const capexRaw = findLatest(
    f,
    ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "ttm",
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
  }
  const dilutedShares = findLatest(
    f,
    [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingDiluted",
    ],
    "ttm",
  );
  const eps = findLatest(
    f,
    ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    "ttm",
  );

  // Annual series for growth / share-count trend
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
  };
  fundamentalsCache.set(t, { at: now, data: fundamentals });
  return fundamentals;
}
