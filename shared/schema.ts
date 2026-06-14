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
  managementGovernance?: ManagementGovernance | null;
}

// =============================================================================
// Management & Governance — best-effort extraction from SEC filings
// (10-K / DEF 14A / 8-K Item 5.02). Heuristic by design; fields are nullable
// and a confidence label tells the UI/scoring how much weight to give.
// =============================================================================

export type GovernanceConfidence = "high" | "medium" | "low" | "unknown";

export interface GovernanceFilingRef {
  form: string;            // "10-K" | "DEF 14A" | "8-K" | etc.
  filed: string;           // YYYY-MM-DD
  accessionNumber: string; // formatted accession number
  primaryDoc: string | null;
  url: string;             // canonical SEC URL
  reportDate?: string | null;
  items?: string | null;   // 8-K item codes if present (e.g. "5.02")
}

export interface GovernanceLeader {
  name: string;
  role: string;       // CEO / CFO / Chair / Director / etc.
  source: "10-K" | "DEF 14A" | "8-K" | "heuristic";
}

export interface GovernanceChange {
  date: string;          // YYYY-MM-DD (filing date)
  description: string;   // short summary
  filing: GovernanceFilingRef;
}

export interface ManagementGovernance {
  ticker: string;
  cik: string | null;
  asOf: number;
  applicable: boolean;
  // Extracted leaders. May be empty when extraction fails.
  leaders: GovernanceLeader[];
  // Free-form governance notes (e.g. "Combined Chair/CEO" or board size).
  notes: string[];
  // Recent management changes detected in 8-K Item 5.02 filings.
  recentChanges: GovernanceChange[];
  // Filings used as sources for the data above (most recent first).
  sources: GovernanceFilingRef[];
  // Fields that could not be extracted ("ceo", "cfo", "chair", ...).
  missingFields: string[];
  // Score (0-100) and confidence — conservative when extraction is weak.
  score: number | null;
  confidence: GovernanceConfidence;
  // One-line summary for the panel header.
  summary: string;
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
  // Anchor date used for freshness checks (latest balance-sheet / income
  // statement period end, YYYY-MM-DD). Facts with `end` more than
  // `freshnessWindowDays` before this anchor are rejected and surfaced in
  // `staleFacts` instead of populating the field.
  anchorDate: string | null;
  freshnessWindowDays: number;
  // Tags rejected for staleness, plus tags whose data is genuinely missing.
  // Used by the UI/scoring layer to explain why a field is null.
  staleFacts: Array<{
    field: string;
    tag: string;
    end: string;
    ageDays: number;
  }>;
  missingFields: string[];
}

// =============================================================================
// 13F-HR institutional holdings — parsed from SEC EDGAR filings for a fixed
// set of "superinvestor" managers (Berkshire, Pershing Square, Bridgewater,
// Scion). Surfaced under /api/13f/summary and rendered on a dedicated page.
// =============================================================================

export type ManagerKey =
  | "berkshire"
  | "pershing"
  | "bridgewater"
  | "scion"
  | "situational";

export interface ThirteenFHolding {
  cusip: string;
  issuer: string;
  titleOfClass: string;
  value: number; // dollars
  shares: number;
  shareType: string; // "SH" | "PRN" | etc.
  putCall: string | null; // null for long, "Put" / "Call" otherwise
  investmentDiscretion: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
  weight: number; // % of portfolio value
}

export interface ThirteenFFiling {
  accession: string;
  filingDate: string; // YYYY-MM-DD
  reportDate: string; // YYYY-MM-DD (quarter end)
  form: string;       // "13F-HR" | "13F-HR/A"
  primaryDocUrl: string;
  filingIndexUrl: string;
  infoTableUrl: string | null;
  holdingsCount: number;
  totalValue: number;
}

export interface PositionChange {
  cusip: string;
  issuer: string;
  titleOfClass: string;
  putCall: string | null;
  shareType: string;
  newShares: number;
  previousShares: number;
  shareChange: number;
  shareChangePct: number | null; // null when previousShares = 0
  newValue: number;
  previousValue: number;
  valueChange: number;
  weight: number; // current portfolio weight (0 for sold)
}

export interface Manager13FSummary {
  key: ManagerKey;
  manager: string;
  firm: string;
  cik: string;
  status: "ok" | "error" | "no-filing";
  error: string | null;
  latestFiling: ThirteenFFiling | null;
  previousFiling: ThirteenFFiling | null;
  totalValue: number;
  previousTotalValue: number | null;
  holdingsCount: number;
  topHoldings: ThirteenFHolding[];
  allHoldings: ThirteenFHolding[];
  newPositions: PositionChange[];
  increasedPositions: PositionChange[];
  reducedPositions: PositionChange[];
  soldPositions: PositionChange[];
}

export interface ThirteenFSummaryResponse {
  managers: Manager13FSummary[];
  lastUpdated: number;
  sources: { label: string; url: string }[];
  notes: string;
}

// =============================================================================
// Politicians — STOCK Act Periodic Transaction Reports (PTRs) and Annual
// Financial Disclosures from the U.S. House Clerk and Senate. PTR data is
// published as PDFs on a 30-45 day delay and uses dollar value ranges, not
// share counts. We surface a graceful source-linked view rather than a parsed
// portfolio: the curated list of recent disclosures comes from a small static
// config and the live API enriches it with fetch metadata when available.
// =============================================================================

export type PoliticianKey = "pelosi";

export interface PoliticianDisclosureLink {
  label: string;       // human-readable, e.g. "2025 PTR — March"
  url: string;         // canonical public source
  source: string;      // "House Clerk" | "Senate" | etc.
  filed?: string | null; // YYYY-MM-DD if known
  notes?: string | null;
}

export interface PoliticianSummary {
  key: PoliticianKey;
  name: string;
  role: string;        // e.g. "U.S. Representative"
  party: string | null;
  state: string | null;
  status: "ok" | "no-data";
  disclosurePortalUrl: string;   // root listing for this person
  disclosureDelayNote: string;   // boilerplate compliance note
  disclosures: PoliticianDisclosureLink[];
  // Reserved for future deterministic parsing — we surface an empty array
  // today and label this as STOCK Act range-based data, not 13F holdings.
  recentTransactions: never[];
  notes: string[];
}

export interface PoliticiansSummaryResponse {
  politicians: PoliticianSummary[];
  lastUpdated: number;
  sources: { label: string; url: string }[];
  notes: string;
}

// =============================================================================
// Stock Picks / Themes — curated research watchlists grouped by theme and
// market-cap bucket. Static/curated data; NOT personalized investment advice.
// Scenario potentials are hypothetical and explicitly labelled as such.
// =============================================================================

export type StockPickTheme = "ai-hardware" | "ai-software" | "ai-energy";

export type MarketCapBucket = "micro" | "small" | "mid" | "large" | "mega";

export type ScenarioPotential =
  | "2x potential"
  | "3x potential"
  | "5x potential"
  | "compounder"
  | "defensive"
  | "speculative";

export type RiskLevel = "low" | "moderate" | "elevated" | "high" | "very high";

export type DataConfidence = "curated" | "approximate" | "low";

// Historical price performance for a stock pick — nearest-trading-day
// lookbacks at 1m/6m/12m. Each window is independent so the UI can render
// what's available even when the series is short (newly-listed names).
export interface StockPickPerformance {
  // Day-over-day move: latest close vs the prior trading day's close. Null when
  // fewer than two daily bars are available (e.g. freshly listed names).
  price1dAgo: number | null;
  price1dDate: string | null; // YYYY-MM-DD of the prior trading-day bar used
  change1dPct: number | null; // %
  price1mAgo: number | null;
  price1mDate: string | null; // YYYY-MM-DD of the actual bar used
  change1mPct: number | null; // %
  price6mAgo: number | null;
  price6mDate: string | null;
  change6mPct: number | null;
  price12mAgo: number | null;
  price12mDate: string | null;
  change12mPct: number | null;
  source: string; // e.g. "massive" | "yahoo" | "unavailable"
  confidence: DataConfidence;
  warnings: string[];
}

// Key metrics block attached to each StockPick. All numeric fields are
// nullable — for non-US issuers SEC EDGAR returns nothing, for negative
// earnings P/E is undefined, and live pricing may be unavailable. The UI
// renders "N/A" plus a warning rather than fabricating a value.
export interface StockPickKeyMetrics {
  price: number | null;
  priceCurrency: string | null;
  marketCap: number | null; // USD where available
  marketCapLabel: string | null; // human label e.g. "$3.1T"
  peRatio: number | null; // trailing; null when negative/unavailable
  revenueGrowth: number | null; // % YoY
  grossMargin: number | null; // %
  operatingMargin: number | null; // %
  fcfMargin: number | null; // %
  debtToEquity: number | null; // ratio
  // Raw fundamental anchors (USD / shares / per-share) for the fundamentals
  // driven scenario bridge. Populated from SEC EDGAR where available; null for
  // non-US issuers, sparse filers, or negative-earnings names. These are the
  // starting points the V2 scenario model multiplies forward — kept separate
  // from the derived ratios above so the bridge math is inspectable.
  revenueTtm?: number | null; // USD trailing-twelve-month revenue
  operatingIncomeTtm?: number | null; // USD TTM operating income
  netIncomeTtm?: number | null; // USD TTM net income
  netMargin?: number | null; // % (net income / revenue)
  sharesOutstanding?: number | null; // count (diluted weighted avg or cover-page)
  epsTtm?: number | null; // USD per share, TTM diluted
  fundamentalsAsOf?: string | null; // period end (YYYY-MM-DD) of the anchors
  metricSource: string; // e.g. "yahoo+sec_edgar" | "sec_edgar" | "curated" | "unavailable"
  metricAsOf: number | null; // ms since epoch
  metricConfidence: DataConfidence;
  metricWarnings: string[]; // human-readable warnings (e.g. "Needs fundamentals provider")
  // Historical price performance (1m/6m/12m). Null when no history available.
  performance?: StockPickPerformance | null;
}

// Sub-themes provide finer-grained categorisation under the broad theme.
// Curated; optional. UI uses them for an extra filter when the list grows large.
export type StockPickSubTheme =
  // AI Hardware
  | "semiconductors"
  | "memory"
  | "semi-equipment"
  | "networking"
  | "optical"
  | "datacenter-hardware"
  | "edge-ai"
  // AI Software
  | "hyperscalers"
  | "data-platforms"
  | "cybersecurity"
  | "automation"
  | "enterprise-apps"
  | "developer-tools"
  | "ai-apps"
  | "vertical-software"
  // AI Energy
  | "nuclear"
  | "utilities"
  | "ipps"
  | "grid-equipment"
  | "datacenter-power"
  | "engineering"
  | "energy-storage"
  | "uranium";

// =============================================================================
// Scenario model — deterministic, transparent bull/base/bear math attached to
// each stock pick. Assumptions and outputs are visible so the 2x/3x labels are
// backed by formulas, not just curated opinion. Not a prediction or advice.
// =============================================================================

export type ScenarioCaseKey = "bear" | "base" | "bull";

// Provenance tag for each derivation input. Lets the UI render a source badge
// per row so users can see whether a number came from a live quote, SEC
// fundamentals, a TreasuryLens assumption, or a heuristic fallback.
export type ScenarioSource =
  | "market-data" // live price / market cap from a quote provider
  | "sec-fundamentals" // SEC EDGAR reported figure (revenue, margin, shares…)
  | "analyst-estimate" // consensus / analyst-sourced figure (not wired yet)
  | "treasurylens-assumption" // an explicit TreasuryLens modelling assumption
  | "fallback-heuristic" // value carried over from the curated-bands heuristic
  | "unavailable"; // input could not be sourced

// How the model arrived at the bull/base/bear cases.
//   - fundamentals-driven: revenue × margin × multiple bridge using SEC data.
//   - hybrid: fundamentals for some legs, TreasuryLens assumptions for others.
//   - fallback-heuristic: the original curated-bands multiple model (sparse data).
export type ScenarioMethod =
  | "fundamentals-driven"
  | "hybrid"
  | "fallback-heuristic";

// One derivation row: a labelled value with its unit and source badge. Surfaced
// directly in the "How this was derived" UI.
export interface ScenarioDerivationRow {
  key: string; // stable key e.g. "revenueCagr"
  label: string; // human label e.g. "Revenue CAGR"
  value: number | null; // numeric value (null when unavailable)
  unit: "pct" | "usd" | "x" | "price" | "shares" | "ratio" | "none";
  display: string; // pre-formatted human string e.g. "18.0%", "$1.2T"
  source: ScenarioSource;
  note?: string; // optional short clarification
}

// Fundamentals-driven derivation attached to each case. Every field is the
// explicit bridge from today's revenue to a target price. Null fields mean the
// input was unavailable and an assumption/fallback was used instead.
export interface ScenarioCaseDerivation {
  // The ordered rows the UI renders (revenue CAGR → future revenue → margin →
  // earnings proxy → multiple → implied equity value → share bridge → target).
  rows: ScenarioDerivationRow[];
  futureRevenue: number | null; // USD, at horizon
  marginPct: number | null; // terminal operating/net margin used
  earningsProxy: number | null; // USD, future revenue × margin (op income / net income proxy)
  valuationMultiple: number | null; // P/E or P/S applied to the earnings/revenue proxy
  valuationBasis: "P/E" | "P/S" | null; // which multiple basis was used
  impliedEquityValue: number | null; // USD market cap implied
  shareCount: number | null; // shares used in the per-share bridge
  targetPrice: number | null; // implied equity value / shares
}

export interface ScenarioCaseAssumptions {
  revenueCagrPct: number; // % annualised, over horizon
  terminalMarginPct: number; // % e.g. operating/FCF margin at horizon
  exitMultipleChangePct: number; // % change vs current valuation multiple
  dilutionPct: number; // % share dilution over horizon
  executionProbability: number; // 0-1 rough subjective weight
  rationale: string[]; // short bullets
}

export interface ScenarioCaseOutputs {
  targetMultipleOfCurrent: number; // e.g. 0.6 (bear), 1.5 (base), 3.0 (bull)
  impliedReturnPct: number; // % over the horizon, simple total
  targetPrice: number | null; // current price * multiple, or null if no price
  targetMarketCap: number | null; // current mcap * multiple, or null
  requiredCagrPct: number; // annualised CAGR implied by the multiple over horizonYears
  warning: string | null;
}

export interface ScenarioCase {
  key: ScenarioCaseKey;
  label: string; // human label e.g. "Bull case"
  assumptions: ScenarioCaseAssumptions;
  outputs: ScenarioCaseOutputs;
  // Present only on the fundamentals-driven / hybrid path. Null on the pure
  // fallback-heuristic path (the curated-bands model has no revenue bridge).
  derivation?: ScenarioCaseDerivation | null;
}

export type ScenarioClassification =
  | "defensive"
  | "compounder"
  | "2x potential"
  | "3x potential"
  | "5x potential"
  | "speculative";

export type ScenarioModelType =
  | "curated-bands-v1"
  | "curated-bands-with-price-v1"
  // Fundamentals-driven revenue×margin×multiple bridge (V2). The "-hybrid"
  // variant mixes SEC fundamentals with TreasuryLens assumptions where a leg
  // was unavailable.
  | "fundamentals-bridge-v1"
  | "fundamentals-bridge-hybrid-v1";

export interface ScenarioModel {
  horizonYears: number; // e.g. 5
  modelType: ScenarioModelType;
  modelConfidence: DataConfidence;
  modelWarnings: string[];
  methodology: string; // one-paragraph explanation of how the cases were derived
  classification: ScenarioClassification;
  bear: ScenarioCase;
  base: ScenarioCase;
  bull: ScenarioCase;
  // Convenience top-level outputs derived from the cases above. Rounded.
  bullUpsidePct: number; // bull.impliedReturnPct
  bearDownsidePct: number; // bear.impliedReturnPct (typically negative)
  rewardRiskRatio: number | null; // bullUpside / |bearDownside|, null if denom=0
  disclaimer: string;
  // V2 derivation metadata. `method` says which path produced the cases;
  // `coverageConfidence` rolls up how much real fundamental data backed it.
  // `derivationInputs` lists the shared starting points (current price, TTM
  // revenue, base margin, shares, base multiple) with source badges, and
  // `missingInputs` names anything that fell back to an assumption.
  method?: ScenarioMethod;
  coverageConfidence?: "high" | "medium" | "low";
  derivationInputs?: ScenarioDerivationRow[];
  missingInputs?: string[];
  // Optional analyst-estimate source block. Present (with an explicit status)
  // when analyst estimates were attempted for the name; absent on the pure
  // curated/heuristic path or when no fetch was performed. Estimates anchor or
  // sanity-check assumptions; the price target is reference-only.
  analystEstimates?: ScenarioAnalystBlock | null;
}

export interface StockPick {
  ticker: string;
  companyName: string;
  themes: StockPickTheme[];
  subTheme?: StockPickSubTheme | null;
  marketCapBucket: MarketCapBucket;
  marketCapLabel: string; // curated human label e.g. "Mega cap (curated)"
  scenarioPotential: ScenarioPotential;
  convictionScore: number; // 0-100, opinion only
  riskLevel: RiskLevel;
  downsideGuardrail: string; // short phrase
  upsideCase: string; // short phrase / scenario sentence
  whatMustBeTrue: string[]; // bullet list of preconditions
  thesis: string[]; // bullet list of why this is on the watchlist
  risks: string[]; // bullet list of risks
  removalTriggers: string[]; // what would take it off the list
  dataConfidence: DataConfidence;
  sourceNote: string; // e.g. "Curated by TreasuryLens — figures approximate"
  // Optional country/issuer hint used when SEC EDGAR is not applicable.
  issuerCountry?: string | null;
  keyMetrics?: StockPickKeyMetrics | null;
  scenarioModel?: ScenarioModel | null;
}

export interface StockPickThemeInfo {
  key: StockPickTheme;
  name: string;
  blurb: string;
}

// Diversified ETF / index / fund options for users who want theme exposure
// without picking individual stocks. These are curated. Expense ratios and
// holdings notes are approximate; verify on the fund issuer's site.
export type ExposureType = "ETF" | "Index Fund" | "Mutual Fund" | "Index";

// Key metrics block attached to each ETF. Mirrors StockPickKeyMetrics but
// uses ETF-appropriate fields: AUM / net assets in place of market cap, no
// P/E, and a curated expense ratio. Numeric fields are nullable for the same
// reasons as the equity version — providers may be unavailable.
export interface StockPickEtfMetrics {
  price: number | null;
  priceCurrency: string | null;
  aum: number | null; // USD net assets where curated
  aumLabel: string | null; // human label e.g. "$24.5B"
  expenseRatio: number | null; // % e.g. 0.35
  metricSource: string; // e.g. "massive+curated"
  metricAsOf: number | null; // ms since epoch
  metricConfidence: DataConfidence;
  metricWarnings: string[];
  performance?: StockPickPerformance | null;
}

export interface StockPickEtf {
  ticker: string;
  name: string;
  themes: StockPickTheme[];
  exposureType: ExposureType;
  themeFit: string; // one-liner: how it maps to the theme
  whyUseIt: string; // when this is a sensible exposure choice
  tradeoffs: string; // what you give up vs picking single stocks
  expenseRatio: number | null; // % e.g. 0.35
  // Curated AUM (USD) at time of curation. Approximate — verify on issuer
  // site. Null if not curated.
  aum?: number | null;
  concentrationNote: string | null; // e.g. "Top 10 ~60% of fund"
  topHoldingsNote: string | null; // e.g. "Concentrated in NVDA/AVGO/AMD"
  riskLevel: RiskLevel;
  // Leveraged/inverse warning if applicable. Curated and surfaced in the UI
  // alongside the risk badge.
  leveraged?: boolean;
  dataConfidence: DataConfidence;
  sourceNote: string;
  keyMetrics?: StockPickEtfMetrics | null;
}

export interface ScenarioMethodology {
  modelType: ScenarioModelType;
  horizonYears: number;
  summary: string; // one paragraph plain-English description
  notes: string[]; // bullet list of caveats
  classificationBands: {
    classification: ScenarioClassification;
    bullUpsidePctMin: number; // bull case ≥ this implied return %
    description: string;
  }[];
  disclaimer: string;
}

export interface StockPicksResponse {
  themes: StockPickThemeInfo[];
  picks: StockPick[];
  etfs: StockPickEtf[];
  lastUpdated: number;
  disclaimer: string;
  notes: string;
  metricsStatus: {
    livePricing: boolean; // true if pricing provider was queried successfully for at least one pick
    fundamentals: boolean; // true if SEC EDGAR was queried
    note: string;
  };
  scenarioMethodology: ScenarioMethodology;
}

// =============================================================================
// Scenario backtest — 1Y price-history reconstruction by current scenario
// classification. NOT a point-in-time recommendation audit: we do not freeze
// the universe, fundamentals, or scenario labels as of one year ago. We label
// each pick with its current classification and measure how that bucket would
// have performed on a price-only basis over the lookback window.
// =============================================================================

export interface BacktestStockResult {
  ticker: string;
  companyName: string;
  themes: StockPickTheme[];
  subTheme: StockPickSubTheme | null;
  classification: ScenarioClassification;
  entryPrice: number | null;
  entryDate: string | null; // YYYY-MM-DD
  latestPrice: number | null;
  latestDate: string | null; // YYYY-MM-DD
  returnPct: number | null; // (latest - entry) / entry * 100
  maxDrawdownPct: number | null; // worst peak-to-trough from entry to latest, % (negative)
  spyReturnPct: number | null; // SPY return over same calendar window, %
  qqqReturnPct: number | null; // QQQ return over same calendar window, %
  beatSpy: boolean | null;
  beatQqq: boolean | null;
  source: string; // "massive" | "yahoo" | "unavailable"
  warning: string | null; // short note if data was thin
}

export interface BacktestBucketAgg {
  classification: ScenarioClassification;
  count: number;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  hitRatePct: number | null; // % of names with positive return
  avgMaxDrawdownPct: number | null;
  beatSpyRatePct: number | null; // % of names that beat SPY
  beatQqqRatePct: number | null; // % of names that beat QQQ
}

export interface BacktestSummary {
  tested: number; // names with a return value
  skipped: number; // names missing pricing
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  hitRatePct: number | null;
  avgMaxDrawdownPct: number | null;
  bestBucket: ScenarioClassification | null; // bucket with highest avgReturnPct
  worstBucket: ScenarioClassification | null;
  spyReturnPct: number | null;
  qqqReturnPct: number | null;
  beatSpyRatePct: number | null;
  beatQqqRatePct: number | null;
}

export interface BacktestResponse {
  asOf: number; // ms since epoch
  lookbackDays: number; // 365
  windowStartDate: string | null; // ISO date of the entry bar used for the universe
  windowEndDate: string | null; // ISO date of the latest bar
  benchmark: {
    spy: {
      entryPrice: number | null;
      latestPrice: number | null;
      returnPct: number | null;
      entryDate: string | null;
      latestDate: string | null;
    };
    qqq: {
      entryPrice: number | null;
      latestPrice: number | null;
      returnPct: number | null;
      entryDate: string | null;
      latestDate: string | null;
    };
  };
  summary: BacktestSummary;
  buckets: BacktestBucketAgg[];
  stocks: BacktestStockResult[];
  limitations: string[];
  methodology: string;
  disclaimer: string;
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

// =============================================================================
// Conviction Ideas — a focused idea-tracking workflow for a small set of
// high-conviction research candidates. Unlike Stock Picks (a broad curated
// watchlist), this is a deliberate, narrow list with explicit "what must be
// true", kill criteria, and review guardrails. Research/education only — not
// personalized advice, and the position-sizing bands are educational labels,
// not allocation guidance.
// =============================================================================

// Role / bucket the idea plays in a research book. Drives left-pane grouping.
export type ConvictionRole =
  | "core-compounder"
  | "asymmetric-candidate"
  | "high-variance-optionality";

// Educational position-sizing band. NOT a recommendation to allocate any
// particular amount — these are labels describing how a researcher might
// *think about* an idea's place on a watchlist.
export type ConvictionSizingBand = "watchlist" | "starter" | "core";

export type ConvictionReviewStatus =
  | "fresh"
  | "monitoring"
  | "needs-review";

// A single checklist dimension the researcher scores qualitatively. Score is a
// coarse 0-100 self-assessment; rationale explains it. Not a model output.
export interface ConvictionChecklistItem {
  key:
    | "thesis-strength"
    | "valuation"
    | "momentum"
    | "management"
    | "balance-sheet"
    | "catalyst-clarity"
    | "data-confidence";
  label: string;
  score: number; // 0-100 qualitative self-assessment
  note: string;
}

// Thematic section an idea belongs to. Sections are the primary grouping in
// the UI selector (e.g. "Bravos", "Core AI compounders"). An idea has exactly
// one primary section to avoid duplicate cards, but may carry extra theme tags.
// Curated section keys. User-created groups produce synthetic keys of the form
// `custom-<slug>`, so the type also admits arbitrary strings while keeping the
// curated keys as autocomplete hints.
export type ConvictionCuratedSectionKey =
  | "bravos"
  | "core-ai-compounders"
  | "semiconductors-ai-hardware"
  | "speculative-ai-infra"
  | "ai-power-grid"
  | "ai-software-data"
  | "frontier-high-upside"
  | "other";

export type ConvictionSectionKey = ConvictionCuratedSectionKey | (string & {});

export interface ConvictionSectionInfo {
  key: ConvictionSectionKey;
  label: string;
  blurb: string;
}

export interface ConvictionIdea {
  id: string; // stable slug e.g. "tsla"
  ticker: string; // canonical ticker used by app conventions
  companyName: string;
  role: ConvictionRole;
  roleLabel: string; // human label e.g. "High-variance optionality"
  // Primary thematic section for selector grouping. Optional for backward
  // compatibility with user-added ideas, which default to "other".
  sectionKey?: ConvictionSectionKey;
  sectionLabel?: string;
  themes: string[]; // free-form theme tags (autonomy, robotics, ...)
  timeHorizon: string; // e.g. "Long-term (5y+)"
  targetOutcome: string; // e.g. "Optionality — 3x/5x on success"
  convictionScore: number; // 0-100, opinion only
  dataConfidence: DataConfidence;
  thesis: string[]; // why it's a candidate
  whatMustBeTrue: string[]; // preconditions for the thesis to play out
  catalysts: string[]; // what could move it
  risks: string[]; // key risks
  killCriteria: string[]; // what would remove it from the list
  downsideGuardrail: string; // short phrase — the floor / why it isn't zero
  positionSizingBand: ConvictionSizingBand;
  positionSizingNote: string; // educational framing for the band
  reviewFrequency: string; // e.g. "Quarterly + on major catalysts"
  reviewStatus: ConvictionReviewStatus;
  sourceNote: string;
  checklist: ConvictionChecklistItem[];
  // True for user-added ideas (vs. curated defaults). User-added ideas carry
  // lighter curated content. All ideas are removable.
  custom?: boolean;
  // True when no real thesis/catalysts/risks have been authored yet (e.g. a
  // freshly added custom ticker). The detail pane renders a "Thesis pending"
  // state instead of placeholder bullets. Market data still loads normally.
  thesisPending?: boolean;
  // Enrichment, attached server-side. Null when providers are unavailable.
  keyMetrics?: StockPickKeyMetrics | null;
  scenarioModel?: ScenarioModel | null;
}

export interface ConvictionRoleInfo {
  key: ConvictionRole;
  label: string;
  blurb: string;
}

export interface ConvictionIdeasResponse {
  roles: ConvictionRoleInfo[];
  // Thematic sections, in display order. The UI groups the selector by these.
  sections: ConvictionSectionInfo[];
  ideas: ConvictionIdea[];
  lastUpdated: number;
  disclaimer: string;
  notes: string;
  metricsStatus: {
    livePricing: boolean;
    fundamentals: boolean;
    note: string;
  };
}

// Compact price + moving-average chart series for a single conviction idea.
// Points are downsampled daily closes; ma50/ma200 are simple moving averages
// aligned to the same points (null until enough history exists).
export interface ConvictionChartPoint {
  t: number; // epoch ms (trading day)
  c: number; // close
  ma50: number | null;
  ma200: number | null;
}

// A single breakout event: a close that cleared the prior N-day high. The
// `window` is the lookback length (20 or 50) and `priorHigh` is the highest
// close over the N bars *before* this one (current bar excluded). When volume
// bars exist, `volumeConfirmed` is true if that day's volume exceeded the
// 20-day average; null means volume data was unavailable.
export interface ConvictionBreakoutPoint {
  t: number; // epoch ms (trading day the breakout closed)
  c: number; // close on the breakout day
  window: 20 | 50;
  priorHigh: number;
  volumeConfirmed: boolean | null;
}

// Latest breakout status for the chart. `status` is "breakout" when the most
// recent bar itself broke out, "recent" when a breakout happened within the
// recent lookback but not on the latest bar, "none" when no recent breakout,
// and "unavailable" when there is not enough history to evaluate.
export interface ConvictionBreakoutStatus {
  status: "breakout" | "recent" | "none" | "unavailable";
  // Strongest window cleared on the latest breakout (50 ranks above 20).
  latestWindow: 20 | 50 | null;
  latestAt: number | null; // epoch ms of the most recent breakout
  volumeConfirmed: boolean | null; // for the most recent breakout
  volumeAvailable: boolean; // whether any volume data was present
  points: ConvictionBreakoutPoint[]; // recent breakouts (ascending by t)
  note: string;
}

// Selectable chart time windows. Daily-bar source means the shortest
// practical windows still render daily closes (no intraday provider), so 1D/1W
// show the most recent bars rather than true intraday ticks.
export type ConvictionChartRange =
  | "1D"
  | "1W"
  | "1M"
  | "6M"
  | "1Y"
  | "5Y"
  | "MAX";

export const CONVICTION_CHART_RANGES: ConvictionChartRange[] = [
  "1D",
  "1W",
  "1M",
  "6M",
  "1Y",
  "5Y",
  "MAX",
];

export interface ConvictionChartResponse {
  ticker: string;
  // The range actually applied to this response (echoes the request; defaults
  // to "1Y" when none was supplied or the value was unrecognized).
  range: ConvictionChartRange;
  points: ConvictionChartPoint[];
  source: string; // "massive" | "yahoo" | "unavailable"
  currency: string | null;
  // Which MA windows had enough data to compute at the latest bar.
  availableMaWindows: number[]; // e.g. [50, 200] or [50] or []
  lastClose: number | null;
  changePct: number | null; // over the returned window
  breakout: ConvictionBreakoutStatus;
  note: string;
  warnings: string[];
}

// Revenue panel for a single conviction idea. Historical (annual + quarterly)
// revenue is sourced from SEC EDGAR companyfacts for US-listed operating
// companies where a CIK/ticker mapping exists. ETFs/funds/trusts/non-operating
// or ambiguous tickers resolve to status "not-available" / "not-meaningful".
export interface RevenuePoint {
  // Fiscal-period end date (YYYY-MM-DD).
  end: string;
  // Period label, e.g. "FY2024" for annual or "Q3 2024" for quarterly.
  label: string;
  // Revenue value in `currency` units (absolute, not millions).
  value: number;
  fy: number | null;
  fp: string | null;
  form: string | null; // 10-K / 10-Q / 20-F etc.
}

export type RevenueStatus =
  | "available" // historical revenue resolved from EDGAR
  | "not-available" // no CIK/ticker mapping or no revenue facts (unverified/foreign/etc.)
  | "not-meaningful"; // ETF / fund / trust / non-operating — revenue is not a meaningful metric

export type RevenueProjectionStatus =
  | "available" // a free estimate source returned projections
  | "unavailable"; // no reliable free estimate source — API shape kept for a future provider

export interface RevenueProjectionPoint {
  // Fiscal year the estimate is for, e.g. 2026.
  fy: number;
  label: string;
  value: number; // estimated revenue (absolute)
  source: string; // labelled source of the estimate
}

// Source attribution for a single year in the revenue bridge. Every bridge row
// carries one so the UI can badge provenance explicitly and never blur the line
// between reported actuals, analyst consensus and TreasuryLens modelling.
//   sec-actual     — reported revenue from an SEC 10-K (historical fact)
//   analyst-estimate — forward consensus from an analyst-estimate provider
//   treasurylens-model — TreasuryLens growth-fade model year (no analyst cover)
//   unavailable    — a year we cannot fill from any source
export type RevenueBridgeSource =
  | "sec-actual"
  | "analyst-estimate"
  | "treasurylens-model"
  | "unavailable";

// One year in the year-by-year revenue bridge. `value` is absolute revenue in
// the response currency; `growthPct` is YoY vs. the prior bridge year (null for
// the first row or when the prior value is zero). `source` badges provenance.
export interface RevenueBridgeYear {
  fy: number;
  label: string; // e.g. "FY2024", "FY2026E"
  value: number | null;
  growthPct: number | null;
  source: RevenueBridgeSource;
  analystCount?: number | null; // # analysts when source = analyst-estimate
  note?: string | null;
}

// A year-by-year revenue bridge: reported history → analyst-estimate years →
// TreasuryLens model years. Deterministic and template-driven (no LLM). The
// `status` is "available" when at least one actual year resolved; otherwise the
// historical panel's status governs and `years` is empty. `modelNote` explains
// how the model years were derived; `estimateSource` labels the analyst source
// when present so a future paid provider can swap in without a UI change.
export interface RevenueBridge {
  status: "available" | "unavailable";
  years: RevenueBridgeYear[]; // ascending by fiscal year
  estimateSource: string | null; // e.g. "finnhub" when analyst years present
  estimateStatus: AnalystEstimatesStatus | null; // analyst-estimate fetch status
  modelNote: string; // how TreasuryLens model years were derived
  note: string; // overall human-readable note
}

export interface EquityRevenueResponse {
  ticker: string;
  status: RevenueStatus;
  source: "sec_edgar" | "none";
  currency: string; // typically "USD"
  // Most recent trailing-twelve-month revenue (sum of last 4 reported
  // quarters) when computable; otherwise the latest annual value; else null.
  ttmRevenue: number | null;
  ttmAsOf: string | null; // period end the TTM is anchored to
  ttmIsAnnualFallback: boolean; // true when ttmRevenue is a single FY value
  annual: RevenuePoint[]; // ascending by period end (oldest first)
  quarterly: RevenuePoint[]; // ascending by period end (oldest first)
  // Year-over-year growth of the two most recent annual points (%), or null.
  annualGrowthPct: number | null;
  cik: string | null;
  entityName: string | null;
  asOf: number; // epoch ms the response was built
  note: string; // human-readable status / source note
  // Forward revenue projections. With current free data sources this is
  // always { status: "unavailable" } — the shape is kept so a future paid
  // estimate provider can populate `points` without an API change.
  projections: {
    status: RevenueProjectionStatus;
    source: string | null;
    points: RevenueProjectionPoint[];
    note: string;
  };
  // Year-by-year revenue bridge: reported actuals → analyst-estimate years →
  // TreasuryLens model years, each with a source badge. Optional so older
  // cached payloads still type-check; absent on not-available/not-meaningful
  // tickers (the historical `status` governs there).
  bridge?: RevenueBridge;
}

// =============================================================================
// Segment revenue intelligence
//
// Per-segment revenue / operating-income breakdown for a single issuer, with
// multi-year history so the UI can render mix %, YoY growth and a 3-year trend.
// Sources are labelled explicitly so the UI never blurs a reported fact with a
// derived or unavailable value:
//   finance-segments       — a finance data connector (deferred; see segments.ts)
//   sec-segments           — extracted from the issuer's XBRL 10-K segment axis
//   treasurylens-normalized — TreasuryLens-derived field (e.g. mix %, profit mix)
//   unavailable            — no reliable segment data for this issuer
// =============================================================================
export type SegmentSource =
  | "finance-segments"
  | "sec-segments"
  | "treasurylens-normalized"
  | "unavailable";

export type SegmentStatus =
  | "available" // at least one segment with revenue resolved
  | "not-available" // no CIK/filing mapping, or no segment axis in filings
  | "not-meaningful"; // ETF/fund/single-segment issuer — a breakdown is not meaningful

// One fiscal-year data point for a single segment. All monetary values are
// absolute in the response currency. `null` means the source did not report
// that field for that year (rendered as "—", never fabricated).
export interface SegmentYearPoint {
  fy: number;
  label: string; // e.g. "FY2025"
  end: string; // period-end YYYY-MM-DD
  revenue: number | null;
  operatingIncome: number | null;
}

// A normalized segment row: the most recent year's headline figures plus the
// derived mix/growth/margin fields and a multi-year history for sparklines.
export interface SegmentRow {
  name: string; // human-readable segment name (member name normalized)
  rawMember: string | null; // original XBRL member (for debugging/provenance)
  // Latest fiscal-year figures.
  revenue: number | null;
  operatingIncome: number | null;
  // Derived (TreasuryLens-normalized) fields. Null when inputs are missing.
  revenueMixPct: number | null; // segment revenue / total segment revenue
  revenueYoYPct: number | null; // latest FY vs. prior FY revenue growth
  operatingMarginPct: number | null; // operating income / revenue
  profitMixPct: number | null; // segment OP income / total segment OP income
  // "Punch" = profit contribution relative to revenue share (profit mix minus
  // revenue mix, in percentage points). Positive = punches above its weight.
  punchPpts: number | null;
  // Ascending-by-fy history (latest last) for 3-yr trend rendering. May hold a
  // single point when only one year is reported (UI shows trend unavailable).
  history: SegmentYearPoint[];
  source: SegmentSource;
}

export interface SegmentBreakdownResponse {
  ticker: string;
  status: SegmentStatus;
  source: SegmentSource; // dominant source for the resolved rows
  currency: string; // typically "USD"
  fiscalYear: number | null; // latest fiscal year the headline figures reflect
  periodEnd: string | null; // latest period-end the figures reflect
  segments: SegmentRow[]; // resolved segment rows (empty when not available)
  // Totals across resolved segments for the latest year (denominators used for
  // mix %); null when no segments resolved.
  totalRevenue: number | null;
  totalOperatingIncome: number | null;
  hasMultiYear: boolean; // true when ≥2 fiscal years resolved (trends renderable)
  // Confidence in the breakdown: "high" for direct reported segment facts,
  // "medium" when partially derived, "low" otherwise. Honest signal for the UI.
  confidence: "high" | "medium" | "low" | null;
  cik: string | null;
  entityName: string | null;
  asOf: number; // epoch ms the response was built
  note: string; // human-readable status / source note
}

// Payload to add a user-defined conviction idea. Kept intentionally small —
// ONLY the ticker is required. Everything else (name, theme, role, conviction)
// is optional: the server infers the display name from market data when it can
// and otherwise falls back to the ticker, slots the idea into a default
// grouping, and renders missing fields as pending so the agent can auto-update
// them later.
export const addConvictionIdeaSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Ticker is required")
    .max(12, "Ticker too long")
    .regex(/^[A-Za-z0-9.\-]+$/, "Use letters, numbers, '.' or '-' only"),
  // Name is optional. Empty/whitespace collapses to undefined so the server
  // infers a display name from market data / profile or falls back to the
  // ticker symbol itself.
  companyName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Theme / grouping is optional — a ticker can be added with just its symbol
  // and slotted into the generic "other" section. Empty/whitespace collapses
  // to undefined so the server applies its default label.
  theme: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  role: z
    .enum([
      "core-compounder",
      "asymmetric-candidate",
      "high-variance-optionality",
    ])
    .default("asymmetric-candidate"),
  convictionScore: z.coerce.number().int().min(0).max(100).default(50),
});
export type AddConvictionIdeaInput = z.infer<typeof addConvictionIdeaSchema>;

// =============================================================================
// Analyst consensus — Wall-Street recommendation trends sourced from Finnhub's
// free-tier `/stock/recommendation` endpoint. Counts of strongBuy/buy/hold/
// sell/strongSell per monthly period. We surface the latest period as a verdict
// plus a short trend history. Degrades gracefully: no token, no coverage
// (ETFs / uncovered names), or provider error each map to an explicit status so
// the UI never fabricates a verdict.
// =============================================================================

export type AnalystConsensusStatus = "available" | "unavailable" | "error";

// =============================================================================
// Analyst estimates — forward-looking consensus figures (revenue, EPS, price
// target) used as a *separate source input* to the scenario model. Distinct
// from AnalystConsensus (recommendation trends): these are quantitative
// estimates that can anchor or sanity-check the fundamentals bridge. Every
// field is nullable and the block carries an explicit status so the model and
// UI never fabricate a value when coverage is missing or the credential is
// absent. NOT a forecast or recommendation.
// =============================================================================

export type AnalystEstimatesStatus = "available" | "unavailable" | "error";

// One forward annual revenue consensus point from an analyst-estimate provider.
// `value` is absolute USD; `analystCount` is the # of analysts in the consensus.
export interface AnalystRevenueYear {
  fy: number;
  period: string; // raw provider period, e.g. "2026" or "2026-12-31"
  value: number; // USD, absolute
  analystCount: number | null;
}

export interface AnalystEstimates {
  status: AnalystEstimatesStatus;
  symbol: string;
  source: "finnhub";
  asOf: number; // ms epoch the response was assembled
  // Forward revenue consensus (USD) and the fiscal period it covers.
  revenueEstimate: number | null; // USD, mean analyst revenue estimate
  revenueEstimateYear: number | null; // fiscal year the estimate covers
  revenuePeriod: string | null; // e.g. "2025" or "2025-12-31"
  revenueAnalystCount: number | null;
  // All forward annual revenue estimates returned by the provider (USD,
  // absolute), ascending by fiscal year. Lets the revenue bridge anchor several
  // near-term years from consensus rather than a single point. Empty when the
  // provider returned no usable forward annual rows.
  revenueByYear: AnalystRevenueYear[];
  // Implied forward revenue CAGR vs TTM revenue, computed by the model when a
  // revenue anchor exists. Null when not computable. (Filled by scenarioModel.)
  impliedRevenueCagrPct: number | null;
  // Forward EPS consensus (USD per share) and its period.
  epsEstimate: number | null; // USD per share, mean analyst EPS estimate
  epsEstimateYear: number | null;
  epsPeriod: string | null;
  epsAnalystCount: number | null;
  // Wall-Street price target (mean) and its range, where available.
  priceTarget: number | null; // mean target price
  priceTargetHigh: number | null;
  priceTargetLow: number | null;
  priceTargetAnalystCount: number | null;
  priceTargetAsOf: string | null; // provider "lastUpdated" date if present
  // Human-readable message — always present, especially for non-available cases.
  message: string;
}

// One analyst-estimate derivation row for the "How this was derived" UI. Mirrors
// ScenarioDerivationRow but adds an explicit `used` flag so the UI can show
// whether an estimate anchored an assumption or is only shown for reference.
export interface AnalystEstimateRow {
  key: string;
  label: string;
  value: number | null;
  unit: "pct" | "usd" | "x" | "price" | "shares" | "ratio" | "none";
  display: string;
  used: boolean; // true = influenced an assumption; false = reference only
  note?: string;
}

// Compact analyst-estimate block attached to a ScenarioModel. Optional so older
// cached payloads still type-check and the model works with no analyst data.
export interface ScenarioAnalystBlock {
  status: AnalystEstimatesStatus;
  source: "finnhub";
  asOf: number;
  // Period labels surfaced as context (e.g. "FY2025").
  revenuePeriod: string | null;
  epsPeriod: string | null;
  priceTargetAsOf: string | null;
  // The rows the UI renders under the "Analyst estimates" section.
  rows: AnalystEstimateRow[];
  // Plain-English summary of how the estimates were (or weren't) used.
  message: string;
  // True when at least one estimate actually influenced an assumption.
  anyUsed: boolean;
}

export type AnalystConsensusLabel =
  | "Strong Buy"
  | "Buy"
  | "Hold"
  | "Sell"
  | "Strong Sell";

export interface AnalystRecommendationPeriod {
  period: string; // "YYYY-MM-DD" — first of the month per Finnhub
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  total: number;
  // Weighted 1..5 mean (1 = Strong Buy, 5 = Strong Sell). Lower is more bullish.
  meanScore: number | null;
  label: AnalystConsensusLabel | null;
  bullishPercent: number | null; // (strongBuy + buy) / total * 100
  bearishPercent: number | null; // (sell + strongSell) / total * 100
}

export interface AnalystConsensus {
  status: AnalystConsensusStatus;
  symbol: string;
  source: "finnhub";
  asOf: number; // ms epoch the response was assembled
  lastUpdated: string | null; // latest period date "YYYY-MM-DD"
  // Latest-period roll-up (null when unavailable / error).
  latestPeriod: string | null;
  totalAnalysts: number | null;
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
  consensusLabel: AnalystConsensusLabel | null;
  meanScore: number | null; // 1..5; lower = more bullish
  bullishPercent: number | null;
  bearishPercent: number | null;
  // Direction of the latest period vs. the prior one ("more bullish" etc.).
  trendDirection: "improving" | "stable" | "deteriorating" | null;
  // Last few months of recommendation trends (newest first), for the mini-trend.
  history: AnalystRecommendationPeriod[];
  // Human-readable message — always present, especially for non-available cases.
  message: string;
}

// =============================================================================
// Action Signal — an explainable, rules-based research verdict that augments the
// legacy Buy/Sell ModelSignal. It folds the existing deterministic engines
// (momentum/trend, valuation/Buffett, growth/revenue, risk/volatility, thesis
// review status) together with the optional Finnhub analyst consensus into one
// of six plain-English action labels. Every factor carries a score, a label and
// a one-line rationale so the call is auditable. NOT financial advice.
// =============================================================================

export type ActionLabel =
  | "Avoid"
  | "Watch"
  | "Starter"
  | "Add"
  | "Hold"
  | "Trim";

export type ActionFactorKey =
  | "momentum"
  | "valuation"
  | "quality"
  | "growth"
  | "risk"
  | "analyst";

export type FactorVerdict =
  | "strong"
  | "favorable"
  | "neutral"
  | "caution"
  | "weak"
  | "unavailable";

export interface ActionFactor {
  key: ActionFactorKey;
  name: string; // "Momentum", "Valuation", ...
  // 0-100, higher = more constructive for owning the name. null = no data.
  score: number | null;
  verdict: FactorVerdict;
  // Short uppercase chip label, e.g. "Strong", "Stretched", "Improving".
  label: string;
  rationale: string; // one plain-English sentence
  weight: number; // 0-1 contribution to the composite (0 when unavailable)
  available: boolean;
}

export interface ActionAgreement {
  // Internal action mapped to a coarse bullishness rank for comparison.
  internalStance: "bullish" | "neutral" | "bearish";
  analystStance: "bullish" | "neutral" | "bearish" | null;
  // "aligned" | "analysts-more-bullish" | "analysts-more-bearish" | "no-coverage"
  agreement:
    | "aligned"
    | "analysts-more-bullish"
    | "analysts-more-bearish"
    | "no-coverage";
  note: string;
}

// =============================================================================
// Conviction Signal — an honest, evidence-based read that replaces the old
// fixed-looking "Reward / Risk 4x" framing. It separates *what kind of idea*
// this could be (upside potential), *how much could go wrong* (downside risk),
// *whether now is a good entry*, *over what horizon*, and *how trustworthy the
// rules are* (backtest status). Every field is a candidate/estimate, never a
// guarantee. NOT financial advice.
// =============================================================================

// Upside potential classification. "base" = ordinary upside; the multiple
// candidates are evidence-based heuristics (NOT promised outcomes); "unknown"
// when there is not enough evidence to classify.
export type UpsidePotential =
  | "base"
  | "2x candidate"
  | "3x candidate"
  | "5x candidate"
  | "unknown";

export type DownsideRisk = "low" | "moderate" | "high" | "unknown";

// Entry quality from valuation / momentum / technical context.
export type EntryQuality =
  | "attractive"
  | "fair"
  | "extended"
  | "wait-for-setup"
  | "unknown";

// Coarse holding horizon, inferred from theme/type/role when available.
export type SignalHorizon =
  | "short-term-trade"
  | "12-month-setup"
  | "3-5-year-compounder"
  | "speculative-optionality"
  | "unknown";

// Whether the rules behind this signal have been validated on history.
export type BacktestConfidence =
  | "not-tested"
  | "weak"
  | "moderate"
  | "strong";

export interface BacktestStatus {
  // Honest top-level state. "not-tested" until a real engine validates the
  // exact conviction-signal rules (the existing scenario backtest validates a
  // related but different thing — scenario *labels*, not these rules).
  confidence: BacktestConfidence;
  tested: boolean;
  // Human label e.g. "Not tested yet".
  label: string;
  // One-line honest description of what is/isn't validated.
  note: string;
  // Optional pointer to a backtest method/run once available.
  methodId?: string | null;
  asOf?: number | null;
}

export interface ConvictionSignal {
  // Upside scenario classification + the evidence behind it.
  upside: {
    potential: UpsidePotential;
    label: string; // human label e.g. "3x candidate"
    // Illustrative upside band (% gain) when a scenario model is available.
    upsidePctEstimate: number | null;
    rationale: string[]; // why this potential (evidence bullets)
  };
  // Downside risk classification + estimate / invalidation level.
  downside: {
    risk: DownsideRisk;
    label: string; // e.g. "Moderate"
    // Illustrative downside band (% loss, negative) when modellable.
    downsidePctEstimate: number | null;
    // A concrete invalidation/stop level where one is derivable.
    invalidationLevel: number | null;
    rationale: string[];
  };
  // Entry quality read.
  entry: {
    quality: EntryQuality;
    label: string; // e.g. "Fair", "Extended"
    rationale: string[];
  };
  // Inferred holding horizon.
  horizon: {
    kind: SignalHorizon;
    label: string; // e.g. "3-5 year compounder"
    rationale: string;
  };
  // Honest reward/risk read — exposed as a *scenario estimate*, never a fixed
  // default. Null when not enough data (no scenario model / price).
  estimatedRewardRisk: number | null;
  // True when there is not enough evidence to render a confident signal.
  insufficientEvidence: boolean;
  // Top-level evidence summary bullets (drawn from analyst/trend/MA/valuation/growth/risk).
  evidence: string[];
  // What would change the view / invalidation triggers (concise).
  invalidationTriggers: string[];
  backtest: BacktestStatus;
}

export interface ActionSignal {
  symbol: string;
  asOf: number;
  // The new primary label and a 0-100 composite behind it.
  action: ActionLabel;
  compositeScore: number;
  confidence: ConfidenceLabel;
  summary: string; // one-line plain-English verdict
  factors: ActionFactor[];
  // What would move the call up / down a notch.
  upgradeTriggers: string[];
  downgradeTriggers: string[];
  agreement: ActionAgreement;
  // The new honest, separated conviction read (upside/downside/entry/horizon/
  // backtest). Optional so older cached payloads still type-check.
  conviction?: ConvictionSignal;
  // Transparent factor-score model (Quant Score v1). Optional so older cached
  // payloads still type-check. The action signal references it where available.
  quantScore?: QuantScore;
  // The legacy timing label is preserved so existing consumers keep working.
  legacySignal: SignalLabel;
  analystConsensus: AnalystConsensus | null;
  notes: string[];
}

// =============================================================================
// Quant Score v1 — a transparent, weighted factor-score model. NOT a black-box
// price predictor: every factor exposes its 0-100 score (or an explicit
// "unavailable" status), its weight, its contribution to the overall score, a
// concise rationale, and the source category of the underlying data. Unavailable
// factors are excluded and their weight is redistributed across the rest, and an
// overall confidence level is derived from how much of the model's intended
// weight was actually backed by data (data coverage). NOT financial advice.
// =============================================================================

export type QuantFactorKey =
  | "momentum"
  | "analyst"
  | "valuation"
  | "growth"
  | "quality"
  | "risk";

// Where the factor's data comes from, so the UI can group/colour by source and
// the user understands what kind of evidence backs each score.
export type QuantSource = "technical" | "analyst" | "fundamental" | "risk";

// Per-factor data status. "scored" = a real 0-100 score; "pending" = the data
// path exists but no value yet (e.g. live price/fundamental feed empty);
// "unavailable" = not applicable / not covered for this instrument.
export type QuantFactorStatus = "scored" | "pending" | "unavailable";

export interface QuantFactor {
  key: QuantFactorKey;
  label: string; // "Momentum / Trend", "Analyst Sentiment", ...
  source: QuantSource;
  status: QuantFactorStatus;
  // 0-100 (higher = more constructive) when status === "scored"; else null.
  score: number | null;
  // Intended base weight (0-1) before redistribution.
  baseWeight: number;
  // Effective weight (0-1) after redistributing unavailable factors. 0 when not
  // scored.
  weight: number;
  // score * weight — the factor's points toward the overall 0-100. 0 when not
  // scored.
  contribution: number;
  rationale: string; // one concise plain-English sentence
}

// Overall band for the composite score. "insufficient" when data coverage is
// too low to stand behind any band honestly.
export type QuantBand =
  | "strong"
  | "constructive"
  | "mixed"
  | "weak"
  | "insufficient";

export type QuantConfidence = "high" | "medium" | "low" | "insufficient";

export interface QuantScore {
  symbol: string;
  asOf: number;
  // 0-100 composite over the scored factors, or null when coverage is too low.
  overall: number | null;
  band: QuantBand;
  bandLabel: string; // "Strong", "Constructive", "Mixed", "Weak", "Insufficient data"
  confidence: QuantConfidence;
  // Fraction (0-1) of the model's intended base weight that was actually backed
  // by scored factors. Drives the confidence level and the "data coverage" UI.
  dataCoverage: number;
  // How many of the factors produced a real score.
  scoredFactors: number;
  totalFactors: number;
  factors: QuantFactor[];
  // One-line honest summary, e.g. "Constructive on 4/6 factors (67% coverage)."
  summary: string;
  // Honest pointer to whether the *quant rules* have been validated on history.
  backtest: QuantBacktestStatus;
}

// Lightweight status object embedded in the QuantScore so the UI can always
// state whether the rules are validated, without a second request.
export interface QuantBacktestStatus {
  tested: boolean;
  label: string; // "Not validated yet" | "Technical-only backtest"
  note: string;
  // Optional pointer to the technical-only backtest method id.
  methodId?: string | null;
}

// =============================================================================
// Quant Score — technical-only backtest. Validates ONLY the price/technical
// portion of the quant rules (momentum/trend + risk) on historical bars, with
// no fundamental or analyst inputs to avoid look-ahead bias. Honest by
// construction: every limitation is surfaced and the result is clearly labelled
// "technical-only". NOT a validation of the full quant score or a track record.
// =============================================================================

export interface QuantBacktestRow {
  ticker: string;
  companyName: string | null;
  // Technical-only quant signal computed point-in-time at the entry bar
  // (price vs 50/200D MA + trailing momentum + volatility), 0-100.
  entrySignal: number | null;
  // Whether the entry signal cleared the "constructive" threshold.
  selected: boolean;
  entryPrice: number | null;
  entryDate: string | null;
  latestPrice: number | null;
  latestDate: string | null;
  forwardReturnPct: number | null;
  maxDrawdownPct: number | null;
  source: string;
  warning: string | null;
}

export interface QuantBacktestSummary {
  // Names whose entry signal cleared the threshold ("selected" cohort).
  selectedCount: number;
  // Names that did not clear the threshold ("rest" cohort).
  restCount: number;
  evaluated: number;
  skipped: number;
  // Average forward return of the selected vs. the rest cohort.
  selectedAvgReturnPct: number | null;
  restAvgReturnPct: number | null;
  // selected − rest. Positive = the technical signal added value over the window.
  edgePct: number | null;
  selectedHitRatePct: number | null;
  benchmarkReturnPct: number | null;
  selectedBeatBenchmarkPct: number | null;
}

// -----------------------------------------------------------------------------
// Backtest v1 — multi-window / multi-threshold extension. Each evaluation window
// has a decision date (today − window) at which a point-in-time technical signal
// is computed from prior bars only; the forward return is measured from the
// decision date to today. Within each window we report several threshold cohorts
// (e.g. score ≥70 / ≥60 / ≥50, plus a top-quintile-vs-rest split) so the reader
// can see whether a stricter filter actually selected better forward returns.
// Still technical-only and still a directional sanity check, never a full
// fundamentals-aware validation.
// -----------------------------------------------------------------------------

export type QuantBacktestVerdict = "edge" | "mixed" | "no-edge" | "insufficient";

// One threshold/cohort result inside a single window.
export interface QuantBacktestThresholdResult {
  // Stable key, e.g. "score>=70" or "top-quintile".
  key: string;
  // Human label, e.g. "Score ≥ 70" or "Top quintile vs rest".
  label: string;
  kind: "band" | "cohort";
  // For band cohorts, the minimum entry signal required (else null).
  minScore: number | null;
  // Size of the cohort that cleared the filter at the decision date.
  selectedCount: number;
  // Size of the comparison group (rest of the evaluated universe).
  restCount: number;
  // Average forward return of selected vs. rest cohorts (%).
  selectedAvgReturnPct: number | null;
  restAvgReturnPct: number | null;
  // selected − rest (%). Positive = the filter added value over this window.
  excessVsRestPct: number | null;
  // selected − benchmark (%).
  excessVsBenchmarkPct: number | null;
  // Fraction of the selected cohort with a positive forward return (%).
  hitRatePct: number | null;
  // Worst peak-to-trough drawdown across the selected cohort's window (%).
  selectedMaxDrawdownPct: number | null;
  verdict: QuantBacktestVerdict;
}

// One evaluation window (e.g. 1Y). `available` is false when the data source
// lacks enough depth to honour the decision date for most of the universe.
export interface QuantBacktestWindow {
  key: string; // "3M" | "6M" | "1Y" | "2Y"
  label: string; // "3 months", etc.
  lookbackDays: number;
  available: boolean;
  decisionDate: string | null; // point-in-time entry date (today − window)
  asOfDate: string | null; // latest bar date (forward-return end)
  // How many names had enough history to be scored at the decision date.
  evaluated: number;
  // How many names were skipped (insufficient depth / coverage) this window.
  skipped: number;
  benchmarkReturnPct: number | null;
  thresholds: QuantBacktestThresholdResult[];
  status: string; // short human status / limitation note for the window
}

export interface QuantBacktestResponse {
  asOf: number;
  tested: boolean;
  methodId: string;
  // Default/headline window used by compact summaries (kept for compatibility).
  lookbackDays: number;
  thresholdScore: number;
  windowStartDate: string | null;
  windowEndDate: string | null;
  benchmarkSymbol: string;
  // Legacy single-window summary/rows, derived from the 1Y window so existing
  // consumers keep working.
  summary: QuantBacktestSummary;
  rows: QuantBacktestRow[];
  // Backtest v1: every evaluation window with its threshold cohorts.
  windows: QuantBacktestWindow[];
  // Whether any fundamental/analyst factors were used (false = technical-only).
  technicalOnly: boolean;
  // "Technical-only" | "Partial validation" — badge text for the UI.
  validationBadge: string;
  universeSize: number;
  methodology: string;
  limitations: string[];
  disclaimer: string;
}

// =============================================================================
// Model Lab — a sandbox for inspecting and tuning the Quant Score v1 factor
// weights and seeing how the *technically-validatable* portion of those weights
// would have performed historically. It reuses the same point-in-time,
// technical-only backtest engine as Backtest v1. Custom weights are applied
// end-to-end for the two factors the technical engine can honestly reconstruct
// (Momentum/Trend and Risk/Volatility); the fundamental/analyst weights still
// shape the live Quant Score but cannot be backtested without look-ahead, so the
// response flags them as informational-only. This is a modeling sandbox, NOT
// personalized financial advice.
// =============================================================================

// A full set of the six Quant Score v1 factor weights (each 0-1). They do not
// need to sum to 1 on input — the engine normalises them — but the UI presents
// them normalised for clarity.
export type ModelWeights = Record<QuantFactorKey, number>;

// A named weighting strategy (preset) the Model Lab can compare side by side.
export interface ModelStrategyPreset {
  id: string; // "default" | "momentum-tilt" | "growth-tilt" | "risk-control"
  label: string; // "Default Model", "Momentum Tilt", ...
  description: string; // one-line plain-English intent
  weights: ModelWeights;
}

// Request body for POST /api/model-lab/backtest. Either a known preset id or an
// explicit set of custom weights (custom wins when both are present).
export interface ModelLabBacktestRequest {
  weights?: Partial<ModelWeights>;
  presetId?: string;
}

// Which factors the technical-only engine could actually apply, and which were
// accepted but treated as informational (fundamental/analyst). Surfaced so the
// UI never overstates what the backtest validated.
export interface ModelLabFactorApplication {
  key: QuantFactorKey;
  label: string;
  // Normalised weight (0-1) the user requested for this factor.
  requestedWeight: number;
  // Whether the technical backtest could honour this factor point-in-time.
  technicallyApplied: boolean;
  note: string;
}

// Result of one weighting run: the normalised weights actually used, the
// technical sub-weights that drove the point-in-time signal, and a reuse of the
// Backtest v1 window/threshold structure under those weights.
export interface ModelLabBacktestResult {
  // The resolved strategy (preset id/label when a preset was used, else "custom").
  strategyId: string;
  strategyLabel: string;
  // Normalised weights used (sum to 1 across the six factors).
  weights: ModelWeights;
  // The technical sub-weights (0-1, sum to 1) actually used to blend the
  // point-in-time entry signal from trend/momentum/volatility components.
  technicalWeights: {
    trendMomentum: number; // derived from the Momentum/Trend factor weight
    volatility: number; // derived from the Risk/Volatility factor weight
  };
  factorApplication: ModelLabFactorApplication[];
  // Fraction (0-1) of the requested weight that the technical backtest could
  // actually honour (momentum + risk share of the total).
  technicalCoverage: number;
  tested: boolean;
  benchmarkSymbol: string;
  // Reused Backtest v1 windows, recomputed under these technical weights.
  windows: QuantBacktestWindow[];
  // Compact headline pulled from the 1Y window's top-cohort for easy comparison.
  headline: {
    windowKey: string;
    selectedAvgReturnPct: number | null;
    excessVsBenchmarkPct: number | null;
    hitRatePct: number | null;
    verdict: QuantBacktestVerdict;
  } | null;
}

export interface ModelLabBacktestResponse {
  asOf: number;
  methodId: string;
  universeSize: number;
  benchmarkSymbol: string;
  // The run for the requested weights/preset.
  result: ModelLabBacktestResult;
  // Always-available preset definitions so the UI can render the comparison
  // strip and the weight controls without a second request.
  presets: ModelStrategyPreset[];
  // Default weights (Quant Score v1 base weights) for the reset-to-default
  // control.
  defaultWeights: ModelWeights;
  technicalOnly: boolean;
  validationBadge: string;
  methodology: string;
  limitations: string[];
  disclaimer: string;
}

// =============================================================================
// Investment Groups (Baskets) v1 — model-driven, explainable research baskets.
//
// HONEST FRAMING: these are research watchlists assembled deterministically from
// the existing conviction universe (its curated conviction score, scenario
// model, themes, risk level and live performance). They are NOT personalized
// financial advice, NOT a portfolio, and NOT backtested as baskets. Where a
// Model Lab preset / technical backtest applies, we surface a compact validation
// badge from that engine rather than inventing one.
// =============================================================================

export type InvestmentGroupTemplateId =
  | "core-compounders"
  | "high-upside-speculative"
  | "ai-infrastructure"
  | "energy-power"
  | "risk-controlled"
  | "momentum-breakouts";

// Per-member factor reads that explain why a name made the basket. All optional
// numerics are null when the underlying data was unavailable for that ticker.
export interface InvestmentGroupMemberFactors {
  // 0-100 curated conviction score carried from the conviction universe.
  convictionScore: number;
  // Scenario classification (e.g. "compounder", "3x potential", "speculative").
  scenarioClassification: ScenarioClassification | null;
  // Curated/derived risk level for the name.
  riskLevel: RiskLevel | null;
  // Scenario bull upside / bear downside over the model horizon (%).
  upsidePct: number | null;
  downsidePct: number | null;
  // Trailing price performance windows (%), when history is available.
  change6mPct: number | null;
  change12mPct: number | null;
  // Whether the name matched the template's thematic intent (theme/section).
  themeMatch: boolean;
}

export interface InvestmentGroupMember {
  ticker: string;
  companyName: string;
  // Why this name is in the basket — one short line, template-aware.
  rationale: string;
  factors: InvestmentGroupMemberFactors;
  // The template-specific 0-100 fit score used to rank/select this member.
  fitScore: number;
  // Themes carried from the universe (for chips / transparency).
  themes: string[];
  sectionLabel: string | null;
}

// Compact, honest validation badge attached to a generated group. Sourced from
// the Model Lab technical-only backtest under the template's strategy preset —
// it validates the momentum/risk slice of the model, NOT the basket itself.
export interface InvestmentGroupValidation {
  // The Model Lab preset id whose weights best express this template's tilt.
  presetId: string;
  presetLabel: string;
  // The technical-only verdict + headline from the deepest available window.
  windowKey: string | null;
  verdict: QuantBacktestVerdict;
  selectedAvgReturnPct: number | null;
  excessVsBenchmarkPct: number | null;
  hitRatePct: number | null;
  badge: string; // e.g. "Technical-only"
  note: string;
}

export interface InvestmentGroup {
  templateId: InvestmentGroupTemplateId;
  name: string;
  // One-paragraph thesis describing the intent of the basket.
  thesis: string;
  // The model lens used to build it (plain English).
  modelLens: string;
  members: InvestmentGroupMember[];
  // Explainability blocks.
  whyTheseNames: string[]; // bullet reasons the cohort hangs together
  whatWouldChange: string[]; // what would add/remove names from this group
  // Aggregate reads across the selected members.
  avgConvictionScore: number | null;
  riskProfile: string; // human label e.g. "Lower risk", "Higher risk"
  upsideProfile: string | null; // human label e.g. "~2x base / 3x bull skew"
  // The controls actually applied to produce this set (echoed back).
  appliedControls: {
    minConvictionScore: number;
    maxRiskLevel: RiskLevel;
    maxHoldings: number;
  };
  // Validation badge from the Model Lab engine, when available.
  validation: InvestmentGroupValidation | null;
  // True when no member cleared the filters (graceful empty state).
  empty: boolean;
  emptyNote: string | null;
}

export interface InvestmentGroupTemplateInfo {
  id: InvestmentGroupTemplateId;
  name: string;
  blurb: string;
  modelLens: string;
  // The Model Lab preset whose tilt this template borrows for validation.
  presetId: string;
}

// Query controls for GET /api/investment-groups. All optional; the server
// applies sensible defaults and clamps.
export interface InvestmentGroupsRequest {
  templateId?: InvestmentGroupTemplateId;
  minConvictionScore?: number; // 0-100
  maxRiskLevel?: RiskLevel;
  maxHoldings?: number; // 1-25
}

export interface InvestmentGroupsResponse {
  asOf: number;
  templates: InvestmentGroupTemplateInfo[];
  // The generated group for the requested (or default) template.
  group: InvestmentGroup;
  universeSize: number;
  metricsStatus: {
    livePricing: boolean;
    fundamentals: boolean;
  };
  disclaimer: string;
}

// =============================================================================
// Trade Ideas — actionable research ideas distilled from the Stock Picks /
// conviction universe. Two lenses:
//   - Longs: rank the most actionable equity ideas by a blend of conviction,
//     entry quality, scenario reward/risk, and a downside guardrail.
//   - Options: convert the same theses into ranked bullish option structures,
//     surfacing 2x/3x scenario-based ideas. Ranked by a payoff-adjusted
//     probability/actionability score, NOT raw theoretical upside.
//
// Everything here is deterministic and transparent. Option payoffs use live
// chain data ONLY if the backend already exposes it; otherwise transparent
// fallback modeled templates are derived from current price, a volatility/risk
// proxy, the scenario model, the time horizon, and the downside guardrail. The
// `dataMode` flag makes the modeled/fallback status visible. Research only —
// not personalized financial advice; 2x/3x labels describe scenarios, never
// guaranteed outcomes.
// =============================================================================

// Honest source-of-truth flag for option payoff inputs.
export type TradeIdeaDataMode = "live-chain" | "modeled-fallback";

// Coarse actionability tier shared by the long and option views.
export type TradeIdeaTier = "high" | "medium" | "low";

// Upside class used as a Longs filter and badge.
export type TradeIdeaUpsideClass =
  | "defensive"
  | "compounder"
  | "2x"
  | "3x"
  | "5x+";

// One ranked long (equity) idea.
export interface TradeIdeaLong {
  ticker: string;
  companyName: string;
  themes: StockPickTheme[];
  subTheme: StockPickSubTheme | null;
  marketCapBucket: MarketCapBucket;
  // 0-100 blended actionability score for ranking (conviction + entry + R/R).
  ideaScore: number;
  tier: TradeIdeaTier;
  // Source convictions / quality reads pulled straight from the universe.
  convictionScore: number; // 0-100
  riskLevel: RiskLevel;
  scenarioClassification: ScenarioClassification | null;
  upsideClass: TradeIdeaUpsideClass;
  entryQuality: EntryQuality; // derived from momentum/valuation proxies
  entryLabel: string;
  // Scenario math (from the curated bands model).
  price: number | null;
  priceCurrency: string | null;
  bullUpsidePct: number | null;
  baseUpsidePct: number | null;
  bearDownsidePct: number | null; // negative
  bullTargetPrice: number | null;
  baseTargetPrice: number | null;
  bearTargetPrice: number | null;
  rewardRisk: number | null; // bull% / |bear%|
  // Guardrails / narrative.
  downsideGuardrail: string;
  invalidationLevel: number | null; // concrete price where thesis breaks
  catalysts: string[];
  hasCatalysts: boolean;
  thesis: string[];
  whatMustBeTrue: string[];
  whatWouldChangeView: string[];
  // Why this idea ranks where it does — short readable bullets.
  rationale: string[];
  sourceNote: string;
  dataConfidence: DataConfidence;
  // Scenario derivation surfaced in the "How this was derived" drawer. Carried
  // straight from the pick's scenarioModel so the Trade Ideas detail view can
  // show the bridge without re-fetching. Null when no model was attached.
  scenarioMethod: ScenarioMethod | null;
  scenarioModelType: ScenarioModelType | null;
  scenarioCoverage: "high" | "medium" | "low" | null;
  scenarioMethodology: string | null;
  scenarioHorizonYears: number | null;
  scenarioInputs: ScenarioDerivationRow[] | null;
  scenarioMissingInputs: string[] | null;
  scenarioModelWarnings: string[] | null;
  bullDerivation: ScenarioCaseDerivation | null;
  baseDerivation: ScenarioCaseDerivation | null;
  bearDerivation: ScenarioCaseDerivation | null;
  // Analyst-estimate source block carried from the scenario model so the Trade
  // Ideas detail drawer can render the same "Analyst estimates" section. Null
  // when no analyst data was attached.
  scenarioAnalystEstimates: ScenarioAnalystBlock | null;
}

// V1 supported option structures.
export type OptionStructureKind =
  | "long-call"
  | "bull-call-spread"
  | "call-diagonal"
  | "cash-secured-put"
  | "bull-put-spread";

// One leg of an option structure (modeled).
export interface OptionLeg {
  action: "buy" | "sell";
  right: "call" | "put";
  // Strike as an absolute price.
  strike: number;
  // Expiry horizon in months for this leg (diagonals differ across legs).
  expiryMonths: number;
  // Modeled premium per share for this leg.
  premium: number;
}

// One ranked bullish option idea derived from a long thesis.
export interface TradeIdeaOption {
  id: string; // `${ticker}-${kind}`
  ticker: string;
  companyName: string;
  kind: OptionStructureKind;
  structureLabel: string; // "Bull call spread"
  // The thesis score it inherits from the long idea (0-100).
  thesisScore: number;
  // Payoff-adjusted probability/actionability score for ranking (0-100).
  actionabilityScore: number;
  tier: TradeIdeaTier;
  // Scenario target this structure is sized around (usually base or bull).
  scenarioTargetPrice: number | null;
  scenarioTargetLabel: string; // "Base ~+38%" etc.
  // True when the modeled payoff at the bull scenario reaches ≥2x / ≥3x on
  // capital at risk. These describe the modeled scenario, not a promise.
  doubleCandidate: boolean; // ≥2x on risk
  tripleCandidate: boolean; // ≥3x on risk
  multipleLabel: string | null; // "2x scenario" | "3x scenario" | null
  // Modeled economics (per 1 contract / 100 shares unless noted). Nullable when
  // no price is available.
  price: number | null;
  priceCurrency: string | null;
  legs: OptionLeg[];
  netDebit: number | null; // net premium paid (debit structures), per share
  netCredit: number | null; // net premium received (credit structures), per share
  maxRisk: number | null; // max loss per share (capital at risk)
  maxReward: number | null; // max gain per share (null = uncapped for long calls)
  breakeven: number | null;
  // Estimated probability the structure is profitable at expiry, from the
  // scenario execution-probability weights + breakeven distance. 0-1.
  estProfitProbability: number | null;
  // Modeled payoff multiple on capital at risk in the bull scenario.
  bullPayoffMultiple: number | null;
  expiryMonths: number; // headline horizon
  expiryHorizonLabel: string; // "~6 months"
  // Volatility / risk proxy used to model premium (annualised %).
  ivProxyPct: number | null;
  // Narrative.
  whySelected: string[];
  whatMustHappen: string[];
  whyNotJustStock: string;
  limitations: string[];
  dataMode: TradeIdeaDataMode;
  dataConfidence: DataConfidence;
}

export interface OptionStructureInfo {
  kind: OptionStructureKind;
  label: string;
  summary: string; // one-line plain-English description
  bias: string; // "Bullish, defined risk" etc.
}

export interface TradeIdeasResponse {
  asOf: number;
  longs: TradeIdeaLong[];
  options: TradeIdeaOption[];
  structures: OptionStructureInfo[];
  universeSize: number;
  // Whether any live option-chain data backed the option models. Today this is
  // always false (no chain provider wired); surfaced honestly so the UI can
  // label all option ideas as modeled fallbacks.
  optionsDataMode: TradeIdeaDataMode;
  metricsStatus: {
    livePricing: boolean;
    fundamentals: boolean;
    optionChain: boolean;
  };
  methodology: {
    longs: string;
    options: string;
  };
  disclaimer: string;
}
