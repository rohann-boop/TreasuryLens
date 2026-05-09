import { instruments, treasuryMetrics } from "@shared/schema";
import type {
  Instrument,
  InsertInstrument,
  Treasury,
  InsertTreasury,
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
`);

export interface IStorage {
  listInstruments(): Promise<Instrument[]>;
  getInstrument(id: number): Promise<Instrument | undefined>;
  getInstrumentBySymbol(symbol: string): Promise<Instrument | undefined>;
  createInstrument(data: InsertInstrument): Promise<Instrument>;
  deleteInstrument(id: number): Promise<boolean>;
  getTreasury(instrumentId: number): Promise<Treasury | undefined>;
  upsertTreasury(data: InsertTreasury): Promise<Treasury>;
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
    const payload = { ...data, updatedAt: Date.now() };
    if (existing) {
      return db
        .update(treasuryMetrics)
        .set(payload)
        .where(eq(treasuryMetrics.id, existing.id))
        .returning()
        .get();
    }
    return db.insert(treasuryMetrics).values(payload).returning().get();
  }
}

export const storage = new DatabaseStorage();

// Seed Bitcoin and Metaplanet on first boot
async function seed() {
  const existing = await storage.listInstruments();
  if (existing.length > 0) return;
  await storage.createInstrument({
    symbol: "BTC-USD",
    displayName: "Bitcoin",
    assetClass: "crypto",
    quoteCurrency: "USD",
    dataSource: "yahoo",
    notes: "Reference benchmark for digital assets.",
    sortOrder: 0,
    pinned: true,
  });
  const meta = await storage.createInstrument({
    symbol: "3350.T",
    displayName: "Metaplanet",
    assetClass: "equity",
    quoteCurrency: "JPY",
    dataSource: "yahoo",
    notes: "Tokyo-listed Bitcoin treasury company.",
    sortOrder: 1,
    pinned: true,
  });
  // Seed empty Metaplanet treasury record so the panel renders
  await storage.upsertTreasury({
    instrumentId: meta.id,
    btcHoldings: null,
    sharesOutstanding: null,
    fxRate: null,
    notes:
      "Metaplanet does not publish a real-time API. Enter the latest disclosed BTC holdings and share count from corporate filings to compute BTC NAV and mNAV.",
    updatedAt: Date.now(),
  });
}

seed().catch((e) => console.error("Seed error", e));
