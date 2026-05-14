// Market data fetching. Equity path can use Massive when MASSIVE_API_KEY is
// configured; fallbacks are Yahoo/Stooq. Crypto fallback: CoinGecko.
// Always returns a structured snapshot with `status` indicating live/demo/error.

import type { Bar } from "./indicators";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  annualizedVolatility,
  high52w,
  lastSma,
  low52w,
  maxDrawdown,
  relativeMetrics,
  returnPct,
  rsi,
  sharpeLike,
  trendOf,
  ytdReturn,
} from "./indicators";
import {
  getEquityFundamentals,
  getSharesOutstanding,
} from "./secEdgar";
import type { Instrument, InstrumentSnapshot } from "@shared/schema";

const YAHOO_HEADERS = {
  // Yahoo blocks empty UA in some regions
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

const execFileAsync = promisify(execFile);

async function fetchJsonViaCurl<T>(url: string): Promise<T | null> {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "-L",
        "-sS",
        "--max-time",
        "20",
        "-A",
        // Yahoo currently rate-limits Node's fetch and some long browser UAs
        // from this sandbox, while a plain browser-like UA succeeds.
        "Mozilla/5.0",
        "-H",
        "Accept: application/json,text/plain,*/*",
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        url,
      ],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY || "";

interface MassiveAggResponse {
  results?: Array<{
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v?: number;
  }>;
  status?: string;
  error?: string;
}

async function fetchMassiveChart(symbol: string): Promise<Bar[] | null> {
  if (!MASSIVE_API_KEY) return null;
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 730 * 86400000)
      .toISOString()
      .slice(0, 10);
    // Massive's stock API is Polygon-compatible for aggregate bars.
    const url = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(
      symbol,
    )}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(
      MASSIVE_API_KEY,
    )}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as MassiveAggResponse;
    const rows = j.results ?? [];
    if (!rows.length) return null;
    return rows
      .filter(
        (x) =>
          Number.isFinite(x.t) &&
          Number.isFinite(x.o) &&
          Number.isFinite(x.h) &&
          Number.isFinite(x.l) &&
          Number.isFinite(x.c),
      )
      .map((x) => ({
        t: x.t,
        o: x.o,
        h: x.h,
        l: x.l,
        c: x.c,
        v: x.v ?? 0,
      }));
  } catch {
    return null;
  }
}

interface MassiveTickerDetailsResponse {
  results?: {
    ticker?: string;
    name?: string;
    market_cap?: number;
    weighted_shares_outstanding?: number;
    share_class_shares_outstanding?: number;
    currency_name?: string;
  };
  status?: string;
  error?: string;
}

/**
 * Polygon-compatible ticker reference endpoint (Massive). Returns market cap
 * and outstanding share count. P/E is not provided by Polygon's free-tier
 * reference endpoint, so it must be computed elsewhere (or come from Yahoo).
 */
export async function fetchMassiveTickerDetails(
  symbol: string,
): Promise<{
  marketCap: number | null;
  sharesOutstanding: number | null;
  name: string | null;
  currency: string | null;
} | null> {
  if (!MASSIVE_API_KEY) return null;
  try {
    const url = `https://api.massive.com/v3/reference/tickers/${encodeURIComponent(
      symbol,
    )}?apiKey=${encodeURIComponent(MASSIVE_API_KEY)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as MassiveTickerDetailsResponse;
    const res = j.results;
    if (!res) return null;
    const marketCap =
      typeof res.market_cap === "number" && res.market_cap > 0
        ? res.market_cap
        : null;
    const shares =
      typeof res.weighted_shares_outstanding === "number" &&
      res.weighted_shares_outstanding > 0
        ? res.weighted_shares_outstanding
        : typeof res.share_class_shares_outstanding === "number" &&
          res.share_class_shares_outstanding > 0
        ? res.share_class_shares_outstanding
        : null;
    return {
      marketCap,
      sharesOutstanding: shares,
      name: res.name ?? null,
      currency: res.currency_name ?? null,
    };
  } catch {
    return null;
  }
}

// Re-export Massive chart fetch so other modules (stockPicks) can use the
// same provider path as the main indicators pipeline.
export { fetchMassiveChart };

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
      // Trailing P/E — not always present (Yahoo strips it for some
      // ETFs / international tickers / crypto pairs).
      trailingPE?: number;
      forwardPE?: number;
      epsTrailingTwelveMonths?: number;
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
    const j = r.ok
      ? ((await r.json()) as YahooChart)
      : await fetchJsonViaCurl<YahooChart>(url);
    if (!j) return null;
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
      const j = r.ok
        ? ((await r.json()) as YahooQuote)
        : await fetchJsonViaCurl<YahooQuote>(url);
      if (!j) continue;
      const item = j.quoteResponse?.result?.[0];
      if (item) return item;
    } catch {}
  }
  return null;
}

/**
 * Stooq quote fallback. Stooq's `/q/l/` endpoint returns a single line of
 * CSV with the latest open/high/low/close/volume for almost any symbol
 * without an API key. We use it as a safety net when Yahoo blocks (HTTP 429
 * is common from sandboxed IPs). It only gives one bar, so we still need a
 * historical series — we splice the Stooq close onto the cached/demo bars
 * so the price tile can be live even when Yahoo is unreachable.
 */
function yahooToStooqSymbol(yahooSymbol: string): string | null {
  // Yahoo crypto pair: BTC-USD → stooq btcusd
  if (/-USD$/.test(yahooSymbol)) {
    return yahooSymbol.replace(/-USD$/, "").toLowerCase() + "usd";
  }
  // Yahoo Tokyo equity: 3350.T → stooq 3350.jp
  const tokyo = yahooSymbol.match(/^(\d{4})\.T$/);
  if (tokyo) return `${tokyo[1].toLowerCase()}.jp`;
  // Yahoo London: BARC.L → stooq barc.uk
  const london = yahooSymbol.match(/^([A-Z]+)\.L$/);
  if (london) return `${london[1].toLowerCase()}.uk`;
  // Default: assume US equity → lower-case + .us
  if (/^[A-Z]{1,5}$/.test(yahooSymbol)) return `${yahooSymbol.toLowerCase()}.us`;
  // OTC tickers can be 5 characters with an F/Y suffix (e.g. MTPLF).
  if (/^[A-Z]{5}$/.test(yahooSymbol)) return `${yahooSymbol.toLowerCase()}.us`;
  return null;
}

export interface StooqQuote {
  symbol: string;
  date: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ts: number; // epoch ms parsed from date+time (UTC — Stooq uses CET/CEST without offset)
}

export async function fetchStooqQuote(
  yahooSymbol: string,
): Promise<StooqQuote | null> {
  const sym = yahooToStooqSymbol(yahooSymbol);
  if (!sym) return null;
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
    const r = await fetch(url, {
      headers: { "User-Agent": YAHOO_HEADERS["User-Agent"] },
    });
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const row = lines[1].split(",");
    if (row.length < 7) return null;
    const [s, date, time, o, h, l, c, v] = row;
    const close = Number(c);
    if (!Number.isFinite(close) || close <= 0) return null;
    // Stooq's date/time is roughly the last trade timestamp. Parse loosely.
    const ts = Date.parse(`${date}T${time || "00:00:00"}Z`);
    return {
      symbol: s,
      date,
      time,
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close,
      volume: Number(v) || 0,
      ts: Number.isFinite(ts) ? ts : Date.now(),
    };
  } catch {
    return null;
  }
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
  btcBars?: Bar[] | null,
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
    if (
      instrument.dataSource === "massive" ||
      (instrument.assetClass === "equity" && MASSIVE_API_KEY)
    ) {
      bars = await fetchMassiveChart(instrument.symbol);
      if (bars && bars.length) {
        source = "massive";
      } else if (instrument.dataSource === "massive" && !MASSIVE_API_KEY) {
        message =
          "Massive API key not configured on the server; using Yahoo/Stooq fallback.";
      }
    }
    if (!bars || !bars.length) {
      bars = await fetchYahooChart(instrument.symbol);
      source = "yahoo";
    }
  }

  // Yahoo quote for marketCap + volume + P/E (where available). Massive's
  // stock pricing endpoint is used for price bars; fundamentals can still
  // opportunistically come from Yahoo's no-key quote endpoint.
  let peRatio: number | null = null;
  let peSource: string | null = null;
  let yahooEpsTtm: number | null = null;
  if (instrument.assetClass !== "crypto" || instrument.dataSource === "yahoo" || source === "yahoo") {
    const q = await fetchYahooQuote(instrument.symbol);
    if (q) {
      if (q.marketCap != null) marketCap = q.marketCap;
      if (q.regularMarketVolume != null) volume = q.regularMarketVolume;
      if (q.averageDailyVolume3Month != null)
        avgVolume = q.averageDailyVolume3Month;
      if (q.currency) currency = q.currency;
      if (
        typeof q.epsTrailingTwelveMonths === "number" &&
        Number.isFinite(q.epsTrailingTwelveMonths)
      ) {
        yahooEpsTtm = q.epsTrailingTwelveMonths;
      }
      if (typeof q.trailingPE === "number" && Number.isFinite(q.trailingPE)) {
        peRatio = q.trailingPE;
        peSource = "yahoo";
      } else if (
        typeof q.forwardPE === "number" &&
        Number.isFinite(q.forwardPE)
      ) {
        // Fall back to forward P/E when trailing is unavailable. Forward is
        // less ideal but better than N/A for fast-moving names.
        peRatio = q.forwardPE;
        peSource = "yahoo";
      }
    }
  }

  // Yahoo failed — try Stooq's quote endpoint as a live-price safety net.
  // We splice the Stooq close onto a seeded historical series so price/
  // change KPIs can stay near-live even when Yahoo blocks. Indicators that
  // depend on long history are still computed off the synthetic series; the
  // status message tells the user clearly.
  let stooqQuote: typeof undefined | Awaited<ReturnType<typeof fetchStooqQuote>> = undefined;
  if (!bars || bars.length < 5) {
    stooqQuote = await fetchStooqQuote(instrument.symbol);
  }

  if (!bars || bars.length < 5) {
    const seed =
      Array.from(instrument.symbol).reduce((a, c) => a + c.charCodeAt(0), 0) +
      instrument.id;
    const base = instrument.assetClass === "crypto" ? 60000 : 100;
    const synthetic = seededDemoBars(seed, base);
    if (stooqQuote) {
      // Splice Stooq's latest open/close onto the last two bars so 1D change
      // is meaningful and the displayed price is real.
      const last = synthetic[synthetic.length - 1];
      const prev = synthetic[synthetic.length - 2];
      // Anchor the last bar to Stooq's actual values.
      synthetic[synthetic.length - 1] = {
        ...last,
        t: stooqQuote.ts || last.t,
        o: stooqQuote.open,
        h: stooqQuote.high,
        l: stooqQuote.low,
        c: stooqQuote.close,
        v: stooqQuote.volume || last.v,
      };
      // Anchor the previous bar's close so 1D % change uses Stooq's open as
      // a reasonable proxy for prior close (Stooq's CSV does not return
      // prior close on this endpoint).
      synthetic[synthetic.length - 2] = {
        ...prev,
        c: stooqQuote.open,
      };
      status = "live";
      source = "stooq";
      message =
        "Live price via Stooq. Long-history indicators (vol, drawdown, SMAs) use a seeded series because Yahoo chart was rate-limited.";
    } else {
      status = "demo";
      source = "demo";
      message = "Live data unavailable — showing seeded demo series.";
    }
    bars = synthetic;
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

  // Equity fundamentals enrichment. Yahoo's quote endpoint is the canonical
  // source, but it is regularly blocked in sandboxed/CI environments — that
  // leaves marketCap and peRatio null even when we have a healthy price from
  // Massive/Stooq. Mirror the Stock Picks path: try Massive's Polygon-style
  // ticker reference for market cap, then SEC EDGAR for shares outstanding ×
  // price and price / TTM EPS. Crypto and indices are skipped (no equity
  // fundamentals exist). Non-US issuers (e.g. MTPLF) cleanly fall through
  // when EDGAR has no CIK for the ticker.
  if (
    instrument.assetClass === "equity" &&
    Number.isFinite(price) &&
    price > 0
  ) {
    if (marketCap == null) {
      try {
        const details = await fetchMassiveTickerDetails(instrument.symbol);
        if (details?.marketCap != null) {
          marketCap = details.marketCap;
        } else if (
          details?.sharesOutstanding != null &&
          details.sharesOutstanding > 0
        ) {
          marketCap = price * details.sharesOutstanding;
        }
      } catch {
        // ignore — fall through to EDGAR
      }
    }
    if (marketCap == null) {
      try {
        const sh = await getSharesOutstanding(instrument.symbol);
        if (sh && Number.isFinite(sh.value) && sh.value > 0) {
          marketCap = price * sh.value;
        }
      } catch {
        // ignore
      }
    }
    if (peRatio == null) {
      // Prefer Yahoo's TTM EPS if it leaked through; otherwise pull EPS from
      // SEC EDGAR fundamentals. Both are TTM and broadly comparable.
      let epsTtm = yahooEpsTtm;
      if (epsTtm == null || !Number.isFinite(epsTtm)) {
        try {
          const f = await getEquityFundamentals(instrument.symbol);
          if (f?.eps && Number.isFinite(f.eps.value)) {
            epsTtm = f.eps.value;
          }
        } catch {
          // ignore
        }
      }
      if (epsTtm != null && Number.isFinite(epsTtm) && epsTtm > 0) {
        peRatio = price / epsTtm;
        peSource = peSource ?? "sec_edgar";
      }
    }
  }

  // Advanced indicators — deterministic, history-based.
  const mdd = maxDrawdown(closes);
  const sharpe30 = sharpeLike(closes, 30);

  // Relative-to-BTC metrics. For BTC itself, these are self-referential and
  // intentionally null (the UI flags `relIsSelf`).
  const relIsSelf = instrument.symbol === "BTC-USD";
  let corr30: number | null = null;
  let corr90: number | null = null;
  let b30: number | null = null;
  let b90: number | null = null;
  let relPerf30: number | null = null;
  let relPerf90: number | null = null;
  if (!relIsSelf && btcBars && btcBars.length > 30) {
    const rel = relativeMetrics(
      bars.map((b) => ({ t: b.t, c: b.c })),
      btcBars.map((b) => ({ t: b.t, c: b.c })),
    );
    corr30 = rel.corr30d;
    corr90 = rel.corr90d;
    b30 = rel.beta30d;
    b90 = rel.beta90d;
    // Relative performance: asset return minus BTC return over same window.
    const btcCloses = btcBars.map((b) => b.c);
    const r30Asset = returnPct(closes, 30);
    const r90Asset = returnPct(closes, 90);
    const r30Btc = returnPct(btcCloses, 30);
    const r90Btc = returnPct(btcCloses, 90);
    relPerf30 =
      r30Asset != null && r30Btc != null ? r30Asset - r30Btc : null;
    relPerf90 =
      r90Asset != null && r90Btc != null ? r90Asset - r90Btc : null;
  }

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
    maxDrawdownPct: mdd,
    maxDrawdownLookbackDays: bars.length > 0 ? bars.length : null,
    sharpeLike30d: sharpe30,
    relIsSelf,
    relPerf30d: relPerf30,
    relPerf90d: relPerf90,
    corrToBtc30d: corr30,
    corrToBtc90d: corr90,
    betaToBtc30d: b30,
    betaToBtc90d: b90,
    peRatio,
    peSource,
    history: bars.slice(-365),
    message,
  };
}
