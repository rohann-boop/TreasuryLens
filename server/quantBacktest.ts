// Quant Score — Backtest v1 (technical-only, multi-window, multi-threshold).
//
// HONEST FRAMING: this validates ONLY the price/technical portion of the quant
// rules. At each decision date (today − window) we compute a technical entry
// signal using nothing but the price history *up to that bar* (price vs 50/200-day
// moving averages, trailing 3-month momentum, and realised volatility). We then
// measure the forward price return to today. We deliberately exclude fundamentals
// and analyst consensus because those are only available as today's snapshot and
// would inject look-ahead bias.
//
// Backtest v1 adds:
//   • multiple evaluation windows (3M / 6M / 1Y / 2Y where data exists), each
//     with its own point-in-time decision date;
//   • multiple threshold cohorts within each window (score ≥70 / ≥60 / ≥50 plus
//     a top-quintile-vs-rest split) so a stricter filter can be compared to a
//     looser one;
//   • structured per-window/threshold metrics: sample size, selected count,
//     average selected/rest/benchmark return, excess return, hit rate, and the
//     selected cohort's max drawdown.
//
// What this answers: "would a simple price-trend filter, applied N months ago,
// have selected names that subsequently outperformed the rest of the universe
// and the benchmark?" It is a directional sanity check on the technical factor,
// NOT a validation of the full quant score and NOT a track record.

import type {
  QuantBacktestResponse,
  QuantBacktestRow,
  QuantBacktestSummary,
  QuantBacktestWindow,
  QuantBacktestThresholdResult,
  QuantBacktestVerdict,
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
  QUANT_BACKTEST_WINDOWS,
  QUANT_BACKTEST_SCORE_BANDS,
} from "./quantBacktestMeta";

const TOLERANCE_DAYS = 21;
const TTL_MS = 30 * 60 * 1000;
const BENCHMARK = "SPY";
const CONCURRENCY = 6;
// Pull enough history to support the deepest window (2Y forward) plus ~200
// trading days of prior history needed to score the signal at that decision date.
const HISTORY_DAYS = 1140; // ~3.1 years
// A window is considered "available" when at least this many names could be
// scored at its decision date.
const MIN_EVALUATED_FOR_WINDOW = 5;
// Top-cohort split: best ~20% of scored names vs. the rest.
const TOP_COHORT_FRACTION = 0.2;

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

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

// Index of the last bar at or before targetMs, within a tolerance. Returns null
// when there is no bar close enough (e.g. the series starts after targetMs).
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

// Max peak-to-trough drawdown (%) over bars[startIdx..endIdx], inclusive.
function maxDrawdownBetween(
  bars: Bar[],
  startIdx: number,
  endIdx: number,
): number | null {
  let peak: number | null = null;
  let maxDD: number | null = null;
  for (let i = startIdx; i <= endIdx && i < bars.length; i++) {
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
  const closes = bars
    .slice(0, entryIdx + 1)
    .map((b) => b.c)
    .filter((c) => Number.isFinite(c) && c > 0);
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
  const massive = await fetchMassiveChart(ticker, HISTORY_DAYS);
  if (massive && massive.length > 0) return massive;
  // Yahoo's range param caps our depth; request the widest range so the deep
  // (2Y) window can find a decision bar when Massive is unavailable.
  const yahoo = await fetchYahooChart(ticker, "5y");
  if (yahoo && yahoo.length > 0) return yahoo;
  return null;
}

// Per-window evaluation of a single ticker's bars.
interface WindowEval {
  entrySignal: number | null;
  forwardReturnPct: number | null;
  maxDrawdownPct: number | null;
  decisionDate: string | null;
  asOfDate: string | null;
}

// Compute the point-in-time signal + forward return for one window from a single
// ticker's full bar history. Returns null fields when the window can't be
// honoured (insufficient depth at the decision date).
function evalWindow(bars: Bar[] | null, lookbackDays: number): WindowEval {
  const empty: WindowEval = {
    entrySignal: null,
    forwardReturnPct: null,
    maxDrawdownPct: null,
    decisionDate: null,
    asOfDate: null,
  };
  if (!bars || bars.length === 0) return empty;
  const last = bars[bars.length - 1];
  if (!Number.isFinite(last.c) || last.c <= 0) return empty;
  const targetMs = last.t - lookbackDays * 86400000;
  const entryIdx = indexAtOrBefore(bars, targetMs);
  if (entryIdx == null) return { ...empty, asOfDate: isoDate(last.t) };
  const entryBar = bars[entryIdx];
  if (!Number.isFinite(entryBar.c) || entryBar.c <= 0) {
    return { ...empty, asOfDate: isoDate(last.t) };
  }
  const entrySignal = technicalEntrySignal(bars, entryIdx);
  const forwardReturnPct = ((last.c - entryBar.c) / entryBar.c) * 100;
  const maxDrawdownPct = maxDrawdownBetween(bars, entryIdx, bars.length - 1);
  return {
    entrySignal,
    forwardReturnPct,
    maxDrawdownPct,
    decisionDate: isoDate(entryBar.t),
    asOfDate: isoDate(last.t),
  };
}

// Holds every window's evaluation for one ticker.
interface TickerResult {
  ticker: string;
  companyName: string | null;
  hasBars: boolean;
  byWindow: Map<string, WindowEval>;
}

function verdictFor(
  excessVsRest: number | null,
  excessVsBench: number | null,
  selectedCount: number,
): QuantBacktestVerdict {
  if (selectedCount < 3) return "insufficient";
  const signals = [excessVsRest, excessVsBench].filter(
    (x): x is number => x != null,
  );
  if (signals.length === 0) return "insufficient";
  const positive = signals.filter((x) => x > 0.5).length;
  const negative = signals.filter((x) => x < -0.5).length;
  if (positive === signals.length) return "edge";
  if (negative === signals.length) return "no-edge";
  return "mixed";
}

// Build one threshold/cohort result from the scored names of a single window.
function buildThreshold(
  key: string,
  label: string,
  kind: "band" | "cohort",
  minScore: number | null,
  selected: { ret: number; dd: number | null }[],
  rest: { ret: number }[],
  benchmarkReturnPct: number | null,
): QuantBacktestThresholdResult {
  const selRet = selected.map((s) => s.ret);
  const restRet = rest.map((r) => r.ret);
  const selectedAvg = avg(selRet);
  const restAvg = avg(restRet);
  const positives = selRet.filter((x) => x > 0).length;
  const dds = selected
    .map((s) => s.dd)
    .filter((d): d is number => d != null);
  const excessVsRest =
    selectedAvg != null && restAvg != null ? selectedAvg - restAvg : null;
  const excessVsBench =
    selectedAvg != null && benchmarkReturnPct != null
      ? selectedAvg - benchmarkReturnPct
      : null;
  return {
    key,
    label,
    kind,
    minScore,
    selectedCount: selected.length,
    restCount: rest.length,
    selectedAvgReturnPct: round(selectedAvg, 2),
    restAvgReturnPct: round(restAvg, 2),
    excessVsRestPct: round(excessVsRest, 2),
    excessVsBenchmarkPct: round(excessVsBench, 2),
    hitRatePct:
      selRet.length > 0 ? round((positives / selRet.length) * 100, 1) : null,
    selectedMaxDrawdownPct: dds.length ? round(Math.min(...dds), 2) : null,
    verdict: verdictFor(excessVsRest, excessVsBench, selected.length),
  };
}

// Scored entry for one name within one window.
interface Scored {
  score: number;
  ret: number;
  dd: number | null;
}

function buildWindow(
  windowKey: string,
  windowLabel: string,
  lookbackDays: number,
  results: TickerResult[],
  benchmarkReturnPct: number | null,
): QuantBacktestWindow {
  const scored: Scored[] = [];
  let withBarsButNoDepth = 0;
  let decisionDate: string | null = null;
  let asOfDate: string | null = null;

  for (const r of results) {
    const w = r.byWindow.get(windowKey);
    if (!w) continue;
    if (w.decisionDate && !decisionDate) decisionDate = w.decisionDate;
    if (w.asOfDate && !asOfDate) asOfDate = w.asOfDate;
    if (
      w.entrySignal != null &&
      w.forwardReturnPct != null &&
      Number.isFinite(w.forwardReturnPct)
    ) {
      scored.push({
        score: w.entrySignal,
        ret: w.forwardReturnPct,
        dd: w.maxDrawdownPct,
      });
    } else if (r.hasBars) {
      withBarsButNoDepth++;
    }
  }

  const evaluated = scored.length;
  const available = evaluated >= MIN_EVALUATED_FOR_WINDOW;

  const thresholds: QuantBacktestThresholdResult[] = [];
  if (available) {
    // Score-band cohorts: name clears band when score ≥ minScore.
    for (const min of QUANT_BACKTEST_SCORE_BANDS) {
      const selected = scored.filter((s) => s.score >= min);
      const rest = scored.filter((s) => s.score < min);
      thresholds.push(
        buildThreshold(
          `score>=${min}`,
          `Score ≥ ${min}`,
          "band",
          min,
          selected.map((s) => ({ ret: s.ret, dd: s.dd })),
          rest.map((s) => ({ ret: s.ret })),
          benchmarkReturnPct,
        ),
      );
    }
    // Top-cohort split: best ~20% by score vs. the rest.
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const topN = Math.max(1, Math.round(sorted.length * TOP_COHORT_FRACTION));
    const top = sorted.slice(0, topN);
    const bottom = sorted.slice(topN);
    thresholds.push(
      buildThreshold(
        "top-cohort",
        `Top ${Math.round(TOP_COHORT_FRACTION * 100)}% vs rest`,
        "cohort",
        null,
        top.map((s) => ({ ret: s.ret, dd: s.dd })),
        bottom.map((s) => ({ ret: s.ret })),
        benchmarkReturnPct,
      ),
    );
  }

  const status = available
    ? `${evaluated} names scored at the ${windowLabel} decision date (${decisionDate ?? "?"}). Technical-only, point-in-time.`
    : `Unavailable: only ${evaluated} name(s) had enough price history at the ${windowLabel} decision date (need ≥ ${MIN_EVALUATED_FOR_WINDOW}).`;

  return {
    key: windowKey,
    label: windowLabel,
    lookbackDays,
    available,
    decisionDate,
    asOfDate,
    evaluated,
    skipped: withBarsButNoDepth,
    benchmarkReturnPct: round(benchmarkReturnPct, 2),
    thresholds,
    status,
  };
}

// Derive the legacy single-window summary + rows from the 1Y window so existing
// consumers (and the embedded quant-score status) keep working.
function legacyView(
  results: TickerResult[],
  benchmarkReturnPct: number | null,
): { summary: QuantBacktestSummary; rows: QuantBacktestRow[] } {
  const rows: QuantBacktestRow[] = results.map((r) => {
    const w = r.byWindow.get("1Y");
    const entrySignal = w?.entrySignal ?? null;
    const selected =
      entrySignal != null && entrySignal >= QUANT_BACKTEST_THRESHOLD;
    return {
      ticker: r.ticker,
      companyName: r.companyName,
      entrySignal,
      selected,
      entryPrice: null,
      entryDate: w?.decisionDate ?? null,
      latestPrice: null,
      latestDate: w?.asOfDate ?? null,
      forwardReturnPct: round(w?.forwardReturnPct ?? null, 2),
      maxDrawdownPct: round(w?.maxDrawdownPct ?? null, 2),
      source: r.hasBars ? "price" : "unavailable",
      warning:
        entrySignal == null
          ? "Not enough history at the 1Y decision bar to score the technical signal."
          : null,
    };
  });

  const evaluatedRows = rows.filter(
    (r) => r.entrySignal != null && r.forwardReturnPct != null,
  );
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
      : selected.filter((r) => (r.forwardReturnPct as number) > benchmarkReturnPct)
          .length;

  const summary: QuantBacktestSummary = {
    selectedCount: selected.length,
    restCount: rest.length,
    evaluated: evaluatedRows.length,
    skipped: rows.length - evaluatedRows.length,
    selectedAvgReturnPct: round(selectedAvg, 2),
    restAvgReturnPct: round(restAvg, 2),
    edgePct:
      selectedAvg != null && restAvg != null
        ? round(selectedAvg - restAvg, 2)
        : null,
    selectedHitRatePct:
      selRet.length > 0 ? round((positives.length / selRet.length) * 100, 1) : null,
    benchmarkReturnPct: round(benchmarkReturnPct, 2),
    selectedBeatBenchmarkPct:
      beatBench != null && selected.length > 0
        ? round((beatBench / selected.length) * 100, 1)
        : null,
  };

  return { summary, rows };
}

async function buildResponse(): Promise<QuantBacktestResponse> {
  const picksData = await getStockPicks();
  const picks: StockPick[] = picksData.picks;

  // Benchmark bars (fetched once) → forward return per window.
  const benchBars = await fetchBars(BENCHMARK);
  const benchByWindow = new Map<string, number | null>();
  for (const w of QUANT_BACKTEST_WINDOWS) {
    benchByWindow.set(w.key, evalWindow(benchBars, w.days).forwardReturnPct);
  }

  // Evaluate every name across all windows from a single bar fetch.
  const results: TickerResult[] = [];
  for (let i = 0; i < picks.length; i += CONCURRENCY) {
    const slice = picks.slice(i, i + CONCURRENCY);
    const sliceResults = await Promise.all(
      slice.map(async (p): Promise<TickerResult> => {
        const bars = await fetchBars(p.ticker);
        const byWindow = new Map<string, WindowEval>();
        for (const w of QUANT_BACKTEST_WINDOWS) {
          byWindow.set(w.key, evalWindow(bars, w.days));
        }
        return {
          ticker: p.ticker,
          companyName: p.companyName,
          hasBars: !!bars,
          byWindow,
        };
      }),
    );
    results.push(...sliceResults);
  }

  const windows: QuantBacktestWindow[] = QUANT_BACKTEST_WINDOWS.map((w) =>
    buildWindow(w.key, w.label, w.days, results, benchByWindow.get(w.key) ?? null),
  );

  const { summary, rows } = legacyView(
    results,
    benchByWindow.get("1Y") ?? null,
  );

  const tested = windows.some((w) => w.available);

  const methodology = [
    `Backtest v1 — technical-only, point-in-time across ${QUANT_BACKTEST_WINDOWS.map((w) => w.key).join(" / ")} windows (±${TOLERANCE_DAYS} day tolerance on each decision bar).`,
    `At each window's decision date (today − window) we score a 0-100 technical signal using ONLY price history available before that bar: price vs 50/200-day moving averages, trailing 3-month momentum, and 30-day realised volatility.`,
    `Within every window we report score bands (≥${QUANT_BACKTEST_SCORE_BANDS.join(", ≥")}) and a top-${Math.round(TOP_COHORT_FRACTION * 100)}%-vs-rest cohort. Forward return = (latest close − decision close) / decision close × 100; excess = selected avg − rest/benchmark. Benchmark = ${BENCHMARK} over the same window.`,
  ].join(" ");

  const limitations = [
    "Technical-only: fundamentals and analyst consensus are deliberately excluded to avoid look-ahead, so this does NOT validate the full quant score.",
    "Universe look-ahead/survivorship: the tested names are today's curated universe, not the universe as it stood at each decision date.",
    "Overlapping windows share recent price action; they are correlated, not independent out-of-sample tests.",
    "Price-only returns; dividends and corporate actions are not modelled.",
    "The moving-average/momentum thresholds are fixed heuristics, not fitted parameters.",
    "Deeper windows (2Y) may be unavailable when the data source lacks history for most names; such windows are flagged unavailable rather than estimated.",
    "Research/education only. Not a track record, performance claim, or recommendation.",
  ];

  const oneYear = windows.find((w) => w.key === "1Y");

  return {
    asOf: Date.now(),
    tested,
    methodId: QUANT_BACKTEST_METHOD_ID,
    lookbackDays: QUANT_BACKTEST_LOOKBACK_DAYS,
    thresholdScore: QUANT_BACKTEST_THRESHOLD,
    windowStartDate: oneYear?.decisionDate ?? null,
    windowEndDate: oneYear?.asOfDate ?? null,
    benchmarkSymbol: BENCHMARK,
    summary,
    rows,
    windows,
    technicalOnly: true,
    validationBadge: "Technical-only",
    universeSize: picks.length,
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
