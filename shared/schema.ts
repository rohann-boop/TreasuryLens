import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Instruments tracked in the watchlist
export const instruments = sqliteTable("instruments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().unique(),
  displayName: text("display_name").notNull(),
  assetClass: text("asset_class").notNull(), // 'crypto' | 'equity' | 'index'
  quoteCurrency: text("quote_currency").notNull().default("USD"),
  dataSource: text("data_source").notNull().default("yahoo"), // 'yahoo' | 'coingecko'
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
});

export const insertInstrumentSchema = createInsertSchema(instruments)
  .omit({ id: true })
  .extend({
    symbol: z.string().min(1).max(40),
    displayName: z.string().min(1).max(80),
    assetClass: z.enum(["crypto", "equity", "index"]),
    quoteCurrency: z.string().min(1).max(8).default("USD"),
    dataSource: z.enum(["yahoo", "coingecko"]).default("yahoo"),
    notes: z.string().max(500).optional().nullable(),
    sortOrder: z.number().int().default(0).optional(),
    pinned: z.boolean().default(false).optional(),
  });

export type InsertInstrument = z.infer<typeof insertInstrumentSchema>;
export type Instrument = typeof instruments.$inferSelect;

// Treasury / company-specific manual indicators (e.g. Metaplanet BTC holdings)
export const treasuryMetrics = sqliteTable("treasury_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instrumentId: integer("instrument_id").notNull().unique(),
  btcHoldings: real("btc_holdings"), // BTC count
  sharesOutstanding: real("shares_outstanding"), // share count
  fxRate: real("fx_rate"), // currency to USD if needed (e.g. JPY -> USD)
  notes: text("notes"),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const insertTreasurySchema = createInsertSchema(treasuryMetrics)
  .omit({ id: true })
  .extend({
    instrumentId: z.number().int(),
    btcHoldings: z.number().nonnegative().nullable().optional(),
    sharesOutstanding: z.number().nonnegative().nullable().optional(),
    fxRate: z.number().positive().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    updatedAt: z.number().int().optional(),
  });

export type InsertTreasury = z.infer<typeof insertTreasurySchema>;
export type Treasury = typeof treasuryMetrics.$inferSelect;

// Historical treasury snapshots — captured each time the user edits the
// manual treasury form. Used to compute BTC yield (change in BTC/share over
// time) and other multi-period treasury indicators.
export const treasuryHistory = sqliteTable("treasury_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instrumentId: integer("instrument_id").notNull(),
  btcHoldings: real("btc_holdings"),
  sharesOutstanding: real("shares_outstanding"),
  fxRate: real("fx_rate"),
  capturedAt: integer("captured_at").notNull(),
});

export type TreasuryHistory = typeof treasuryHistory.$inferSelect;

export interface TreasuryHistoryPoint {
  capturedAt: number;
  btcHoldings: number | null;
  sharesOutstanding: number | null;
  btcPerShare: number | null;
}

// Snapshot returned by the API for one instrument (computed indicators)
export type IndicatorTrend = "up" | "down" | "flat";

export interface InstrumentSnapshot {
  instrument: Instrument;
  status: "live" | "demo" | "error";
  source: string;
  asOf: number; // ms since epoch
  price: number | null;
  prevClose: number | null;
  currency: string;
  change1d: number | null; // absolute
  changePct1d: number | null; // %
  return7d: number | null;
  return30d: number | null;
  returnYtd: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  sma20Trend: IndicatorTrend | null;
  sma50Trend: IndicatorTrend | null;
  sma200Trend: IndicatorTrend | null;
  rsi14: number | null;
  vol30dAnnualized: number | null; // %
  high52w: number | null;
  low52w: number | null;
  distFrom52wHigh: number | null; // % below 52w high (negative if below)
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  // Bitcoin-specific
  btcDominance?: number | null;
  // Advanced / risk indicators (deterministic, computed server-side).
  // `null` indicates insufficient history rather than zero.
  maxDrawdownPct: number | null; // worst peak-to-trough decline over available bars (negative %)
  maxDrawdownLookbackDays: number | null; // bars used for the calc
  sharpeLike30d: number | null; // (mean daily return / sd) * sqrt(252) over last 30 trading days
  // Relative metrics vs BTC. For BTC itself these are null with `relIsSelf=true`.
  relIsSelf: boolean;
  relPerf30d: number | null; // (asset 30d %) - (BTC 30d %)
  relPerf90d: number | null;
  corrToBtc30d: number | null; // Pearson correlation of daily log returns
  corrToBtc90d: number | null;
  betaToBtc30d: number | null; // OLS slope of asset returns on BTC returns
  betaToBtc90d: number | null;
  // Fundamentals — may be unavailable for crypto / when provider rate-limits.
  peRatio: number | null; // trailing P/E from quote provider (null = N/A)
  peSource: string | null; // "yahoo" | null — used to badge availability
  // OHLCV history for chart
  history: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  // Treasury info if applicable
  treasury?: TreasurySnapshot | null;
  message?: string;
}

// Compact ticker payload returned by /api/ticker — minimal fields for the
// scrolling ticker strip. Reuses the snapshot cache; never triggers extra
// provider calls when warm.
export interface TickerItem {
  id: number;
  symbol: string;
  displayName: string;
  assetClass: string;
  price: number | null;
  currency: string;
  changePct1d: number | null;
  change1d: number | null;
  status: "live" | "demo" | "error";
  source: string;
  asOf: number;
}

export interface TickerResponse {
  items: TickerItem[];
  asOf: number;
}

export interface TreasurySnapshot {
  btcHoldings: number | null;
  sharesOutstanding: number | null;
  fxRate: number | null;
  // computed
  btcNavUsd: number | null; // holdings * btcPrice
  btcNavPerShare: number | null; // (btcNav in quote currency) / shares
  mNav: number | null; // marketCap / btcNav
  marketCap: number | null;
  notes: string | null;
  updatedAt: number;
  // BTC per share — straight ratio of holdings to shares (BTC units).
  btcPerShare: number | null;
  // Change in BTC/share since first historical snapshot, %
  btcYieldPct: number | null;
  // Number of historical snapshots backing the yield calc
  historyPoints: number;
  // Earliest captured_at used for the yield baseline
  yieldSinceMs: number | null;
  history: TreasuryHistoryPoint[];
}
