// Shared constants for the technical-only quant backtest. Kept in their own
// module so both quantScore.ts and quantBacktest.ts can reference the method id
// without importing each other.

export const QUANT_BACKTEST_METHOD_ID = "quant-technical-v1";

// Headline window used by compact summaries / the embedded quant-score status.
export const QUANT_BACKTEST_LOOKBACK_DAYS = 365;

// Entry signal at/above this 0-100 score puts a name in the legacy single-window
// "selected" cohort. The multi-window engine reports several bands instead.
export const QUANT_BACKTEST_THRESHOLD = 58;

// Backtest v1 evaluation windows. Each `days` value is the calendar lookback
// from today to the decision date; the forward return is measured from the
// decision date to the latest bar. Ordered short → long.
export const QUANT_BACKTEST_WINDOWS: ReadonlyArray<{
  key: string;
  label: string;
  days: number;
}> = [
  { key: "3M", label: "3 months", days: 91 },
  { key: "6M", label: "6 months", days: 182 },
  { key: "1Y", label: "1 year", days: 365 },
  { key: "2Y", label: "2 years", days: 730 },
];

// Score bands evaluated within every window. A name "clears" a band when its
// point-in-time technical entry signal is ≥ the band's minimum.
export const QUANT_BACKTEST_SCORE_BANDS: ReadonlyArray<number> = [70, 60, 50];
