// Market data fetching from public, no-auth endpoints.
// Primary: Yahoo Finance chart API. Fallback: CoinGecko (BTC only).
// Always returns a structured snapshot with `status` indicating live/demo/error.

import type { Bar } from "./indicators";
import {
  annualizedVolatility,
  high52w,
  lastSma,
  low52w,
  returnPct,
  rsi,
  trendOf,
  ytdReturn,
} from "./indicators";
import type { Instrument, InstrumentSnapshot } from "@shared/schema";

const YAHOO_HEADERS = {
  // Yahoo blocks empty UA in some regions
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

interface YahooChart {
  chart: {
    result?: Array<{
      meta: {
        currency: string;
        symbol: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
        regularMarketVolume?: number;
      };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

interface YahooQuote {
  quoteResponse: {
    result: Array<{
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      regularMarketVolume?: number;
      averageDailyVolume3Month?: number;
      averageDailyVolume10Day?: number;
      marketCap?: number;
      currency?: string;
      symbol?: string;
    }>;
    error?: unknown;
  };
}

async function fetchYahooChartFromHost(
  host: string,
  symbol: string,
): Promise<Bar[] | null> {
  try {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?range=2y&interval=1d`;
    const r = await fetch(url, { headers: YAHOO_HEADERS });
    if (!r.ok) return null;
    const j = (await r.json()) as YahooChart;
    const result = j.chart.result?.[0];
    if (!result) return null;
    const ts = result.timestamp ?? [];
    const q = result.indicators.quote?.[0];
    if (!q) return null;
    const bars: Bar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      const v = q.volume?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({
        t: ts[i] * 1000,
        o,
        h,
        l,
        c,
        v: v ?? 0,
      });
    }
    return bars;
  } catch {
    return null;
  }
}

export async function fetchYahooChart(symbol: string): Promise<Bar[] | null> {
  // Try both Yahoo hosts (sometimes one rate-limits while the other works).
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (const h of hosts) {
    const bars = await fetchYahooChartFromHost(h, symbol);
    if (bars && bars.length) return bars;
  }
  return null;
}

export async function fetchYahooQuote(symbol: string) {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (const host of hosts) {
    try {
      const url = `https://${host}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
      const r = await fetch(url, { headers: YAHOO_HEADERS });
      if (!r.ok) continue;
      const j = (await r.json()) as YahooQuote;
      const item = j.quoteResponse?.result?.[0];
      if (item) return item;
    } catch {}
  }
  return null;
}

// CoinGecko fallback (BTC market data, dominance)
async function fetchCoinGeckoBtc(): Promise<{
  bars: Bar[];
  marketCap: number | null;
  dominance: number | null;
} | null> {
  try {
    // 365 days of daily prices
    const r = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily",
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      prices: [number, number][];
      total_volumes?: [number, number][];
      market_caps?: [number, number][];
    };
    const bars: Bar[] = j.prices.map(([t, c], i) => ({
      t,
      o: c,
      h: c,
      l: c,
      c,
      v: j.total_volumes?.[i]?.[1] ?? 0,
    }));
    const marketCap = j.market_caps?.length
      ? j.market_caps[j.market_caps.length - 1][1]
      : null;

    // dominance
    let dominance: number | null = null;
    try {
      const g = await fetch("https://api.coingecko.com/api/v3/global");
      if (g.ok) {
        const gj = (await g.json()) as {
          data: { market_cap_percentage: { btc?: number } };
        };
        dominance = gj.data.market_cap_percentage.btc ?? null;
      }
    } catch {}

    return { bars, marketCap, dominance };
  } catch {
    return null;
  }
}

// Deterministic seeded demo data for graceful failure UI
function seededDemoBars(seed: number, base: number, days = 400): Bar[] {
  const bars: Bar[] = [];
  let price = base;
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 0x100000000;
    return s / 0x100000000;
  };
  const now = Date.now();
  const dayMs = 86400000;
  for (let i = days - 1; i >= 0; i--) {
    const r = (rand() - 0.48) * 0.04;
    price = price * (1 + r);
    const o = price * (1 + (rand() - 0.5) * 0.005);
    const h = price * (1 + rand() * 0.01);
    const l = price * (1 - rand() * 0.01);
    bars.push({
      t: now - i * dayMs,
      o,
      h,
      l,
      c: price,
      v: Math.floor(rand() * 1e7),
    });
  }
  return bars;
}

export async function buildSnapshot(
  instrument: Instrument,
): Promise<InstrumentSnapshot> {
  let bars: Bar[] | null = null;
  let status: "live" | "demo" | "error" = "live";
  let source = instrument.dataSource;
  let marketCap: number | null = null;
  let volume: number | null = null;
  let avgVolume: number | null = null;
  let currency = instrument.quoteCurrency;
  let prevClose: number | null = null;
  let btcDominance: number | null = null;
  let message: string | undefined;

  if (instrument.dataSource === "coingecko" || instrument.symbol === "BTC-USD") {
    // try Yahoo first when symbol is yahoo-compatible, else coingecko
    if (instrument.dataSource !== "coingecko") {
      bars = await fetchYahooChart(instrument.symbol);
      if (bars && bars.length) source = "yahoo";
    }
    if (!bars || !bars.length) {
      const cg = await fetchCoinGeckoBtc();
      if (cg) {
        bars = cg.bars;
        marketCap = cg.marketCap;
        btcDominance = cg.dominance;
        source = "coingecko";
      }
    } else {
      // also fetch CoinGecko dominance for BTC
      try {
        const g = await fetch("https://api.coingecko.com/api/v3/global");
        if (g.ok) {
          const gj = (await g.json()) as {
            data: { market_cap_percentage: { btc?: number } };
          };
          btcDominance = gj.data.market_cap_percentage.btc ?? null;
        }
      } catch {}
    }
  } else {
    bars = await fetchYahooChart(instrument.symbol);
    source = "yahoo";
  }

  // Yahoo quote for marketCap + volume (where available)
  if (instrument.dataSource === "yahoo" || source === "yahoo") {
    const q = await fetchYahooQuote(instrument.symbol);
    if (q) {
      if (q.marketCap != null) marketCap = q.marketCap;
      if (q.regularMarketVolume != null) volume = q.regularMarketVolume;
      if (q.averageDailyVolume3Month != null)
        avgVolume = q.averageDailyVolume3Month;
      if (q.currency) currency = q.currency;
    }
  }

  if (!bars || bars.length < 5) {
    status = "demo";
    message = "Live data unavailable — showing seeded demo series.";
    const seed =
      Array.from(instrument.symbol).reduce((a, c) => a + c.charCodeAt(0), 0) +
      instrument.id;
    const base = instrument.assetClass === "crypto" ? 60000 : 100;
    bars = seededDemoBars(seed, base);
    source = "demo";
  }

  const closes = bars.map((b) => b.c);
  const last = bars[bars.length - 1];
  const price = last.c;
  prevClose = bars.length >= 2 ? bars[bars.length - 2].c : null;
  if (volume == null) volume = last.v;
  if (avgVolume == null) {
    const vs = bars.slice(-30).map((b) => b.v);
    if (vs.length) avgVolume = vs.reduce((a, b) => a + b, 0) / vs.length;
  }

  const change1d =
    prevClose != null ? price - prevClose : null;
  const changePct1d =
    prevClose != null && prevClose !== 0
      ? ((price - prevClose) / prevClose) * 100
      : null;

  const sma20v = lastSma(closes, 20);
  const sma50v = lastSma(closes, 50);
  const sma200v = lastSma(closes, 200);

  const hi52 = high52w(bars);
  const lo52 = low52w(bars);
  const distHi =
    hi52 != null && price ? ((price - hi52) / hi52) * 100 : null;

  return {
    instrument,
    status,
    source,
    asOf: Date.now(),
    price,
    prevClose,
    currency,
    change1d,
    changePct1d,
    return7d: returnPct(closes, 7),
    return30d: returnPct(closes, 30),
    returnYtd: ytdReturn(bars),
    sma20: sma20v,
    sma50: sma50v,
    sma200: sma200v,
    sma20Trend: trendOf(price, sma20v),
    sma50Trend: trendOf(price, sma50v),
    sma200Trend: trendOf(price, sma200v),
    rsi14: rsi(closes, 14),
    vol30dAnnualized: annualizedVolatility(closes, 30),
    high52w: hi52,
    low52w: lo52,
    distFrom52wHigh: distHi,
    volume,
    avgVolume,
    marketCap,
    btcDominance:
      instrument.symbol === "BTC-USD" || instrument.symbol === "BTC"
        ? btcDominance
        : undefined,
    history: bars.slice(-365),
    message,
  };
}
