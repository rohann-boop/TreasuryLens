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
