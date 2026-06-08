// Shared constants for the technical-only quant backtest. Kept in their own
// module so both quantScore.ts and quantBacktest.ts can reference the method id
// without importing each other.

export const QUANT_BACKTEST_METHOD_ID = "quant-technical-v1";
export const QUANT_BACKTEST_LOOKBACK_DAYS = 365;
// Entry signal at/above this 0-100 score puts a name in the "selected" cohort.
export const QUANT_BACKTEST_THRESHOLD = 58;
