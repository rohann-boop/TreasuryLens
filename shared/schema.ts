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
  dataSource: text("data_source").notNull().default("yahoo"), // 'yahoo' | 'coingecko' | 'massive'
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
    dataSource: z.enum(["yahoo", "coingecko", "massive"]).default("yahoo"),
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
  // Default-config (5%/20%/30D/Balanced) model signal — surfaced in
  // comparison/sidebar badges. The full SignalLab fetches per-config
  // computations from /api/instruments/:id/signal.
  defaultSignal?: { label: SignalLabel; score: number; confidence: ConfidenceLabel } | null;
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

// =============================================================================
// Model signals — deterministic research-only buy/sell heuristics computed
// server-side from the snapshot's existing technicals (no LLM, no external
// calls). Surfaced under /api/instruments/:id/signal and consumed by the
// SignalLab UI panel. NOT financial advice — labelled "model signal" in copy.
// =============================================================================

export type ModelProfile = "conservative" | "balanced" | "aggressive";
export type SignalLabel =
  | "Strong Buy"
  | "Buy"
  | "Watch"
  | "Hold"
  | "Trim"
  | "Sell"
  | "Invalid Setup";
export type ConfidenceLabel = "Low" | "Medium" | "High";

export interface SignalConfig {
  downsidePct: number; // e.g. 5 (max acceptable loss)
  upsidePct: number;   // e.g. 20 (target gain)
  horizonDays: 7 | 30 | 90;
  profile: ModelProfile;
  confidenceThreshold: number; // 0-100; gate for actionable Buy/Strong Buy
}

export interface SubModelOutput {
  key: "trend" | "momentum" | "risk" | "valuation";
  name: string;
  score: number; // 0-100
  weight: number; // 0-1 in composite
  bullets: string[]; // explanation lines
  available: boolean; // false if data insufficient — score then 50 (neutral)
}

export interface ModelSignal {
  config: SignalConfig;
  asOf: number;
  // Price levels
  currentPrice: number | null;
  stopPrice: number | null;       // current * (1 - downside%)
  targetPrice: number | null;     // current * (1 + upside%)
  maxChasePrice: number | null;   // upper bound of suggested entry zone
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  exitZoneLow: number | null;
  exitZoneHigh: number | null;
  // Risk math
  rewardRiskRatio: number | null; // upside% / downside%
  // Composite
  compositeScore: number; // 0-100
  confidence: ConfidenceLabel;
  signal: SignalLabel;
  // Sub-models
  models: SubModelOutput[];
  // Logic transparency
  entryConditions: { label: string; pass: boolean }[];
  exitConditions: { label: string; trigger: boolean }[];
  invalidReasons: string[];
  notes: string[];
}

// =============================================================================
// Buffett Index — long-term business-quality and valuation framework. This is
// intentionally separate from Signal Lab, which is a timing/risk model.
// =============================================================================

export type BuffettFramework = "equity" | "bitcoin_treasury" | "not_applicable";

export interface BuffettCategory {
  key:
    | "moat"
    | "returns"
    | "owner_earnings"
    | "balance_sheet"
    | "capital_allocation"
    | "valuation"
    | "treasury_nav"
    | "btc_per_share";
  name: string;
  score: number | null;
  weight: number;
  available: boolean;
  bullets: string[];
}

export interface BuffettIndex {
  asOf: number;
  framework: BuffettFramework;
  applicable: boolean;
  overallScore: number | null;
  label: string;
  dataCoverage: number;
  categories: BuffettCategory[];
  strengths: string[];
  watchouts: string[];
  missingData: string[];
  notes: string[];
  fundamentals?: EquityFundamentals | null;
}

// =============================================================================
// SEC EDGAR equity fundamentals — derived from companyfacts XBRL filings.
// All money fields are in the company's reporting currency (typically USD)
// and represent the most recent reported value unless otherwise noted.
// =============================================================================

export interface FundamentalValue {
  value: number;
  unit: string;
  end: string;            // period end date (YYYY-MM-DD)
  fy: number | null;      // fiscal year
  fp: string | null;      // fiscal period (FY/Q1/Q2/Q3/Q4)
  form: string | null;    // 10-K / 10-Q / etc.
  filed: string | null;   // filing date (YYYY-MM-DD)
  accn: string | null;    // accession number
  tag: string;            // US-GAAP tag chosen
}

export interface EquityFundamentals {
  source: "sec_edgar";
  ticker: string;
  cik: string;
  entityName: string | null;
  asOf: number;
  // raw most-recent values (annual / TTM where appropriate)
  revenue: FundamentalValue | null;        // TTM (sum of last 4 quarters when available, else FY)
  grossProfit: FundamentalValue | null;
  operatingIncome: FundamentalValue | null;
  netIncome: FundamentalValue | null;
  assets: FundamentalValue | null;
  liabilities: FundamentalValue | null;
  equity: FundamentalValue | null;
  totalDebt: FundamentalValue | null;
  currentDebt: FundamentalValue | null;
  longTermDebt: FundamentalValue | null;
  cashAndEquivalents: FundamentalValue | null;
  operatingCashFlow: FundamentalValue | null;
  capex: FundamentalValue | null;          // signed: outflow is negative in our normalised representation
  freeCashFlow: FundamentalValue | null;
  dilutedShares: FundamentalValue | null;
  eps: FundamentalValue | null;
  // derived ratios (unitless or %)
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;
  // growth (year-over-year, %)
  revenueGrowth: number | null;
  epsGrowth: number | null;
  // share count trend over the last ~5 reported periods (slope of log shares)
  shareCountTrend: "rising" | "flat" | "falling" | null;
  shareCountChangePct: number | null;       // % change of shares from oldest to newest in the window
  // metadata for the UI
  latestFiling: { form: string; filed: string; periodEnd: string } | null;
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
