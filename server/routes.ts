import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { buildSnapshot } from "./marketData";
import {
  insertInstrumentSchema,
  insertTreasurySchema,
  type InstrumentSnapshot,
  type TreasurySnapshot,
} from "@shared/schema";
import { z } from "zod";

// Tiny in-memory cache for snapshots: 60s TTL
const cache = new Map<string, { at: number; data: InstrumentSnapshot }>();
const TTL_MS = 60_000;

async function getSnapshot(
  instrumentId: number,
  force = false,
): Promise<InstrumentSnapshot | null> {
  const inst = await storage.getInstrument(instrumentId);
  if (!inst) return null;
  const key = `${inst.id}:${inst.symbol}`;
  const c = cache.get(key);
  if (!force && c && Date.now() - c.at < TTL_MS) return c.data;
  const snap = await buildSnapshot(inst);
  // Attach treasury data if present
  const t = await storage.getTreasury(inst.id);
  if (t) {
    let btcSpot: number | null = null;
    if (t.btcHoldings != null) {
      // Need a BTC USD price — find BTC instrument snapshot or fetch
      const btcInst = await storage.getInstrumentBySymbol("BTC-USD");
      if (btcInst) {
        const btcKey = `${btcInst.id}:${btcInst.symbol}`;
        let btcSnap: InstrumentSnapshot | undefined =
          cache.get(btcKey)?.data;
        if (!btcSnap || Date.now() - (cache.get(btcKey)?.at ?? 0) > TTL_MS) {
          btcSnap = await buildSnapshot(btcInst);
          cache.set(btcKey, { at: Date.now(), data: btcSnap });
        }
        btcSpot = btcSnap.price;
      }
    }
    const btcNavUsd =
      t.btcHoldings != null && btcSpot != null ? t.btcHoldings * btcSpot : null;
    // fxRate convention: units of quote currency per 1 USD (e.g. JPY≈150).
    // For USD-quoted instruments, default to 1.
    const fx = t.fxRate ?? (snap.currency === "USD" ? 1 : null);
    const btcNavQuote =
      btcNavUsd != null && fx != null ? btcNavUsd * fx : null;
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
    };
    snap.treasury = treasury;
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
      // dedupe symbol
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

  // Bulk snapshots
  app.get("/api/snapshots", async (req, res) => {
    const force = req.query.refresh === "1";
    const list = await storage.listInstruments();
    const snaps = await Promise.all(
      list.map((i) => getSnapshot(i.id, force).catch(() => null)),
    );
    res.json(snaps.filter(Boolean));
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
      // bust cache
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

  return httpServer;
}
