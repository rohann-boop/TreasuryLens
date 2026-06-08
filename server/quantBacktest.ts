// Quant Score — technical-only backtest (point-in-time-ish).
//
// HONEST FRAMING: this validates ONLY the price/technical portion of the quant
// rules. At a bar ~1 year ago we compute a technical entry signal using nothing
// but the price history *up to that bar* (price vs 50/200-day moving averages,
// trailing 3-month momentum, and realised volatility). We then measure the
// forward price return to today. We deliberately exclude fundamentals and
// analyst consensus because those are only available as today's snapshot and
// would inject look-ahead bias.
//
// What this answers: "would a simple price-trend filter, applied a year ago,
// have selected names that subsequently outperformed the rest of the universe
// and the benchmark?" It is a directional sanity check on the technical factor,
// NOT a validation of the full quant score and NOT a track record.

import type {
  QuantBacktestResponse,
  QuantBacktestRow,
  QuantBacktestSummary,
  StockPick,
} from "@shared/schema";
import type { Bar } from "./indicators";
import { lastSma, annualizedVolatility } from "./indicators";
import { fetchMassiveChart, fetchYahooChart } from "./marketData";
import { getStockPicks } from "./stockPicks";
import {
  QUANT_BACKTEST_METHOD_ID,
  QUANT_BACKTEST_LOOKBACK_DAYS,
  QUANT_BACKTEST_THRESHOLD,
} from "./quantBacktestMeta";

const TOLERANCE_DAYS = 21;
const TTL_MS = 30 * 60 * 1000;
const BENCHMARK = "SPY";
const CONCURRENCY = 6;

const DISCLAIMER =
  "Research/education only. Technical-only reconstruction of the price/momentum portion of the quant rules. Not a validation of the full quant score, a track record, or a recommendation.";

interface CacheEntry {
  at: number;
  data: QuantBacktestResponse;
}
let cached: CacheEntry | null = null;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function round(n: number | null, digits = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function indexAtOrBefore(bars: Bar[], targetMs: number): number | null {
  const toleranceMs = TOLERANCE_DAYS * 86400000;
  let best = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].t <= targetMs) best = i;
    else break;
  }
  if (best < 0) return null;
  if (targetMs - bars[best].t > toleranceMs * 3) return null;
  return best;
}

function maxDrawdownFrom(bars: Bar[], startIdx: number): number | null {
  let peak: number | null = null;
  let maxDD: number | null = null;
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    if (!Number.isFinite(b.c) || b.c <= 0) continue;
    if (peak == null || b.c > peak) peak = b.c;
    const low = Number.isFinite(b.l) && b.l > 0 ? b.l : b.c;
    if (peak != null && peak > 0) {
      const dd = (low - peak) / peak;
      if (maxDD == null || dd < maxDD) maxDD = dd;
    }
  }
  return maxDD == null ? null : maxDD * 100;
}

// Technical-only entry signal (0-100) computed using ONLY bars[0..entryIdx].
// Mirrors the momentum/trend + risk spirit of the quant score without any
// fundamental/analyst look-ahead. Returns null when there is not enough history
// at the entry bar to read a trend honestly.
function technicalEntrySignal(bars: Bar[], entryIdx: number): number | null {
  const closes = bars.slice(0, entryIdx + 1).map((b) => b.c).filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length < 60) return null; // need ~3 months minimum
  const price = closes[closes.length - 1];
  const sma50 = lastSma(closes, 50);
  const sma200 = closes.length >= 200 ? lastSma(closes, 200) : null;

  const parts: number[] = [];

  // Trend vs 50D MA: above = constructive, scaled by distance (±10% → ±25pts).
  if (sma50 != null && sma50 > 0) {
    const gap = (price - sma50) / sma50;
    parts.push(clamp(50 + gap * 250));
  }
  // Trend vs 200D MA (long-term): above the 200D is a classic regime filter.
  if (sma200 != null && sma200 > 0) {
    const gap = (price - sma200) / sma200;
    parts.push(clamp(50 + gap * 150));
  }
  // Trailing 3-month (~63 trading day) momentum.
  if (closes.length > 63) {
    const past = closes[closes.length - 1 - 63];
    if (past > 0) {
      const mom = ((price - past) / past) * 100;
      parts.push(clamp(50 + mom * 1.2));
    }
  }
  // Volatility penalty: calmer = better. ~20% vol ≈ neutral, 60%+ ≈ penalised.
  const vol = annualizedVolatility(closes, 30);
  if (vol != null) {
    parts.push(clamp(100 - (vol - 20) * 1.1));
  }

  if (parts.length < 2) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

async function fetchBars(ticker: string): Promise<Bar[] | null> {
  const massive = await fetchMassiveChart(ticker);
  if (massive && massive.length > 0) return massive;
  const yahoo = await fetchYahooChart(ticker);
  if (yahoo && yahoo.length > 0) return yahoo;
  return null;
}

interface Computed {
  entrySignal: number | null;
  entryPrice: number | null;
  entryDate: string | null;
  latestPrice: number | null;
  latestDate: string | null;
  forwardReturnPct: number | null;
  maxDrawdownPct: number | null;
  warning: string | null;
}

function computeForTicker(bars: Bar[] | null): Computed {
  const empty: Computed = {
    entrySignal: null,
    entryPrice: null,
    entryDate: null,
    latestPrice: null,
    latestDate: null,
    forwardReturnPct: null,
    maxDrawdownPct: null,
    warning: null,
  };
  if (!bars || bars.length === 0) return { ...empty, warning: "No historical bars." };
  const last = bars[bars.length - 1];
  if (!Number.isFinite(last.c) || last.c <= 0) return { ...empty, warning: "Latest bar invalid." };
  const targetMs = last.t - QUANT_BACKTEST_LOOKBACK_DAYS * 86400000;
  const entryIdx = indexAtOrBefore(bars, targetMs);
  if (entryIdx == null) {
    return {
      ...empty,
      latestPrice: last.c,
      latestDate: isoDate(last.t),
      warning: "No entry bar near 1 year ago (insufficient history).",
    };
  }
  const entryBar = bars[entryIdx];
  if (!Number.isFinite(entryBar.c) || entryBar.c <= 0) {
    return { ...empty, latestPrice: last.c, latestDate: isoDate(last.t), warning: "Entry bar invalid." };
  }
  const entrySignal = technicalEntrySignal(bars, entryIdx);
  const forwardReturnPct = ((last.c - entryBar.c) / entryBar.c) * 100;
  const maxDrawdownPct = maxDrawdownFrom(bars, entryIdx);
  return {
    entrySignal,
    entryPrice: entryBar.c,
    entryDate: isoDate(entryBar.t),
    latestPrice: last.c,
    latestDate: isoDate(last.t),
    forwardReturnPct,
    maxDrawdownPct,
    warning: entrySignal == null ? "Not enough history at entry bar to score the technical signal." : null,
  };
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function summarize(rows: QuantBacktestRow[], benchmarkReturnPct: number | null): QuantBacktestSummary {
  const evaluatedRows = rows.filter((r) => r.entrySignal != null && r.forwardReturnPct != null);
  const selected = evaluatedRows.filter((r) => r.selected);
  const rest = evaluatedRows.filter((r) => !r.selected);
  const selRet = selected.map((r) => r.forwardReturnPct as number);
  const restRet = rest.map((r) => r.forwardReturnPct as number);
  const selectedAvg = avg(selRet);
  const restAvg = avg(restRet);
  const positives = selRet.filter((x) => x > 0);
  const beatBench =
    benchmarkReturnPct == null
      ? null
      : selected.filter((r) => (r.forwardReturnPct as number) > benchmarkReturnPct).length;
  return {
    selectedCount: selected.length,
    restCount: rest.length,
    evaluated: evaluatedRows.length,
    skipped: rows.length - evaluatedRows.length,
    selectedAvgReturnPct: round(selectedAvg, 2),
    restAvgReturnPct: round(restAvg, 2),
    edgePct:
      selectedAvg != null && restAvg != null ? round(selectedAvg - restAvg, 2) : null,
    selectedHitRatePct:
      selRet.length > 0 ? round((positives.length / selRet.length) * 100, 1) : null,
    benchmarkReturnPct: round(benchmarkReturnPct, 2),
    selectedBeatBenchmarkPct:
      beatBench != null && selected.length > 0
        ? round((beatBench / selected.length) * 100, 1)
        : null,
  };
}

async function buildResponse(): Promise<QuantBacktestResponse> {
  const picksData = await getStockPicks();
  const picks: StockPick[] = picksData.picks;

  const benchBars = await fetchBars(BENCHMARK);
  const bench = computeForTicker(benchBars);
  const benchmarkReturnPct = bench.forwardReturnPct;

  const rows: QuantBacktestRow[] = [];
  for (let i = 0; i < picks.length; i += CONCURRENCY) {
    const slice = picks.slice(i, i + CONCURRENCY);
    const sliceResults = await Promise.all(
      slice.map(async (p): Promise<QuantBacktestRow> => {
        const bars = await fetchBars(p.ticker);
        const c = computeForTicker(bars);
        const selected = c.entrySignal != null && c.entrySignal >= QUANT_BACKTEST_THRESHOLD;
        return {
          ticker: p.ticker,
          companyName: p.companyName,
          entrySignal: c.entrySignal,
          selected,
          entryPrice: round(c.entryPrice, 4),
          entryDate: c.entryDate,
          latestPrice: round(c.latestPrice, 4),
          latestDate: c.latestDate,
          forwardReturnPct: round(c.forwardReturnPct, 2),
          maxDrawdownPct: round(c.maxDrawdownPct, 2),
          source: bars ? "price" : "unavailable",
          warning: c.warning,
        };
      }),
    );
    rows.push(...sliceResults);
  }

  const summary = summarize(rows, benchmarkReturnPct);

  const methodology = [
    `Technical-only point-in-time-ish backtest over ${QUANT_BACKTEST_LOOKBACK_DAYS} calendar days (±${TOLERANCE_DAYS} day tolerance on the entry bar).`,
    `At the entry bar we score a 0-100 technical signal using ONLY prior price history: price vs 50/200-day moving averages, trailing 3-month momentum, and 30-day realised volatility.`,
    `Names with an entry signal ≥ ${QUANT_BACKTEST_THRESHOLD} form the "selected" cohort; the rest form the comparison cohort.`,
    `Forward return = (latest close − entry close) / entry close × 100. Edge = selected avg − rest avg. Benchmark = ${BENCHMARK} over the same window.`,
  ].join(" ");

  const limitations = [
    "Technical-only: fundamentals and analyst consensus are deliberately excluded to avoid look-ahead, so this does NOT validate the full quant score.",
    "Universe look-ahead/survivorship: the tested names are today's curated universe, not the universe as it stood a year ago.",
    "Single window (1 year): one overlapping window is not a statistically robust out-of-sample test.",
    "Price-only returns; dividends and corporate actions are not modelled.",
    "The moving-average/momentum thresholds are fixed heuristics, not fitted parameters.",
    "Newly-listed or thinly-traded names without enough history at the entry bar are skipped.",
    "Research/education only. Not a track record, performance claim, or recommendation.",
  ];

  return {
    asOf: Date.now(),
    tested: summary.evaluated > 0,
    methodId: QUANT_BACKTEST_METHOD_ID,
    lookbackDays: QUANT_BACKTEST_LOOKBACK_DAYS,
    thresholdScore: QUANT_BACKTEST_THRESHOLD,
    windowStartDate: bench.entryDate,
    windowEndDate: bench.latestDate,
    benchmarkSymbol: BENCHMARK,
    summary,
    rows,
    methodology,
    limitations,
    disclaimer: DISCLAIMER,
  };
}

export async function getQuantBacktest(): Promise<QuantBacktestResponse> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.data;
  const data = await buildResponse();
  cached = { at: now, data };
  return data;
}
