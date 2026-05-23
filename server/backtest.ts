// Scenario backtest — 1Y price-history reconstruction.
//
// HONEST FRAMING: this is NOT a point-in-time recommendation audit.
// We do not freeze the curated universe, fundamentals, or scenario labels as
// of one year ago. The pick list, the classification (2x/3x/5x/...), and the
// thesis text are whatever they are today. What we *do* is measure how each
// name in the current universe would have performed on a price-only basis
// over the lookback window, and aggregate by today's scenario classification.
//
// In other words: "if you had bought the names we currently label '3x
// potential' one year ago, here is the average price-only return." Useful as
// a directional sanity check. NOT a track record.
//
// Limitations are surfaced explicitly in `limitations[]` and the methodology
// string so the UI and assistant always carry the warning.

import type {
  BacktestBucketAgg,
  BacktestResponse,
  BacktestStockResult,
  BacktestSummary,
  ScenarioClassification,
  StockPick,
} from "@shared/schema";
import type { Bar } from "./indicators";
import { fetchMassiveChart, fetchYahooChart } from "./marketData";
import { getStockPicks } from "./stockPicks";

const LOOKBACK_DAYS = 365;
const TOLERANCE_DAYS = 21; // up to 3 weeks slack when finding the entry bar
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const BENCHMARKS = { spy: "SPY", qqq: "QQQ" };

const ALL_CLASSIFICATIONS: ScenarioClassification[] = [
  "defensive",
  "compounder",
  "2x potential",
  "3x potential",
  "5x potential",
  "speculative",
];

const DISCLAIMER =
  "Research/education only. Hypothetical reconstruction using today's curated universe and classifications applied to historical prices. Not a recommendation, track record, or performance claim.";

interface CacheEntry {
  at: number;
  data: BacktestResponse;
}

let cached: CacheEntry | null = null;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function round(n: number | null, digits = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function findBarAt(bars: Bar[], targetMs: number, toleranceDays: number): Bar | null {
  // Bars assumed ascending by t. Find the bar with t <= targetMs that is
  // closest to targetMs, allowing some slack so newly-listed names still get
  // an entry price (with a warning).
  const toleranceMs = toleranceDays * 86400000;
  let best: Bar | null = null;
  for (const b of bars) {
    if (b.t <= targetMs) {
      best = b;
    } else {
      break;
    }
  }
  if (!best) return null;
  if (targetMs - best.t > toleranceMs * 3) return null;
  return best;
}

function computeMaxDrawdownPct(bars: Bar[], entryT: number): number | null {
  // Max drawdown from entry forward: lowest (low - peakSoFar) / peakSoFar.
  // Returns a negative percentage (worst drawdown). Null if not enough data.
  let peak: number | null = null;
  let maxDD: number | null = null;
  for (const b of bars) {
    if (b.t < entryT) continue;
    if (!Number.isFinite(b.c) || b.c <= 0) continue;
    if (peak == null || b.c > peak) peak = b.c;
    const low = Number.isFinite(b.l) && b.l > 0 ? b.l : b.c;
    if (peak != null && peak > 0) {
      const dd = (low - peak) / peak;
      if (maxDD == null || dd < maxDD) maxDD = dd;
    }
  }
  if (maxDD == null) return null;
  return maxDD * 100; // negative %
}

async function fetchBars(ticker: string): Promise<{ bars: Bar[] | null; source: string }> {
  const massive = await fetchMassiveChart(ticker);
  if (massive && massive.length > 0) return { bars: massive, source: "massive" };
  const yahoo = await fetchYahooChart(ticker);
  if (yahoo && yahoo.length > 0) return { bars: yahoo, source: "yahoo" };
  return { bars: null, source: "unavailable" };
}

interface WindowReturn {
  entryPrice: number | null;
  entryDate: string | null;
  latestPrice: number | null;
  latestDate: string | null;
  returnPct: number | null;
  maxDrawdownPct: number | null;
  source: string;
  warning: string | null;
}

function computeWindowReturn(bars: Bar[] | null, source: string): WindowReturn {
  if (!bars || bars.length === 0) {
    return {
      entryPrice: null,
      entryDate: null,
      latestPrice: null,
      latestDate: null,
      returnPct: null,
      maxDrawdownPct: null,
      source,
      warning: "No historical bars.",
    };
  }
  const last = bars[bars.length - 1];
  if (!Number.isFinite(last.c) || last.c <= 0) {
    return {
      entryPrice: null,
      entryDate: null,
      latestPrice: null,
      latestDate: null,
      returnPct: null,
      maxDrawdownPct: null,
      source,
      warning: "Latest bar invalid.",
    };
  }
  const targetMs = last.t - LOOKBACK_DAYS * 86400000;
  const entryBar = findBarAt(bars, targetMs, TOLERANCE_DAYS);
  if (!entryBar || !Number.isFinite(entryBar.c) || entryBar.c <= 0) {
    return {
      entryPrice: null,
      entryDate: null,
      latestPrice: last.c,
      latestDate: isoDate(last.t),
      returnPct: null,
      maxDrawdownPct: null,
      source,
      warning: "No entry bar near 1 year ago (insufficient history).",
    };
  }
  const ret = ((last.c - entryBar.c) / entryBar.c) * 100;
  const dd = computeMaxDrawdownPct(bars, entryBar.t);
  // If the entry bar is more than the standard tolerance off, flag it.
  const ageDays = Math.round((last.t - entryBar.t) / 86400000);
  const isOff = Math.abs(ageDays - LOOKBACK_DAYS) > TOLERANCE_DAYS;
  return {
    entryPrice: entryBar.c,
    entryDate: isoDate(entryBar.t),
    latestPrice: last.c,
    latestDate: isoDate(last.t),
    returnPct: ret,
    maxDrawdownPct: dd,
    source,
    warning: isOff
      ? `Entry bar is ${ageDays} days old, not exactly ${LOOKBACK_DAYS}.`
      : null,
  };
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregateBucket(
  classification: ScenarioClassification,
  rows: BacktestStockResult[],
): BacktestBucketAgg {
  const r = rows
    .map((x) => x.returnPct)
    .filter((x): x is number => x != null && Number.isFinite(x));
  const dd = rows
    .map((x) => x.maxDrawdownPct)
    .filter((x): x is number => x != null && Number.isFinite(x));
  const positives = r.filter((x) => x > 0);
  const spyHits = rows.filter((x) => x.beatSpy === true).length;
  const qqqHits = rows.filter((x) => x.beatQqq === true).length;
  const spyEval = rows.filter((x) => x.beatSpy != null).length;
  const qqqEval = rows.filter((x) => x.beatQqq != null).length;
  return {
    classification,
    count: rows.length,
    avgReturnPct:
      r.length > 0 ? round(r.reduce((a, b) => a + b, 0) / r.length, 2) : null,
    medianReturnPct: round(median(r), 2),
    hitRatePct: r.length > 0 ? round((positives.length / r.length) * 100, 1) : null,
    avgMaxDrawdownPct:
      dd.length > 0 ? round(dd.reduce((a, b) => a + b, 0) / dd.length, 2) : null,
    beatSpyRatePct: spyEval > 0 ? round((spyHits / spyEval) * 100, 1) : null,
    beatQqqRatePct: qqqEval > 0 ? round((qqqHits / qqqEval) * 100, 1) : null,
  };
}

function summarize(
  stocks: BacktestStockResult[],
  buckets: BacktestBucketAgg[],
  spy: WindowReturn,
  qqq: WindowReturn,
): BacktestSummary {
  const tested = stocks.filter((s) => s.returnPct != null);
  const skipped = stocks.filter((s) => s.returnPct == null).length;
  const rs = tested.map((s) => s.returnPct as number);
  const dds = tested
    .map((s) => s.maxDrawdownPct)
    .filter((x): x is number => x != null && Number.isFinite(x));
  const positives = rs.filter((x) => x > 0);
  const spyHits = tested.filter((s) => s.beatSpy === true).length;
  const qqqHits = tested.filter((s) => s.beatQqq === true).length;
  const spyEval = tested.filter((s) => s.beatSpy != null).length;
  const qqqEval = tested.filter((s) => s.beatQqq != null).length;

  let best: ScenarioClassification | null = null;
  let worst: ScenarioClassification | null = null;
  let bestRet = -Infinity;
  let worstRet = Infinity;
  for (const b of buckets) {
    if (b.avgReturnPct == null || b.count === 0) continue;
    if (b.avgReturnPct > bestRet) {
      bestRet = b.avgReturnPct;
      best = b.classification;
    }
    if (b.avgReturnPct < worstRet) {
      worstRet = b.avgReturnPct;
      worst = b.classification;
    }
  }

  return {
    tested: tested.length,
    skipped,
    avgReturnPct:
      rs.length > 0 ? round(rs.reduce((a, b) => a + b, 0) / rs.length, 2) : null,
    medianReturnPct: round(median(rs), 2),
    hitRatePct: rs.length > 0 ? round((positives.length / rs.length) * 100, 1) : null,
    avgMaxDrawdownPct:
      dds.length > 0 ? round(dds.reduce((a, b) => a + b, 0) / dds.length, 2) : null,
    bestBucket: best,
    worstBucket: worst,
    spyReturnPct: round(spy.returnPct, 2),
    qqqReturnPct: round(qqq.returnPct, 2),
    beatSpyRatePct: spyEval > 0 ? round((spyHits / spyEval) * 100, 1) : null,
    beatQqqRatePct: qqqEval > 0 ? round((qqqHits / qqqEval) * 100, 1) : null,
  };
}

async function buildResponse(): Promise<BacktestResponse> {
  // Use the curated universe as it is *today*. Honest framing of this in the
  // limitations array below.
  const picksData = await getStockPicks();
  const picks: StockPick[] = picksData.picks;

  // Benchmarks first — needed to compute beatSpy / beatQqq on each row.
  const [spyBars, qqqBars] = await Promise.all([
    fetchBars(BENCHMARKS.spy),
    fetchBars(BENCHMARKS.qqq),
  ]);
  const spy = computeWindowReturn(spyBars.bars, spyBars.source);
  const qqq = computeWindowReturn(qqqBars.bars, qqqBars.source);

  // Bounded concurrency to be polite to providers and stay under typical
  // rate limits. Picks file is ~100 entries; 6 concurrent matches the picks
  // builder.
  const CONCURRENCY = 6;
  const stocks: BacktestStockResult[] = [];
  for (let i = 0; i < picks.length; i += CONCURRENCY) {
    const slice = picks.slice(i, i + CONCURRENCY);
    const sliceResults = await Promise.all(
      slice.map(async (p): Promise<BacktestStockResult> => {
        const classification = (p.scenarioModel?.classification ??
          p.scenarioPotential) as ScenarioClassification;
        const { bars, source } = await fetchBars(p.ticker);
        const w = computeWindowReturn(bars, source);
        const beatSpy =
          w.returnPct != null && spy.returnPct != null
            ? w.returnPct > spy.returnPct
            : null;
        const beatQqq =
          w.returnPct != null && qqq.returnPct != null
            ? w.returnPct > qqq.returnPct
            : null;
        return {
          ticker: p.ticker,
          companyName: p.companyName,
          themes: p.themes,
          subTheme: p.subTheme ?? null,
          classification,
          entryPrice: round(w.entryPrice, 4),
          entryDate: w.entryDate,
          latestPrice: round(w.latestPrice, 4),
          latestDate: w.latestDate,
          returnPct: round(w.returnPct, 2),
          maxDrawdownPct: round(w.maxDrawdownPct, 2),
          spyReturnPct: round(spy.returnPct, 2),
          qqqReturnPct: round(qqq.returnPct, 2),
          beatSpy,
          beatQqq,
          source: w.source,
          warning: w.warning,
        };
      }),
    );
    stocks.push(...sliceResults);
  }

  const buckets: BacktestBucketAgg[] = ALL_CLASSIFICATIONS.map((c) =>
    aggregateBucket(
      c,
      stocks.filter((s) => s.classification === c),
    ),
  ).filter((b) => b.count > 0);

  const summary = summarize(stocks, buckets, spy, qqq);

  const limitations = [
    "Scenario-label reconstruction, not a point-in-time recommendation audit: the curated universe, scenario classifications (2x/3x/5x/...), and thesis text are today's, not 1 year ago's.",
    "Survivorship bias: any names that may have been on the watchlist a year ago and were later removed are not included.",
    "Look-ahead bias on classification: a name labelled '3x potential' today might not have carried that label a year ago.",
    "Price-only returns; dividends and corporate actions are not modelled.",
    "Newly-listed or thinly-traded names without an entry bar near 365 days ago are skipped (see the per-row warning).",
    "Provider mismatch: pricing comes from the same Massive/Yahoo path the rest of the app uses; transient gaps can show up as missing rows.",
    "Research/education only. Not a track record, performance claim, or recommendation.",
  ];
  const methodology = [
    `1-year price-only reconstruction over ${LOOKBACK_DAYS} calendar days (±${TOLERANCE_DAYS} day tolerance on the entry bar).`,
    `Entry price = nearest trading-day close at or before T-${LOOKBACK_DAYS}. Latest price = most recent close.`,
    `Return % = (latest − entry) / entry × 100. Max drawdown = worst peak-to-trough close-to-low from entry to latest.`,
    `Bucket aggregation groups by current scenario classification (${ALL_CLASSIFICATIONS.join(", ")}).`,
    `Benchmarks: SPY and QQQ over the same window. beatSPY / beatQQQ = stock return > benchmark return.`,
  ].join(" ");

  return {
    asOf: Date.now(),
    lookbackDays: LOOKBACK_DAYS,
    windowStartDate: spy.entryDate ?? qqq.entryDate,
    windowEndDate: spy.latestDate ?? qqq.latestDate,
    benchmark: {
      spy: {
        entryPrice: round(spy.entryPrice, 4),
        latestPrice: round(spy.latestPrice, 4),
        returnPct: round(spy.returnPct, 2),
        entryDate: spy.entryDate,
        latestDate: spy.latestDate,
      },
      qqq: {
        entryPrice: round(qqq.entryPrice, 4),
        latestPrice: round(qqq.latestPrice, 4),
        returnPct: round(qqq.returnPct, 2),
        entryDate: qqq.entryDate,
        latestDate: qqq.latestDate,
      },
    },
    summary,
    buckets,
    stocks,
    limitations,
    methodology,
    disclaimer: DISCLAIMER,
  };
}

export async function getStockPicksBacktest(): Promise<BacktestResponse> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.data;
  const data = await buildResponse();
  cached = { at: now, data };
  return data;
}
