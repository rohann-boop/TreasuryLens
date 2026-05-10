import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { buildSnapshot } from "./marketData";
import type { Bar } from "./indicators";
import { computeSignal, parseSignalConfig, DEFAULT_CONFIG } from "./signals";
import { computeBuffettIndex } from "./buffett";
import { getEquityFundamentals } from "./secEdgar";
import {
  insertInstrumentSchema,
  insertTreasurySchema,
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
    if (snap.instrument.assetClass === "equity") {
      try {
        fundamentals = await getEquityFundamentals(snap.instrument.symbol);
      } catch {
        fundamentals = null;
      }
    }
    res.json(computeBuffettIndex(snap, fundamentals));
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

  return httpServer;
}
