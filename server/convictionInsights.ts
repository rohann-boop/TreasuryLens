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
  ActionSignal,
  BuffettIndex,
  ConvictionIdea,
  Instrument,
  InstrumentSnapshot,
  ModelSignal,
  QuantScore,
  SignalConfig,
  TickerItem,
} from "@shared/schema";
import { buildSnapshot } from "./marketData";
import { computeSignal, DEFAULT_CONFIG } from "./signals";
import { computeBuffettIndex } from "./buffett";
import { getEquityFundamentals } from "./secEdgar";
import { getManagementGovernance } from "./secGovernance";
import { getConvictionIdeas } from "./convictionIdeas";
import { getAnalystConsensus } from "./analystConsensus";
import { buildActionSignal } from "./actionSignal";

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

async function findConvictionIdea(
  ticker: string,
): Promise<ConvictionIdea | null> {
  const sym = ticker.trim().toUpperCase();
  try {
    const data = await getConvictionIdeas();
    return data.ideas.find((i) => i.ticker.toUpperCase() === sym) ?? null;
  } catch {
    return null;
  }
}

// Compose the explainable Action Signal for a ticker. Gathers the deterministic
// ModelSignal + BuffettIndex, the conviction idea (for growth/thesis context)
// and the optional Finnhub analyst consensus, then folds them via the pure
// buildActionSignal engine. Each input is independently fault-tolerant so the
// action signal still renders when any single provider is down.
export async function getTickerActionSignal(
  ticker: string,
  cfg: SignalConfig = DEFAULT_CONFIG,
): Promise<ActionSignal> {
  const sym = ticker.trim().toUpperCase();
  const [signal, buffett, idea, analyst] = await Promise.all([
    getTickerSignal(sym, cfg).catch(() => null),
    getTickerBuffett(sym).catch(() => null),
    findConvictionIdea(sym),
    getAnalystConsensus(sym).catch(() => null),
  ]);
  return buildActionSignal({ symbol: sym, signal, buffett, idea, analyst });
}

// Convenience endpoint: the transparent Quant Score for a ticker. The quant
// score is already embedded in the Action Signal payload (built from the same
// factor reads), so this simply projects that field — keeping a single source
// of truth and avoiding a divergent parallel computation.
export async function getTickerQuantScore(
  ticker: string,
  cfg: SignalConfig = DEFAULT_CONFIG,
): Promise<QuantScore> {
  const action = await getTickerActionSignal(ticker, cfg);
  // buildActionSignal always populates quantScore; the fallback keeps the
  // return type honest if an older code path ever omits it.
  return (
    action.quantScore ?? {
      symbol: ticker.trim().toUpperCase(),
      asOf: Date.now(),
      overall: null,
      band: "insufficient",
      bandLabel: "Insufficient data",
      confidence: "insufficient",
      dataCoverage: 0,
      scoredFactors: 0,
      totalFactors: 6,
      factors: [],
      summary: "Insufficient data — quant score unavailable.",
      backtest: {
        tested: false,
        label: "Not validated yet",
        note: "No quant score could be computed for this ticker.",
        methodId: "quant-technical-v1",
      },
    }
  );
}

// Ticker-tape items sourced from the conviction watchlist. Reuses the
// already-enriched keyMetrics on each idea (price/currency/performance) so the
// ribbon needs no extra provider calls — it degrades gracefully to the ideas
// that have a live price. changePct1d is the true day-over-day move (latest
// close vs the prior trading-day close) from the idea's performance block; when
// that is unavailable the item is still shown with a null change (the ribbon
// renders it as neutral/pending rather than substituting a longer window).
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
      changePct1d: km.performance?.change1dPct ?? null,
      change1d: null,
      status: km.price != null ? "live" : "demo",
      source: km.metricSource ?? "conviction",
      asOf: km.metricAsOf ?? Date.now(),
    });
  }
  return { items, asOf: Date.now() };
}
