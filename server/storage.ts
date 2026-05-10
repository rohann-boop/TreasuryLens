import { instruments, treasuryMetrics, treasuryHistory } from "@shared/schema";
import type {
  Instrument,
  InsertInstrument,
  Treasury,
  InsertTreasury,
  TreasuryHistory,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, asc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Bootstrap tables (drizzle-kit push not run at runtime)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  quote_currency TEXT NOT NULL DEFAULT 'USD',
  data_source TEXT NOT NULL DEFAULT 'yahoo',
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS treasury_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id INTEGER NOT NULL UNIQUE,
  btc_holdings REAL,
  shares_outstanding REAL,
  fx_rate REAL,
  notes TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS treasury_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id INTEGER NOT NULL,
  btc_holdings REAL,
  shares_outstanding REAL,
  fx_rate REAL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_treasury_history_instrument
  ON treasury_history(instrument_id, captured_at);
`);

export interface IStorage {
  listInstruments(): Promise<Instrument[]>;
  getInstrument(id: number): Promise<Instrument | undefined>;
  getInstrumentBySymbol(symbol: string): Promise<Instrument | undefined>;
  createInstrument(data: InsertInstrument): Promise<Instrument>;
  deleteInstrument(id: number): Promise<boolean>;
  getTreasury(instrumentId: number): Promise<Treasury | undefined>;
  upsertTreasury(data: InsertTreasury): Promise<Treasury>;
  listTreasuryHistory(instrumentId: number): Promise<TreasuryHistory[]>;
}

export class DatabaseStorage implements IStorage {
  async listInstruments(): Promise<Instrument[]> {
    return db
      .select()
      .from(instruments)
      .orderBy(asc(instruments.sortOrder), asc(instruments.id))
      .all();
  }

  async getInstrument(id: number): Promise<Instrument | undefined> {
    return db.select().from(instruments).where(eq(instruments.id, id)).get();
  }

  async getInstrumentBySymbol(symbol: string): Promise<Instrument | undefined> {
    return db
      .select()
      .from(instruments)
      .where(eq(instruments.symbol, symbol))
      .get();
  }

  async createInstrument(data: InsertInstrument): Promise<Instrument> {
    return db.insert(instruments).values(data).returning().get();
  }

  async deleteInstrument(id: number): Promise<boolean> {
    const r = db.delete(instruments).where(eq(instruments.id, id)).run();
    db.delete(treasuryMetrics)
      .where(eq(treasuryMetrics.instrumentId, id))
      .run();
    return r.changes > 0;
  }

  async getTreasury(instrumentId: number): Promise<Treasury | undefined> {
    return db
      .select()
      .from(treasuryMetrics)
      .where(eq(treasuryMetrics.instrumentId, instrumentId))
      .get();
  }

  async upsertTreasury(data: InsertTreasury): Promise<Treasury> {
    const existing = await this.getTreasury(data.instrumentId);
    const now = Date.now();
    const payload = { ...data, updatedAt: now };
    let row: Treasury;
    if (existing) {
      row = db
        .update(treasuryMetrics)
        .set(payload)
        .where(eq(treasuryMetrics.id, existing.id))
        .returning()
        .get();
    } else {
      row = db.insert(treasuryMetrics).values(payload).returning().get();
    }
    // Record a history point only when at least one numeric input is present.
    // Avoids logging blank "placeholder" rows. We also skip if the most
    // recent history row is identical to the new one (no information added).
    if (
      data.btcHoldings != null ||
      data.sharesOutstanding != null ||
      data.fxRate != null
    ) {
      const recent = db
        .select()
        .from(treasuryHistory)
        .where(eq(treasuryHistory.instrumentId, data.instrumentId))
        .orderBy(asc(treasuryHistory.capturedAt))
        .all();
      const last = recent[recent.length - 1];
      const same =
        last &&
        last.btcHoldings === (data.btcHoldings ?? null) &&
        last.sharesOutstanding === (data.sharesOutstanding ?? null) &&
        last.fxRate === (data.fxRate ?? null);
      if (!same) {
        db.insert(treasuryHistory)
          .values({
            instrumentId: data.instrumentId,
            btcHoldings: data.btcHoldings ?? null,
            sharesOutstanding: data.sharesOutstanding ?? null,
            fxRate: data.fxRate ?? null,
            capturedAt: now,
          })
          .run();
      }
    }
    return row;
  }

  async listTreasuryHistory(instrumentId: number): Promise<TreasuryHistory[]> {
    return db
      .select()
      .from(treasuryHistory)
      .where(eq(treasuryHistory.instrumentId, instrumentId))
      .orderBy(asc(treasuryHistory.capturedAt))
      .all();
  }
}

export const storage = new DatabaseStorage();

// Default instruments — idempotently ensured on every boot. New entries
// added here are added to existing databases without duplicating.
const DEFAULT_INSTRUMENTS: InsertInstrument[] = [
  {
    symbol: "BTC-USD",
    displayName: "Bitcoin",
    assetClass: "crypto",
    quoteCurrency: "USD",
    dataSource: "yahoo",
    notes: "Reference benchmark for digital assets.",
    sortOrder: 0,
    pinned: true,
  },
  {
    symbol: "MTPLF",
    displayName: "Metaplanet",
    assetClass: "equity",
    quoteCurrency: "USD",
    dataSource: "massive",
    notes: "US OTC listing for Japan-based Bitcoin treasury company.",
    sortOrder: 1,
    pinned: true,
  },
  {
    symbol: "TSLA",
    displayName: "Tesla",
    assetClass: "equity",
    quoteCurrency: "USD",
    dataSource: "massive",
    notes: "NASDAQ-listed equity tracked alongside crypto-treasury names.",
    sortOrder: 2,
    pinned: true,
  },
];

async function ensureSeed() {
  // One-time migration: prior builds seeded the Tokyo listing (3350.T). The
  // user now wants the US OTC listing. Updating in place preserves the same
  // instrument id and any manually entered Metaplanet treasury metrics.
  const legacyMeta = await storage.getInstrumentBySymbol("3350.T");
  const usMeta = await storage.getInstrumentBySymbol("MTPLF");
  if (legacyMeta && !usMeta) {
    sqlite
      .prepare(
        `UPDATE instruments
         SET symbol = ?, quote_currency = ?, data_source = ?, notes = ?
         WHERE id = ?`,
      )
      .run(
        "MTPLF",
        "USD",
        "massive",
        "US OTC listing for Japan-based Bitcoin treasury company.",
        legacyMeta.id,
      );
  }

  for (const def of DEFAULT_INSTRUMENTS) {
    const existing = await storage.getInstrumentBySymbol(def.symbol);
    if (!existing) {
      await storage.createInstrument(def);
    } else if (def.symbol === "MTPLF" || def.symbol === "TSLA") {
      sqlite
        .prepare(
          `UPDATE instruments
           SET data_source = ?, quote_currency = ?, notes = ?
           WHERE id = ?`,
        )
        .run(def.dataSource, def.quoteCurrency, def.notes ?? null, existing.id);
    }
  }
  // Seed empty Metaplanet treasury record so the panel renders — only if
  // no row exists yet (preserves user edits on subsequent boots).
  const meta = await storage.getInstrumentBySymbol("MTPLF");
  if (meta) {
    const t = await storage.getTreasury(meta.id);
    if (!t) {
      await storage.upsertTreasury({
        instrumentId: meta.id,
        btcHoldings: null,
        sharesOutstanding: null,
        fxRate: null,
        notes:
          "Metaplanet does not publish a real-time API. Enter the latest disclosed BTC holdings and share count from corporate filings to compute BTC NAV, mNAV, BTC/share and BTC yield.",
        updatedAt: Date.now(),
      });
    }
  }
}

ensureSeed().catch((e) => console.error("Seed error", e));
