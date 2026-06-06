// Ticker-keyed insight endpoints for the Watchlist & Conviction Dashboard.
//
// The new Dashboard is built around conviction ideas keyed by ticker symbol,
// not the legacy numeric-id instrument model. These helpers bridge that gap:
// they synthesize an in-memory Instrument from a bare ticker, build a live
// snapshot through the shared market-data path (Massive → Yahoo → Stooq), and
// then reuse the existing deterministic engines — computeBuffettIndex and
// computeSignal — so the detail pane can show a Buffett business-quality panel
// and a buy/sell + confidence signal for the selected idea. Nothing here calls
// an LLM; everything is derived from public price/fundamentals data.
//
// A short in-memory cache keeps rapid panel switches from re-hitting providers.

import type {
  BuffettIndex,
  Instrument,
  InstrumentSnapshot,
  ModelSignal,
  SignalConfig,
  TickerItem,
} from "@shared/schema";
import { buildSnapshot } from "./marketData";
import { computeSignal, DEFAULT_CONFIG } from "./signals";
import { computeBuffettIndex } from "./buffett";
import { getEquityFundamentals } from "./secEdgar";
import { getManagementGovernance } from "./secGovernance";
import { getConvictionIdeas } from "./convictionIdeas";

const SNAP_TTL_MS = 60_000;
const snapCache = new Map<string, { at: number; snap: InstrumentSnapshot }>();

// Synthesize an Instrument from a ticker. Conviction ideas are equities/ETFs;
// the negative id keeps these synthetic instruments from ever colliding with
// real autoincrement ids in storage (used only as a stable seed/cache key).
function syntheticInstrument(ticker: string): Instrument {
  const sym = ticker.trim().toUpperCase();
  const seed = Array.from(sym).reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    id: -seed,
    symbol: sym,
    displayName: sym,
    assetClass: "equity",
    quoteCurrency: "USD",
    dataSource: "yahoo",
    notes: null,
    sortOrder: 0,
    pinned: false,
  };
}

async function getTickerSnapshot(ticker: string): Promise<InstrumentSnapshot> {
  const sym = ticker.trim().toUpperCase();
  const cached = snapCache.get(sym);
  if (cached && Date.now() - cached.at < SNAP_TTL_MS) return cached.snap;
  const snap = await buildSnapshot(syntheticInstrument(sym), null);
  snapCache.set(sym, { at: Date.now(), snap });
  return snap;
}

export async function getTickerBuffett(ticker: string): Promise<BuffettIndex> {
  const snap = await getTickerSnapshot(ticker);
  let fundamentals = null;
  let governance = null;
  if (snap.instrument.assetClass === "equity") {
    try {
      fundamentals = await getEquityFundamentals(snap.instrument.symbol);
    } catch {
      fundamentals = null;
    }
    try {
      governance = await getManagementGovernance(snap.instrument.symbol);
    } catch {
      governance = null;
    }
  }
  return computeBuffettIndex(snap, fundamentals, governance);
}

export function parseTickerSignalConfig(
  q: Record<string, unknown>,
): SignalConfig {
  const num = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const horizonRaw = num(q.horizon, DEFAULT_CONFIG.horizonDays);
  const horizonDays = ([7, 30, 90] as const).includes(horizonRaw as 7 | 30 | 90)
    ? (horizonRaw as 7 | 30 | 90)
    : DEFAULT_CONFIG.horizonDays;
  const profileRaw = String(q.profile ?? DEFAULT_CONFIG.profile);
  const profile = (["conservative", "balanced", "aggressive"] as const).includes(
    profileRaw as never,
  )
    ? (profileRaw as SignalConfig["profile"])
    : DEFAULT_CONFIG.profile;
  return {
    downsidePct: Math.max(0.5, Math.min(50, num(q.downside, DEFAULT_CONFIG.downsidePct))),
    upsidePct: Math.max(1, Math.min(200, num(q.upside, DEFAULT_CONFIG.upsidePct))),
    horizonDays,
    profile,
    confidenceThreshold: Math.max(
      0,
      Math.min(100, num(q.threshold, DEFAULT_CONFIG.confidenceThreshold)),
    ),
  };
}

export async function getTickerSignal(
  ticker: string,
  cfg: SignalConfig = DEFAULT_CONFIG,
): Promise<ModelSignal> {
  const snap = await getTickerSnapshot(ticker);
  return computeSignal(snap, cfg);
}

// Ticker-tape items sourced from the conviction watchlist. Reuses the
// already-enriched keyMetrics on each idea (price/currency/performance) so the
// ribbon needs no extra provider calls — it degrades gracefully to the ideas
// that have a live price. changePct1d is approximated from the 1-month
// performance scaled by trading days when no intraday change is available;
// when even that is missing the item is still shown with a null change.
export async function getConvictionTicker(): Promise<{
  items: TickerItem[];
  asOf: number;
}> {
  const data = await getConvictionIdeas();
  const items: TickerItem[] = [];
  for (const idea of data.ideas) {
    const km = idea.keyMetrics;
    if (!km || km.price == null) continue;
    items.push({
      id: Math.abs(
        Array.from(idea.ticker).reduce((a, c) => a + c.charCodeAt(0), 0),
      ),
      symbol: idea.ticker,
      displayName: idea.companyName,
      assetClass: "equity",
      price: km.price,
      currency: km.priceCurrency ?? "USD",
      changePct1d: km.performance?.change1mPct ?? null,
      change1d: null,
      status: km.price != null ? "live" : "demo",
      source: km.metricSource ?? "conviction",
      asOf: km.metricAsOf ?? Date.now(),
    });
  }
  return { items, asOf: Date.now() };
}
