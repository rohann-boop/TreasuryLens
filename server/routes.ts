import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { buildSnapshot } from "./marketData";
import type { Bar } from "./indicators";
import { computeSignal, parseSignalConfig, DEFAULT_CONFIG } from "./signals";
import { computeBuffettIndex } from "./buffett";
import { getEquityFundamentals, getEquityRevenue } from "./secEdgar";
import { getSegmentBreakdown } from "./segments";
import { getManagementGovernance } from "./secGovernance";
import { getThirteenFSummary } from "./sec13f";
import { getPoliticiansSummary } from "./politicians";
import { getStockPicks, getTickerChart } from "./stockPicks";
import { getStockPicksBacktest } from "./backtest";
import { getQuantBacktest } from "./quantBacktest";
import { runModelLabBacktest } from "./modelLab";
import { getInvestmentGroups } from "./investmentGroups";
import { getPortfolioLab } from "./portfolioLab";
import { getTradeIdeas } from "./tradeIdeas";
import {
  getConvictionIdeas,
  addConvictionIdea,
  removeConvictionIdea,
  ConvictionConflictError,
} from "./convictionIdeas";
import { answerAssistant } from "./assistantEngine";
import {
  getTickerBuffett,
  getTickerSignal,
  getTickerActionSignal,
  getTickerQuantScore,
  parseTickerSignalConfig,
  getConvictionTicker,
} from "./convictionInsights";
import { getAnalystConsensus } from "./analystConsensus";
import {
  insertInstrumentSchema,
  insertTreasurySchema,
  addConvictionIdeaSchema,
  type Instrument,
  type InstrumentSnapshot,
  type TreasurySnapshot,
  type TreasuryHistoryPoint,
} from "@shared/schema";
import { z } from "zod";

// Tiny in-memory cache for snapshots: 60s TTL. Reused by /api/snapshots,
// /api/ticker, and the per-instrument endpoints to avoid hammering Yahoo /
// CoinGecko on rapid polls.
const cache = new Map<string, { at: number; data: InstrumentSnapshot }>();
const TTL_MS = 60_000;

/**
 * Build (or hit cache for) the BTC snapshot first, then build the requested
 * instrument with BTC's bars passed in so relative metrics (corr/beta/relPerf)
 * can be computed without a second provider hit.
 */
async function getBtcContext(): Promise<{
  btcSnap: InstrumentSnapshot | null;
  btcBars: Bar[] | null;
}> {
  const btcInst = await storage.getInstrumentBySymbol("BTC-USD");
  if (!btcInst) return { btcSnap: null, btcBars: null };
  const key = `${btcInst.id}:${btcInst.symbol}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL_MS) {
    return {
      btcSnap: c.data,
      btcBars: c.data.history.map((h) => ({
        t: h.t,
        o: h.o,
        h: h.h,
        l: h.l,
        c: h.c,
        v: h.v,
      })),
    };
  }
  const snap = await buildSnapshot(btcInst, null);
  cache.set(key, { at: Date.now(), data: snap });
  return {
    btcSnap: snap,
    btcBars: snap.history.map((h) => ({
      t: h.t,
      o: h.o,
      h: h.h,
      l: h.l,
      c: h.c,
      v: h.v,
    })),
  };
}

async function attachTreasury(
  inst: Instrument,
  snap: InstrumentSnapshot,
  btcSpot: number | null,
): Promise<void> {
  const t = await storage.getTreasury(inst.id);
  if (!t) return;
  const btcNavUsd =
    t.btcHoldings != null && btcSpot != null ? t.btcHoldings * btcSpot : null;
  // fxRate convention: units of quote currency per 1 USD (e.g. JPY≈150).
  const fx = t.fxRate ?? (snap.currency === "USD" ? 1 : null);
  const btcNavQuote = btcNavUsd != null && fx != null ? btcNavUsd * fx : null;
  const btcNavPerShare =
    btcNavQuote != null && t.sharesOutstanding && t.sharesOutstanding > 0
      ? btcNavQuote / t.sharesOutstanding
      : null;
  const marketCap =
    snap.marketCap ??
    (snap.price != null && t.sharesOutstanding != null
      ? snap.price * t.sharesOutstanding
      : null);
  const mNav =
    marketCap != null && btcNavQuote && btcNavQuote > 0
      ? marketCap / btcNavQuote
      : null;
  const btcPerShare =
    t.btcHoldings != null && t.sharesOutstanding && t.sharesOutstanding > 0
      ? t.btcHoldings / t.sharesOutstanding
      : null;

  // BTC yield = % change in BTC/share since the earliest historical
  // snapshot. Requires at least 2 history points with both fields set.
  const rawHistory = await storage.listTreasuryHistory(inst.id);
  const history: TreasuryHistoryPoint[] = rawHistory.map((h) => ({
    capturedAt: h.capturedAt,
    btcHoldings: h.btcHoldings,
    sharesOutstanding: h.sharesOutstanding,
    btcPerShare:
      h.btcHoldings != null && h.sharesOutstanding && h.sharesOutstanding > 0
        ? h.btcHoldings / h.sharesOutstanding
        : null,
  }));
  let btcYieldPct: number | null = null;
  let yieldSinceMs: number | null = null;
  const usable = history.filter((h) => h.btcPerShare != null);
  if (usable.length >= 2 && btcPerShare != null) {
    const first = usable[0];
    if (first.btcPerShare != null && first.btcPerShare > 0) {
      btcYieldPct =
        ((btcPerShare - first.btcPerShare) / first.btcPerShare) * 100;
      yieldSinceMs = first.capturedAt;
    }
  }

  const treasury: TreasurySnapshot = {
    btcHoldings: t.btcHoldings,
    sharesOutstanding: t.sharesOutstanding,
    fxRate: t.fxRate,
    btcNavUsd,
    btcNavPerShare,
    mNav,
    marketCap,
    notes: t.notes,
    updatedAt: t.updatedAt,
    btcPerShare,
    btcYieldPct,
    historyPoints: usable.length,
    yieldSinceMs,
    history,
  };
  snap.treasury = treasury;
}

async function getSnapshot(
  instrumentId: number,
  force = false,
  btcCtx?: { btcSnap: InstrumentSnapshot | null; btcBars: Bar[] | null },
): Promise<InstrumentSnapshot | null> {
  const inst = await storage.getInstrument(instrumentId);
  if (!inst) return null;
  const key = `${inst.id}:${inst.symbol}`;
  const c = cache.get(key);
  if (!force && c && Date.now() - c.at < TTL_MS) return c.data;

  // Resolve BTC bars / spot once \u2014 needed both for relative metrics and
  // for treasury NAV calculations on equity instruments.
  const ctx = btcCtx ?? (await getBtcContext());
  const btcBars =
    inst.symbol === "BTC-USD" ? null : ctx.btcBars;

  const snap = await buildSnapshot(inst, btcBars);
  await attachTreasury(inst, snap, ctx.btcSnap?.price ?? null);
  // Attach a default-config (5% / 20% / 30D / Balanced) model signal so the
  // comparison table, ticker, and sidebar can show a compact badge without
  // an extra round-trip per instrument.
  try {
    const sig = computeSignal(snap, DEFAULT_CONFIG);
    snap.defaultSignal = {
      label: sig.signal,
      score: sig.compositeScore,
      confidence: sig.confidence,
    };
  } catch {
    snap.defaultSignal = null;
  }
  cache.set(key, { at: Date.now(), data: snap });
  return snap;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // List instruments
  app.get("/api/instruments", async (_req, res) => {
    const list = await storage.listInstruments();
    res.json(list);
  });

  // Create instrument
  app.post("/api/instruments", async (req, res) => {
    try {
      const parsed = insertInstrumentSchema.parse(req.body);
      const existing = await storage.getInstrumentBySymbol(parsed.symbol);
      if (existing) {
        return res
          .status(409)
          .json({ message: "Instrument with that symbol already exists" });
      }
      const inst = await storage.createInstrument(parsed);
      res.status(201).json(inst);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid", issues: e.errors });
      }
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Delete instrument
  app.delete("/api/instruments/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const ok = await storage.deleteInstrument(id);
    res.json({ ok });
  });

  // Snapshot for one instrument
  app.get("/api/instruments/:id/snapshot", async (req, res) => {
    const id = Number(req.params.id);
    const force = req.query.refresh === "1";
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const snap = await getSnapshot(id, force);
    if (!snap) return res.status(404).json({ message: "not found" });
    res.json(snap);
  });

  // Bulk snapshots \u2014 build BTC first, then thread its bars through to all
  // other instruments so relative metrics can be computed without a second
  // BTC provider hit.
  app.get("/api/snapshots", async (req, res) => {
    const force = req.query.refresh === "1";
    const list = await storage.listInstruments();
    if (force) {
      // Bust cache for everyone in this batch
      for (const i of list) cache.delete(`${i.id}:${i.symbol}`);
    }
    const btcCtx = await getBtcContext();
    const snaps = await Promise.all(
      list.map((i) => getSnapshot(i.id, false, btcCtx).catch(() => null)),
    );
    res.json(snaps.filter(Boolean));
  });

  // Lightweight ticker: minimal snapshot fields for the ticker tape.
  app.get("/api/ticker", async (_req, res) => {
    const list = await storage.listInstruments();
    const btcCtx = await getBtcContext();
    const snaps = await Promise.all(
      list.map((i) => getSnapshot(i.id, false, btcCtx).catch(() => null)),
    );
    const items = snaps
      .filter((s): s is InstrumentSnapshot => !!s)
      .map((s) => ({
        id: s.instrument.id,
        symbol: s.instrument.symbol,
        displayName: s.instrument.displayName,
        assetClass: s.instrument.assetClass,
        price: s.price,
        currency: s.currency,
        changePct1d: s.changePct1d,
        change1d: s.change1d,
        status: s.status,
        source: s.source,
        asOf: s.asOf,
      }));
    res.json({ items, asOf: Date.now() });
  });

  // Model signal — deterministic. Reuses cached snapshot.
  app.get("/api/instruments/:id/signal", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const snap = await getSnapshot(id, false);
    if (!snap) return res.status(404).json({ message: "not found" });
    const cfg = parseSignalConfig(req.query as Record<string, unknown>);
    const signal = computeSignal(snap, cfg);
    res.json(signal);
  });

  // Buffett Index — business-quality / valuation framework, separate from
  // short-term Signal Lab. Reuses cached snapshot; SEC EDGAR fundamentals are
  // fetched (and cached server-side) for U.S. equities.
  app.get("/api/instruments/:id/buffett", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const snap = await getSnapshot(id, false);
    if (!snap) return res.status(404).json({ message: "not found" });
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
    res.json(computeBuffettIndex(snap, fundamentals, governance));
  });

  // Treasury upsert
  app.post("/api/instruments/:id/treasury", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    try {
      const parsed = insertTreasurySchema.parse({
        ...req.body,
        instrumentId: id,
      });
      const t = await storage.upsertTreasury(parsed);
      const inst = await storage.getInstrument(id);
      if (inst) cache.delete(`${inst.id}:${inst.symbol}`);
      res.json(t);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid", issues: e.errors });
      }
      res.status(500).json({ message: (e as Error).message });
    }
  });

  app.get("/api/instruments/:id/treasury", async (req, res) => {
    const id = Number(req.params.id);
    const t = await storage.getTreasury(id);
    res.json(t ?? null);
  });

  // Treasury history \u2014 used by the BTC yield calc and (optionally) the UI
  // for a sparkline of BTC/share over time.
  app.get("/api/instruments/:id/treasury/history", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "bad id" });
    const hist = await storage.listTreasuryHistory(id);
    res.json(hist);
  });

  // 13F-HR superinvestor tracker — latest filings for a fixed set of managers.
  // Cached server-side for several hours to avoid repeated SEC hits.
  app.get("/api/13f/summary", async (_req, res) => {
    try {
      const summary = await getThirteenFSummary();
      res.json(summary);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // STOCK Act politician disclosures — curated source-linked view of public
  // House Clerk / Senate filings. No paid APIs; values are dollar ranges.
  app.get("/api/politicians/summary", async (_req, res) => {
    try {
      const summary = await getPoliticiansSummary();
      res.json(summary);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Stock picks / themes — curated research watchlists. Static data, no
  // external API calls; safe to cache at the module level.
  app.get("/api/stock-picks", async (_req, res) => {
    try {
      res.json(await getStockPicks());
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Scenario backtest — 1Y price-history reconstruction of how the current
  // curated picks would have performed, aggregated by today's scenario
  // classification. Cached server-side (30 min) to avoid heavy recompute.
  app.get("/api/stock-picks/backtest", async (_req, res) => {
    try {
      res.json(await getStockPicksBacktest());
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Quant Score — Backtest v1 (technical-only, multi-window). Validates ONLY the
  // price/momentum portion of the quant rules across several point-in-time
  // windows (3M/6M/1Y/2Y where data exists) with multiple threshold cohorts, no
  // fundamental or analyst look-ahead. Clearly labelled "technical-only"; not a
  // validation of the full quant score. Cached server-side (30 min).
  app.get("/api/quant-score/backtest", async (_req, res) => {
    try {
      res.json(await getQuantBacktest());
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Model Lab — run the technical-only backtest under caller-supplied factor
  // weights (or a named preset). Only the momentum/risk weights are applied
  // point-in-time; fundamental/analyst weights are accepted but flagged
  // informational. Body: { weights?: Partial<ModelWeights>, presetId?: string }.
  // GET is also supported (no body) so the page can fetch defaults/presets.
  const FACTOR_KEYS = [
    "momentum",
    "analyst",
    "valuation",
    "growth",
    "quality",
    "risk",
  ] as const;
  const parseModelLabBody = (body: unknown) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const out: { weights?: Record<string, number>; presetId?: string } = {};
    if (typeof b.presetId === "string") out.presetId = b.presetId;
    if (b.weights && typeof b.weights === "object") {
      const w: Record<string, number> = {};
      for (const k of FACTOR_KEYS) {
        const v = (b.weights as Record<string, unknown>)[k];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) w[k] = v;
      }
      if (Object.keys(w).length > 0) out.weights = w;
    }
    return out;
  };
  app.post("/api/model-lab/backtest", async (req, res) => {
    try {
      res.json(await runModelLabBacktest(parseModelLabBody(req.body)));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });
  app.get("/api/model-lab/backtest", async (_req, res) => {
    try {
      res.json(await runModelLabBacktest({}));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Investment Groups (Baskets) v1 — deterministic, explainable research
  // baskets built from the conviction universe under a chosen template +
  // controls (min conviction score, max risk tolerance, max holdings). No LLM;
  // each member carries its factor reads and inclusion rationale, and the group
  // borrows a Model Lab technical-only validation badge. Query params:
  // template, minScore, maxRisk, maxHoldings.
  const GROUP_TEMPLATE_IDS = [
    "core-compounders",
    "high-upside-speculative",
    "ai-infrastructure",
    "energy-power",
    "risk-controlled",
    "momentum-breakouts",
  ] as const;
  const RISK_LEVELS = [
    "low",
    "moderate",
    "elevated",
    "high",
    "very high",
  ] as const;
  app.get("/api/investment-groups", async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>;
      const templateId =
        typeof q.template === "string" &&
        (GROUP_TEMPLATE_IDS as readonly string[]).includes(q.template)
          ? (q.template as (typeof GROUP_TEMPLATE_IDS)[number])
          : undefined;
      const maxRiskLevel =
        typeof q.maxRisk === "string" &&
        (RISK_LEVELS as readonly string[]).includes(q.maxRisk)
          ? (q.maxRisk as (typeof RISK_LEVELS)[number])
          : undefined;
      const minScoreNum = Number(q.minScore);
      const maxHoldingsNum = Number(q.maxHoldings);
      res.json(
        await getInvestmentGroups({
          templateId,
          maxRiskLevel,
          minConvictionScore: Number.isFinite(minScoreNum)
            ? minScoreNum
            : undefined,
          maxHoldings: Number.isFinite(maxHoldingsNum)
            ? maxHoldingsNum
            : undefined,
        }),
      );
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Portfolio Lab v1 — construct a MODEL / PAPER portfolio (research only) from
  // the conviction universe under a chosen source (themes / sections / manual
  // tickers / full universe), a weighting style, and constraints (max holdings,
  // max position size, max theme exposure, max high-risk exposure, min model
  // score, cash buffer). Deterministic; no LLM, no orders, no brokerage. POST
  // body carries style/source/constraints; GET returns defaults so the page can
  // bootstrap the style + source option lists.
  const PORTFOLIO_STYLE_IDS = [
    "equal-weight",
    "model-score-weighted",
    "risk-weighted",
    "core-satellite",
    "high-upside",
    "risk-controlled",
  ] as const;
  const PORTFOLIO_SOURCE_KINDS = [
    "universe",
    "themes",
    "sections",
    "manual",
  ] as const;
  const parsePortfolioLabBody = (body: unknown) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const out: {
      styleId?: (typeof PORTFOLIO_STYLE_IDS)[number];
      source?: {
        kind?: (typeof PORTFOLIO_SOURCE_KINDS)[number];
        themes?: string[];
        sections?: string[];
        tickers?: string[];
      };
      constraints?: Record<string, number>;
    } = {};
    if (
      typeof b.styleId === "string" &&
      (PORTFOLIO_STYLE_IDS as readonly string[]).includes(b.styleId)
    ) {
      out.styleId = b.styleId as (typeof PORTFOLIO_STYLE_IDS)[number];
    }
    const toStrArr = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 100)
        : [];
    if (b.source && typeof b.source === "object") {
      const s = b.source as Record<string, unknown>;
      const source: NonNullable<typeof out.source> = {};
      if (
        typeof s.kind === "string" &&
        (PORTFOLIO_SOURCE_KINDS as readonly string[]).includes(s.kind)
      ) {
        source.kind = s.kind as (typeof PORTFOLIO_SOURCE_KINDS)[number];
      }
      source.themes = toStrArr(s.themes);
      source.sections = toStrArr(s.sections);
      source.tickers = toStrArr(s.tickers);
      out.source = source;
    }
    if (b.constraints && typeof b.constraints === "object") {
      const cs = b.constraints as Record<string, unknown>;
      const keys = [
        "maxHoldings",
        "maxPositionPct",
        "maxThemePct",
        "maxHighRiskPct",
        "minModelScore",
        "cashBufferPct",
      ];
      const w: Record<string, number> = {};
      for (const k of keys) {
        const v = cs[k];
        if (typeof v === "number" && Number.isFinite(v)) w[k] = v;
      }
      if (Object.keys(w).length > 0) out.constraints = w;
    }
    return out;
  };
  app.post("/api/portfolio-lab", async (req, res) => {
    try {
      res.json(await getPortfolioLab(parsePortfolioLabBody(req.body)));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });
  app.get("/api/portfolio-lab", async (_req, res) => {
    try {
      res.json(await getPortfolioLab({}));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Trade Ideas v1 — deterministic distillation of the Stock Picks universe
  // into ranked actionable LONG equity ideas and ranked bullish OPTION
  // structures (long call, bull call spread, call diagonal, cash-secured put,
  // bull put spread). Longs reuse conviction + scenario reward/risk; options are
  // MODELED FALLBACKS (no live chain) ranked by a payoff-adjusted actionability
  // score with explicit 2x/3x scenario flags. No external calls beyond the ones
  // Stock Picks already makes; cached server-side (30 min). Research only.
  app.get("/api/trade-ideas", async (_req, res) => {
    try {
      res.json(await getTradeIdeas());
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Conviction Ideas — a small, deliberate research book (curated, static
  // content). Enriched with live pricing + scenario models via the same
  // helpers Stock Picks uses. Cached server-side (30 min).
  app.get("/api/conviction-ideas", async (_req, res) => {
    try {
      res.json(await getConvictionIdeas());
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Compact price + moving-average chart for a single conviction idea.
  // Reuses the same Massive → Yahoo bars path as the metrics enrichment and
  // is cached server-side (30 min). Returns price plus 50-/200-day SMAs.
  app.get("/api/conviction-ideas/chart/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker ?? "").trim();
      if (!ticker || !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker)) {
        return res.status(400).json({ message: "Invalid ticker." });
      }
      const range = String(req.query.range ?? "");
      res.json(await getTickerChart(ticker, range));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Current + historical revenue for a single conviction idea. Sourced from
  // SEC EDGAR companyfacts for US filers; returns graceful "not-available" /
  // "not-meaningful" states for ETFs/funds/foreign/ambiguous tickers. Cached
  // server-side inside the secEdgar module.
  app.get("/api/conviction-ideas/revenue/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker ?? "").trim();
      if (!ticker || !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker)) {
        return res.status(400).json({ message: "Invalid ticker." });
      }
      res.json(await getEquityRevenue(ticker));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Segment-level revenue / operating-income breakdown for a single conviction
  // idea (by ticker). Provider-abstracted: a finance connector would be first
  // priority but is deferred (no server-side credentials in the deployed
  // runtime — see server/segments.ts), so this resolves from SEC 10-K XBRL
  // segment-axis facts. Returns graceful not-available / not-meaningful states
  // for ETFs/funds/foreign/single-segment issuers. Cached server-side (6h).
  app.get("/api/conviction-ideas/segments/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker ?? "").trim();
      if (!ticker || !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker)) {
        return res.status(400).json({ message: "Invalid ticker." });
      }
      res.json(await getSegmentBreakdown(ticker));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Buffett Index for a single conviction idea (by ticker). Synthesizes a
  // snapshot via the shared market-data path and reuses the same engine as the
  // legacy per-instrument route, including SEC EDGAR fundamentals/governance
  // for U.S. equities. ETFs/funds degrade to low data coverage gracefully.
  app.get("/api/conviction-ideas/buffett/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker ?? "").trim();
      if (!ticker || !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker)) {
        return res.status(400).json({ message: "Invalid ticker." });
      }
      res.json(await getTickerBuffett(ticker));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Deterministic buy/sell + confidence model signal for a single conviction
  // idea (by ticker). Tunable via downside/upside/horizon/profile/threshold
  // query params. No LLM — derived from the snapshot's technicals/valuation.
  app.get("/api/conviction-ideas/signal/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker ?? "").trim();
      if (!ticker || !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker)) {
        return res.status(400).json({ message: "Invalid ticker." });
      }
      const cfg = parseTickerSignalConfig(req.query as Record<string, unknown>);
      res.json(await getTickerSignal(ticker, cfg));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Analyst recommendation consensus for a single conviction idea (by ticker),
  // sourced from Finnhub's free-tier endpoint. Returns an explicit
  // available/unavailable/error status with a graceful message when the token
  // is absent or the ticker is uncovered (ETFs / funds). Cached server-side.
  app.get("/api/conviction-ideas/analyst-consensus/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker ?? "").trim();
      if (!ticker || !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker)) {
        return res.status(400).json({ message: "Invalid ticker." });
      }
      res.json(await getAnalystConsensus(ticker));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Explainable Action Signal for a single conviction idea (by ticker). Folds
  // the rules-based momentum/valuation/quality/growth/risk sub-scores together
  // with the optional analyst consensus into one of six action labels plus a
  // factor scorecard and upgrade/downgrade triggers. Rules-based, no LLM.
  app.get("/api/conviction-ideas/action-signal/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker ?? "").trim();
      if (!ticker || !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker)) {
        return res.status(400).json({ message: "Invalid ticker." });
      }
      const cfg = parseTickerSignalConfig(req.query as Record<string, unknown>);
      res.json(await getTickerActionSignal(ticker, cfg));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Transparent Quant Score v1 for a single conviction idea (by ticker). A
  // weighted factor-score model (momentum/analyst/valuation/growth/quality/risk)
  // with explicit per-factor data status, weights, contributions and rationale,
  // plus an overall 0-100, band, and data-coverage-driven confidence. Rules-based,
  // no LLM. Also embedded in the action-signal payload; this is the lighter view.
  app.get("/api/conviction-ideas/quant-score/:ticker", async (req, res) => {
    try {
      const ticker = String(req.params.ticker ?? "").trim();
      if (!ticker || !/^[A-Za-z0-9.\-]{1,12}$/.test(ticker)) {
        return res.status(400).json({ message: "Invalid ticker." });
      }
      const cfg = parseTickerSignalConfig(req.query as Record<string, unknown>);
      res.json(await getTickerQuantScore(ticker, cfg));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Live ticker-tape items sourced from the conviction watchlist's already
  // enriched key metrics — no extra provider calls. Feeds the Dashboard's
  // moving price ribbon.
  app.get("/api/conviction-ticker", async (_req, res) => {
    try {
      res.json(await getConvictionTicker());
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Add a user-defined conviction idea. Persisted in SQLite so it survives
  // navigation and restarts. Returns the full refreshed response.
  app.post("/api/conviction-ideas", async (req, res) => {
    try {
      const parsed = addConvictionIdeaSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          message:
            parsed.error.issues[0]?.message ?? "Invalid conviction idea input.",
        });
      }
      res.json(await addConvictionIdea(parsed.data));
    } catch (e) {
      if (e instanceof ConvictionConflictError) {
        return res.status(409).json({ message: e.message });
      }
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Remove a conviction idea (custom or curated default) by id. Returns the
  // full refreshed response so the client can update in one round-trip.
  app.delete("/api/conviction-ideas/:id", async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      if (!id) return res.status(400).json({ message: "Idea id is required." });
      res.json(await removeConvictionIdea(id));
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Assistant — free, deterministic, rules-based in-app screen helper. No
  // LLM/model API is called at runtime; answers are drawn from internal
  // TreasuryLens data and the active screen route. The engine lives in
  // server/assistantEngine.ts so a real model provider can be plugged in
  // behind the AssistantProvider interface without changing this route.
  app.post("/api/assistant/query", async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        route?: unknown;
        question?: unknown;
        context?: unknown;
      };
      const route = typeof body.route === "string" ? body.route : "/";
      const question = typeof body.question === "string" ? body.question : "";
      if (!question || question.length > 500) {
        return res.status(400).json({ message: "Question is required (max 500 chars)." });
      }
      const context =
        body.context && typeof body.context === "object"
          ? (body.context as Record<string, unknown>)
          : null;
      const answer = await answerAssistant({ route, question, context });
      res.json(answer);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  return httpServer;
}
