// Deterministic technical indicator calculations from OHLCV bars.

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function lastSma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

// Wilder-style RSI on a series of closes.
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Annualized log-return volatility from the last `period` daily bars (in %).
export function annualizedVolatility(closes: number[], period = 30): number | null {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-period - 1);
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    rets.push(Math.log(slice[i] / slice[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  return sd * Math.sqrt(252) * 100;
}

export function returnPct(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const a = closes[closes.length - 1 - lookback];
  const b = closes[closes.length - 1];
  if (!a || !b) return null;
  return ((b - a) / a) * 100;
}

export function ytdReturn(bars: Bar[]): number | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const lastDate = new Date(last.t);
  const year = lastDate.getUTCFullYear();
  // first bar of the same calendar year
  let firstClose: number | null = null;
  for (const b of bars) {
    const d = new Date(b.t);
    if (d.getUTCFullYear() === year) {
      firstClose = b.c;
      break;
    }
  }
  if (!firstClose) return null;
  return ((last.c - firstClose) / firstClose) * 100;
}

export function high52w(bars: Bar[]): number | null {
  if (!bars.length) return null;
  // ~252 trading days
  const recent = bars.slice(-252);
  return Math.max(...recent.map((b) => b.h));
}

export function low52w(bars: Bar[]): number | null {
  if (!bars.length) return null;
  const recent = bars.slice(-252);
  return Math.min(...recent.map((b) => b.l));
}

export function trendOf(price: number | null, ma: number | null): "up" | "down" | "flat" | null {
  if (price == null || ma == null) return null;
  const diff = (price - ma) / ma;
  if (diff > 0.005) return "up";
  if (diff < -0.005) return "down";
  return "flat";
}

// ---------------------------------------------------------------------------
// Risk / relative indicators — deterministic, computed from price history.
// All functions return `null` when there is not enough history to be honest
// about the result, rather than producing a misleading number.
// ---------------------------------------------------------------------------

/**
 * Maximum peak-to-trough drawdown over the supplied closes, expressed as a
 * negative percentage (e.g. -32.5 means the worst observed loss from a
 * running peak was 32.5%). Returns null for empty input.
 */
export function maxDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) {
      const dd = (c - peak) / peak;
      if (dd < worst) worst = dd;
    }
  }
  return worst * 100;
}

/** Daily log returns from a closes series. */
export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Annualized Sharpe-like ratio (rf assumed 0): mean / sd of daily log
 * returns over the window, multiplied by sqrt(252). `null` if window has
 * fewer than 10 returns or sd is zero.
 */
export function sharpeLike(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null;
  const slice = closes.slice(-window - 1);
  const rets = logReturns(slice);
  if (rets.length < 10) return null;
  const m = mean(rets);
  const v = rets.reduce((a, b) => a + (b - m) * (b - m), 0) / (rets.length - 1);
  const sd = Math.sqrt(v);
  if (!Number.isFinite(sd) || sd === 0) return null;
  return (m / sd) * Math.sqrt(252);
}

/**
 * Align two daily-bar series by timestamp (day-resolution) and return the
 * paired closes. We bucket on UTC calendar day so a Yahoo equity bar at the
 * NYSE close and a CoinGecko crypto bar near UTC midnight on the same day
 * line up. Sorted ascending by timestamp.
 */
export function alignClosesByDay(
  a: { t: number; c: number }[],
  b: { t: number; c: number }[],
): { aCloses: number[]; bCloses: number[] } {
  const dayKey = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const am = new Map<number, number>();
  for (const x of a) am.set(dayKey(x.t), x.c);
  const aCloses: number[] = [];
  const bCloses: number[] = [];
  const seen = new Set<number>();
  for (const x of b) {
    const k = dayKey(x.t);
    if (seen.has(k)) continue; // dedupe in case of intraday duplicates
    const av = am.get(k);
    if (av == null) continue;
    aCloses.push(av);
    bCloses.push(x.c);
    seen.add(k);
  }
  return { aCloses, bCloses };
}

/**
 * Pearson correlation of two series of returns of equal length. Returns
 * null when fewer than 10 paired points or either sd is zero.
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 10) return null;
  const x = xs.slice(-n);
  const y = ys.slice(-n);
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx2 += a * a;
    dy2 += b * b;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (!Number.isFinite(denom) || denom === 0) return null;
  return num / denom;
}

/**
 * OLS slope of asset returns regressed on benchmark returns. Equivalent to
 * cov(asset, bench) / var(bench). Returns null on insufficient data.
 */
export function beta(
  assetReturns: number[],
  benchReturns: number[],
): number | null {
  const n = Math.min(assetReturns.length, benchReturns.length);
  if (n < 10) return null;
  const a = assetReturns.slice(-n);
  const b = benchReturns.slice(-n);
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    varB += db * db;
  }
  if (varB === 0) return null;
  return cov / varB;
}

/**
 * Compute relative metrics of `asset` vs `bench` from raw bars. Aligns by
 * UTC day, computes log returns once, and runs correlation + beta over the
 * trailing windows. `null` is returned for any sub-result that lacks the
 * minimum overlap (10 paired returns).
 */
export interface RelativeMetrics {
  corr30d: number | null;
  corr90d: number | null;
  beta30d: number | null;
  beta90d: number | null;
}

export function relativeMetrics(
  asset: { t: number; c: number }[],
  bench: { t: number; c: number }[],
): RelativeMetrics {
  const aligned = alignClosesByDay(bench, asset); // benchmark first
  const benchRets = logReturns(aligned.aCloses);
  const assetRets = logReturns(aligned.bCloses);
  const tail = (xs: number[], n: number) => xs.slice(-n);
  return {
    corr30d: pearson(tail(assetRets, 30), tail(benchRets, 30)),
    corr90d: pearson(tail(assetRets, 90), tail(benchRets, 90)),
    beta30d: beta(tail(assetRets, 30), tail(benchRets, 30)),
    beta90d: beta(tail(assetRets, 90), tail(benchRets, 90)),
  };
}

/** Total return (%) over the last `lookback` *aligned* bars. */
export function alignedReturnPct(
  closes: number[],
  lookback: number,
): number | null {
  if (closes.length <= lookback) return null;
  const a = closes[closes.length - 1 - lookback];
  const b = closes[closes.length - 1];
  if (!a || !b) return null;
  return ((b - a) / a) * 100;
}

