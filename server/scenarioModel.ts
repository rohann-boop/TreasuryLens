// Deterministic, transparent scenario model for stock picks.
//
// This module turns the curated `scenarioPotential` label + risk + conviction +
// market-cap bucket into an explicit bear/base/bull model with visible
// assumptions. Numbers are *hypothetical bands*, not predictions.
//
// Inputs: a StockPick (with optional keyMetrics for price/market cap).
// Output: a ScenarioModel block keyed onto the pick.
//
// The model is intentionally simple so the math is easy to inspect:
//   - We pick a target-multiple-of-current band per (classification, risk).
//   - We adjust for market-cap bucket (large caps compress, micros stretch).
//   - We translate to implied return %, target price/market cap, required CAGR.
//   - Reward/risk = bull upside % / |bear downside %|.

import type {
  DataConfidence,
  MarketCapBucket,
  RiskLevel,
  ScenarioCase,
  ScenarioCaseAssumptions,
  ScenarioCaseDerivation,
  ScenarioCaseOutputs,
  ScenarioClassification,
  ScenarioDerivationRow,
  ScenarioMethod,
  ScenarioMethodology,
  ScenarioModel,
  ScenarioPotential,
  ScenarioSource,
  StockPick,
} from "@shared/schema";

const HORIZON_YEARS = 5;

const SCENARIO_DISCLAIMER =
  "Hypothetical scenario model. Not a forecast, target, or recommendation. Numbers are illustrative bands derived from curated inputs.";

// Base bull/base/bear target multiples by classification. Tuned so:
//   - 2x potential → bull ≈ 2.0–2.4x of current
//   - 3x potential → bull ≈ 3.0–3.5x
//   - 5x potential → bull ≈ 5.0–5.5x
//   - compounder   → bull ≈ 1.7x (steady multi-year compounding)
//   - defensive    → bull ≈ 1.4x, downside small
//   - speculative  → bull ≈ 4x, downside large
type Band = { bear: number; base: number; bull: number };

const CLASSIFICATION_BANDS: Record<ScenarioClassification, Band> = {
  defensive: { bear: 0.85, base: 1.15, bull: 1.4 },
  compounder: { bear: 0.75, base: 1.35, bull: 1.75 },
  "2x potential": { bear: 0.6, base: 1.5, bull: 2.2 },
  "3x potential": { bear: 0.5, base: 1.7, bull: 3.2 },
  "5x potential": { bear: 0.4, base: 2.0, bull: 5.2 },
  speculative: { bear: 0.3, base: 1.5, bull: 4.0 },
};

// Per-risk-level bear-multiple adjustment. Higher risk → deeper downside.
const RISK_BEAR_ADJ: Record<RiskLevel, number> = {
  low: 0.08,
  moderate: 0.0,
  elevated: -0.05,
  high: -0.1,
  "very high": -0.15,
};

// Market-cap bucket multiplier on the bull multiple. Mega caps compress; micro
// caps can stretch further but with wider downside (we apply on bear too).
const BUCKET_BULL_ADJ: Record<MarketCapBucket, number> = {
  mega: -0.15,
  large: -0.05,
  mid: 0.0,
  small: 0.1,
  micro: 0.2,
};

const BUCKET_BEAR_ADJ: Record<MarketCapBucket, number> = {
  mega: 0.05,
  large: 0.0,
  mid: 0.0,
  small: -0.05,
  micro: -0.1,
};

// Default execution-probability weights per case (rough subjective priors).
const DEFAULT_EXEC_PROB: Record<"bear" | "base" | "bull", number> = {
  bear: 0.2,
  base: 0.55,
  bull: 0.25,
};

function round(n: number, digits = 1): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function classifyFromPotential(p: ScenarioPotential): ScenarioClassification {
  // ScenarioPotential is a subset of ScenarioClassification today, but keep an
  // explicit map so we can evolve them independently.
  switch (p) {
    case "defensive":
      return "defensive";
    case "compounder":
      return "compounder";
    case "2x potential":
      return "2x potential";
    case "3x potential":
      return "3x potential";
    case "5x potential":
      return "5x potential";
    case "speculative":
      return "speculative";
  }
}

function reclassifyFromBull(
  bullUpsidePct: number,
  fallback: ScenarioClassification,
  bucket?: MarketCapBucket,
): ScenarioClassification {
  // If the math diverges materially from the curated label, prefer the math.
  // Bands: ≥400% → 5x, ≥200% → 3x, ≥100% → 2x, ≥40% → compounder, ≥10% → defensive.
  //
  // Bucket gating: a mega/large-cap is not promoted to a high-multiple
  // "5x/3x potential" label off an unconstrained bull number. A $3T company
  // becoming a $15T company in 5y is not a credible "5x potential" tag, so we
  // cap how far the math can promote the largest names. Small/speculative caps
  // are left free to take the full promotion.
  let cap: ScenarioClassification | null = null;
  if (bucket === "mega") cap = "2x potential";
  else if (bucket === "large") cap = "3x potential";

  let promoted: ScenarioClassification;
  if (bullUpsidePct >= 400) promoted = "5x potential";
  else if (bullUpsidePct >= 200) promoted = "3x potential";
  else if (bullUpsidePct >= 100) promoted = "2x potential";
  else if (bullUpsidePct >= 40) promoted = "compounder";
  else if (bullUpsidePct >= 10) promoted = "defensive";
  else return fallback;

  if (cap) {
    const order: ScenarioClassification[] = [
      "defensive",
      "compounder",
      "2x potential",
      "3x potential",
      "5x potential",
    ];
    const rank = (c: ScenarioClassification) => {
      const i = order.indexOf(c);
      return i === -1 ? order.length : i; // speculative ~ top
    };
    if (rank(promoted) > rank(cap)) return cap;
  }
  return promoted;
}

function requiredCagrPct(multiple: number, years: number): number {
  if (multiple <= 0 || years <= 0) return 0;
  return (Math.pow(multiple, 1 / years) - 1) * 100;
}

function makeAssumptions(
  classification: ScenarioClassification,
  caseKey: "bear" | "base" | "bull",
  pick: StockPick,
): ScenarioCaseAssumptions {
  // Rough deterministic recipe: classification + case pick a band of revenue
  // CAGR, terminal margin, multiple change and dilution. These are inputs the
  // bands above were *implicitly* tuned against — surfacing them makes the
  // story readable.
  const isHighGrowth =
    classification === "3x potential" ||
    classification === "5x potential" ||
    classification === "speculative";
  const isCompounder = classification === "compounder";
  const isDefensive = classification === "defensive";

  let revenueCagr: number;
  let terminalMargin: number;
  let multipleChange: number;
  let dilution: number;

  if (caseKey === "bear") {
    revenueCagr = isDefensive ? 1 : isCompounder ? 4 : isHighGrowth ? 6 : 3;
    terminalMargin = isDefensive ? 10 : isCompounder ? 18 : isHighGrowth ? 8 : 12;
    multipleChange = isDefensive ? -15 : isCompounder ? -25 : isHighGrowth ? -45 : -30;
    dilution = isHighGrowth ? 8 : 3;
  } else if (caseKey === "base") {
    revenueCagr = isDefensive ? 4 : isCompounder ? 10 : isHighGrowth ? 18 : 12;
    terminalMargin = isDefensive ? 14 : isCompounder ? 24 : isHighGrowth ? 18 : 18;
    multipleChange = isDefensive ? 5 : isCompounder ? 10 : isHighGrowth ? 0 : 5;
    dilution = isHighGrowth ? 5 : 2;
  } else {
    // bull
    revenueCagr = isDefensive ? 7 : isCompounder ? 15 : isHighGrowth ? 30 : 22;
    terminalMargin = isDefensive ? 16 : isCompounder ? 30 : isHighGrowth ? 28 : 24;
    multipleChange = isDefensive ? 15 : isCompounder ? 25 : isHighGrowth ? 40 : 30;
    dilution = isHighGrowth ? 4 : 1;
  }

  const rationaleByCase: Record<"bear" | "base" | "bull", string[]> = {
    bear: [
      "Demand cycle stalls or competition compresses pricing.",
      "Multiple compresses as growth disappoints expectations.",
      pick.risks[0] ?? "Idiosyncratic execution risk shows up.",
    ],
    base: [
      "Steady execution on the curated thesis.",
      "Margins broadly hold; multiple normalizes near peers.",
      pick.thesis[0] ?? "Theme tailwind continues at curated pace.",
    ],
    bull: [
      pick.upsideCase || "Theme acceleration plays out.",
      "Operating leverage drives terminal margin higher.",
      "Multiple re-rates as durable growth becomes consensus.",
    ],
  };

  return {
    revenueCagrPct: round(revenueCagr, 1),
    terminalMarginPct: round(terminalMargin, 1),
    exitMultipleChangePct: round(multipleChange, 1),
    dilutionPct: round(dilution, 1),
    executionProbability: DEFAULT_EXEC_PROB[caseKey],
    rationale: rationaleByCase[caseKey],
  };
}

function makeOutputs(
  multiple: number,
  pick: StockPick,
  years: number,
): ScenarioCaseOutputs {
  const km = pick.keyMetrics ?? null;
  const price = km?.price ?? null;
  const mcap = km?.marketCap ?? null;
  const targetPrice =
    price != null && Number.isFinite(price) ? round(price * multiple, 2) : null;
  const targetMarketCap =
    mcap != null && Number.isFinite(mcap)
      ? Math.round(mcap * multiple)
      : null;
  const impliedReturn = (multiple - 1) * 100;
  const requiredCagr = requiredCagrPct(multiple, years);
  return {
    targetMultipleOfCurrent: round(multiple, 2),
    impliedReturnPct: round(impliedReturn, 1),
    targetPrice,
    targetMarketCap,
    requiredCagrPct: round(requiredCagr, 1),
    warning:
      price == null && mcap == null
        ? "No live price/market cap available — target price omitted."
        : null,
  };
}

function makeCase(
  key: "bear" | "base" | "bull",
  classification: ScenarioClassification,
  multiple: number,
  pick: StockPick,
  years: number,
): ScenarioCase {
  return {
    key,
    label: key === "bear" ? "Bear case" : key === "base" ? "Base case" : "Bull case",
    assumptions: makeAssumptions(classification, key, pick),
    outputs: makeOutputs(multiple, pick, years),
  };
}

function buildHeuristicModel(
  pick: StockPick,
  fallbackReason: string | null,
): ScenarioModel {
  const classification0 = classifyFromPotential(pick.scenarioPotential);
  const band = CLASSIFICATION_BANDS[classification0];
  const bullAdj = BUCKET_BULL_ADJ[pick.marketCapBucket] ?? 0;
  const bearAdj = (RISK_BEAR_ADJ[pick.riskLevel] ?? 0) + (BUCKET_BEAR_ADJ[pick.marketCapBucket] ?? 0);
  // Conviction nudges base case slightly (high conviction → narrower band).
  const convictionTilt = ((pick.convictionScore - 50) / 100) * 0.15; // ±0.075
  const bullMult = Math.max(0.5, band.bull + bullAdj + convictionTilt);
  const baseMult = Math.max(0.5, band.base + convictionTilt * 0.5);
  const bearMult = Math.max(0.1, band.bear + bearAdj);

  const years = HORIZON_YEARS;
  const bear = makeCase("bear", classification0, bearMult, pick, years);
  const base = makeCase("base", classification0, baseMult, pick, years);
  const bull = makeCase("bull", classification0, bullMult, pick, years);

  const bullUpsidePct = bull.outputs.impliedReturnPct;
  const bearDownsidePct = bear.outputs.impliedReturnPct;
  const denom = Math.abs(bearDownsidePct);
  const rewardRiskRatio = denom > 0.01 ? round(bullUpsidePct / denom, 2) : null;

  const km = pick.keyMetrics ?? null;
  const hasPrice = km?.price != null && Number.isFinite(km.price);
  const modelType = hasPrice ? "curated-bands-with-price-v1" : "curated-bands-v1";

  // Model confidence: lean on data availability + curated label.
  let modelConfidence: DataConfidence = "approximate";
  if (!hasPrice) modelConfidence = "low";

  const modelWarnings: string[] = [];
  if (!hasPrice) {
    modelWarnings.push(
      "Live price unavailable — target price/market cap shown as N/A; returns are multiples of current.",
    );
  }
  if (pick.riskLevel === "high" || pick.riskLevel === "very high") {
    modelWarnings.push(
      "High-risk name: bear-case downside may understate worst-case outcomes such as dilution waves or going-concern risk.",
    );
  }
  if (pick.scenarioPotential === "5x potential" || pick.scenarioPotential === "speculative") {
    modelWarnings.push(
      "Bull case requires a stack of low-probability conditions to align — treat as a long-tail scenario.",
    );
  }

  const finalClassification = reclassifyFromBull(bullUpsidePct, classification0);

  if (fallbackReason) {
    modelWarnings.unshift(
      `Fallback heuristic in use: ${fallbackReason} Bull/base/bear are curated target-multiple bands, not a fundamentals bridge.`,
    );
  }

  const methodology = [
    `Deterministic curated-bands model over a ${years}-year horizon.`,
    `Bull/base/bear target multiples come from the curated scenario tag (${pick.scenarioPotential}),`,
    `adjusted for ${pick.marketCapBucket}-cap (bull ${formatAdj(bullAdj)}, bear ${formatAdj(BUCKET_BEAR_ADJ[pick.marketCapBucket])}),`,
    `${pick.riskLevel} risk (bear ${formatAdj(RISK_BEAR_ADJ[pick.riskLevel])}),`,
    `and conviction ${pick.convictionScore}/100 (base/bull tilt ${formatAdj(convictionTilt)}).`,
    `Required CAGR derives from the bull multiple over ${years} years. Reward/risk = bull% / |bear%|.`,
  ].join(" ");

  return {
    horizonYears: years,
    modelType,
    modelConfidence,
    modelWarnings,
    methodology,
    classification: finalClassification,
    bear,
    base,
    bull,
    bullUpsidePct: round(bullUpsidePct, 1),
    bearDownsidePct: round(bearDownsidePct, 1),
    rewardRiskRatio,
    disclaimer: SCENARIO_DISCLAIMER,
    method: "fallback-heuristic",
    coverageConfidence: hasPrice ? "low" : "low",
    derivationInputs: buildHeuristicInputs(pick),
    missingInputs: fallbackReason ? ["fundamentals bridge inputs"] : [],
  };
}

// Shared-input rows for the heuristic path so the "How derived" UI still has
// something concrete to show (price/market cap + the curated tag inputs).
function buildHeuristicInputs(pick: StockPick): ScenarioDerivationRow[] {
  const km = pick.keyMetrics ?? null;
  const rows: ScenarioDerivationRow[] = [];
  rows.push(
    priceRow("Current price", km?.price ?? null, km?.priceCurrency ?? null),
  );
  rows.push(usdRow("Market cap", km?.marketCap ?? null, km?.marketCap != null ? "market-data" : "unavailable"));
  rows.push({
    key: "curatedTag",
    label: "Curated scenario tag",
    value: null,
    unit: "none",
    display: pick.scenarioPotential,
    source: "treasurylens-assumption",
  });
  rows.push({
    key: "conviction",
    label: "Conviction",
    value: pick.convictionScore,
    unit: "none",
    display: `${pick.convictionScore}/100`,
    source: "treasurylens-assumption",
  });
  return rows;
}

function formatAdj(n: number): string {
  const r = round(n, 2);
  if (r === 0) return "+0.00";
  return r > 0 ? `+${r.toFixed(2)}` : r.toFixed(2);
}

// =============================================================================
// Fundamentals-driven scenario bridge (V2)
//
// When SEC fundamentals exist, we replace the curated-bands multiple with an
// explicit revenue → margin → earnings → multiple → equity value → per-share
// bridge. Every input carries a source badge so the UI can show provenance.
//
//   future revenue   = revenue_ttm × (1 + cagr)^years
//   earnings proxy    = future revenue × terminal margin
//   implied equity    = earnings proxy × exit multiple        (P/E basis)
//                     | future revenue × exit P/S             (P/S basis, pre-profit)
//   target price      = implied equity / (shares × (1 + dilution))
//
// CAGR, margin and multiple are per-case (bear/base/bull), anchored on the
// company's own reported growth/margin/P-E where available and nudged by the
// curated classification. We do NOT claim precision: the disclaimer and source
// badges make the assumptions explicit.
// =============================================================================

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPriceStr(n: number | null, currency: string | null): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  const cur = currency && currency !== "USD" ? ` ${currency}` : "";
  return `$${n.toFixed(2)}${cur}`;
}

function priceRow(label: string, v: number | null, currency: string | null): ScenarioDerivationRow {
  return {
    key: label.replace(/\s+/g, "").toLowerCase(),
    label,
    value: v,
    unit: "price",
    display: fmtPriceStr(v, currency),
    source: v != null ? "market-data" : "unavailable",
  };
}

function usdRow(label: string, v: number | null, source: ScenarioSource): ScenarioDerivationRow {
  return {
    key: label.replace(/\s+/g, "").toLowerCase(),
    label,
    value: v,
    unit: "usd",
    display: fmtUsd(v),
    source: v != null ? source : "unavailable",
  };
}

function pctRow(key: string, label: string, v: number | null, source: ScenarioSource, note?: string): ScenarioDerivationRow {
  return {
    key,
    label,
    value: v,
    unit: "pct",
    display: v != null && Number.isFinite(v) ? `${v.toFixed(1)}%` : "N/A",
    source: v != null ? source : "unavailable",
    note,
  };
}

function multRow(key: string, label: string, v: number | null, source: ScenarioSource, note?: string): ScenarioDerivationRow {
  return {
    key,
    label,
    value: v,
    unit: "x",
    display: v != null && Number.isFinite(v) ? `${v.toFixed(1)}×` : "N/A",
    source: v != null ? source : "unavailable",
    note,
  };
}

function sharesRow(v: number | null, source: ScenarioSource): ScenarioDerivationRow {
  let display = "N/A";
  if (v != null && Number.isFinite(v)) {
    if (v >= 1e9) display = `${(v / 1e9).toFixed(2)}B sh`;
    else if (v >= 1e6) display = `${(v / 1e6).toFixed(1)}M sh`;
    else display = `${Math.round(v)} sh`;
  }
  return {
    key: "shares",
    label: "Share count",
    value: v,
    unit: "shares",
    display,
    source: v != null ? source : "unavailable",
  };
}

// Per-case CAGR / margin / multiple tilts relative to the company's own
// reported anchors. Bear shrinks growth + compresses the multiple; bull
// expands both. Tilts are widened for higher-classification (3x/5x/spec) names.
type CaseTilt = {
  cagrMultiplier: number; // applied to anchor revenue growth
  cagrFloor: number; // min CAGR % to use when anchor is missing/low
  marginDelta: number; // ppt change vs current margin
  multipleMultiplier: number; // applied to anchor P/E (or P/S)
  dilutionPct: number;
  execProb: number;
};

function caseTilts(
  caseKey: "bear" | "base" | "bull",
  classification: ScenarioClassification,
): CaseTilt {
  const aggressive =
    classification === "3x potential" ||
    classification === "5x potential" ||
    classification === "speculative";
  const compounder = classification === "compounder";
  const defensive = classification === "defensive";

  if (caseKey === "bear") {
    return {
      cagrMultiplier: defensive ? 0.25 : aggressive ? 0.3 : 0.5,
      cagrFloor: defensive ? 0 : aggressive ? 3 : 1,
      marginDelta: defensive ? -2 : aggressive ? -6 : -4,
      multipleMultiplier: defensive ? 0.85 : aggressive ? 0.55 : 0.7,
      dilutionPct: aggressive ? 8 : 3,
      execProb: DEFAULT_EXEC_PROB.bear,
    };
  }
  if (caseKey === "base") {
    return {
      cagrMultiplier: defensive ? 0.6 : compounder ? 0.8 : aggressive ? 0.75 : 0.85,
      cagrFloor: defensive ? 3 : compounder ? 8 : aggressive ? 14 : 10,
      marginDelta: defensive ? 0 : aggressive ? 2 : 1,
      multipleMultiplier: 1.0,
      dilutionPct: aggressive ? 5 : 2,
      execProb: DEFAULT_EXEC_PROB.base,
    };
  }
  // bull
  return {
    cagrMultiplier: defensive ? 1.0 : compounder ? 1.1 : aggressive ? 1.25 : 1.15,
    cagrFloor: defensive ? 6 : compounder ? 12 : aggressive ? 26 : 18,
    marginDelta: defensive ? 2 : aggressive ? 8 : 5,
    multipleMultiplier: defensive ? 1.15 : aggressive ? 1.4 : 1.25,
    dilutionPct: aggressive ? 4 : 1,
    execProb: DEFAULT_EXEC_PROB.bull,
  };
}

function clampNum(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// =============================================================================
// Scale-aware constraints for the fundamentals bridge.
//
// Big companies cannot compound small-company growth rates for 5 years, cannot
// expand already-rich multiples, and cannot credibly 10x. The constants below
// encode that with bucket × case discipline so the bridge stops producing
// absurd mega-cap upside (and absurdly positive mega-cap *bear* cases).
// =============================================================================

// Hard ceiling on the *effective* (horizon-average) revenue CAGR by bucket and
// case. A mega-cap base case can't average 30%/yr for 5 years; a micro-cap can.
// Floors (bear) are also bucket-aware so a giant doesn't keep compounding hard
// in a downturn.
const CAGR_CAP_BY_BUCKET: Record<MarketCapBucket, { bear: number; base: number; bull: number }> = {
  mega: { bear: 2, base: 16, bull: 26 },
  large: { bear: 3, base: 20, bull: 32 },
  mid: { bear: 4, base: 26, bull: 42 },
  small: { bear: 6, base: 34, bull: 55 },
  micro: { bear: 8, base: 42, bull: 70 },
};

// Terminal margin ceiling by bucket. Mega/large names already run near their
// structural margin, so the bull case shouldn't tack on a big margin expansion
// *and* hypergrowth *and* multiple expansion all at once.
const MARGIN_CAP_BY_BUCKET: Record<MarketCapBucket, number> = {
  mega: 48,
  large: 50,
  mid: 55,
  small: 58,
  micro: 60,
};

// Maximum multiple *expansion* allowed in the bull case by bucket. For an
// expensive mega-cap we want compression-or-hold, never blind expansion, so the
// cap is ≤1.0 (i.e. no expansion). Smaller names may re-rate somewhat.
const BULL_MULT_EXPANSION_CAP: Record<MarketCapBucket, number> = {
  mega: 1.0,
  large: 1.08,
  mid: 1.18,
  small: 1.3,
  micro: 1.4,
};

// "Expensive" thresholds. Above these the bull case is not allowed to expand
// the multiple at all (we hold or compress), regardless of bucket.
const RICH_PE = 40;
const RICH_PS = 12;

// Final implied-return sanity caps (%) on each case by bucket. These are the
// guardrails that stop the *main* model showing 5x/10x without an explicit
// stretch. Applied as a haircut on the computed multiple when exceeded.
//   - bull: ceiling on upside.
//   - base: ceiling on upside.
//   - bearMaxUpside: a mega/large compounder bear should not be strongly
//     positive; if the math says otherwise we clamp the bear *upside* down.
const RETURN_CAP_BY_BUCKET: Record<
  MarketCapBucket,
  { bull: number; base: number; bearMaxUpside: number }
> = {
  mega: { bull: 220, base: 110, bearMaxUpside: 8 },
  large: { bull: 320, base: 170, bearMaxUpside: 12 },
  mid: { bull: 500, base: 260, bearMaxUpside: 25 },
  small: { bull: 800, base: 380, bearMaxUpside: 45 },
  micro: { bull: 1200, base: 520, bearMaxUpside: 70 },
};

// Growth fade: instead of holding year-1 growth flat for the whole horizon, we
// decay it geometrically toward a terminal/normalized rate and return the
// *effective* (horizon-average, CAGR-equivalent) rate. This is what kills the
// "100% growth compounded for 5 years" explosion.
function effectiveFadedCagr(
  startGrowthPct: number,
  terminalPct: number,
  years: number,
): number {
  if (years <= 0) return startGrowthPct;
  // Year-over-year rate fades linearly from start → terminal across the horizon.
  let cumulative = 1;
  for (let y = 0; y < years; y++) {
    const t = years > 1 ? y / (years - 1) : 1;
    const yearRate = startGrowthPct + (terminalPct - startGrowthPct) * t;
    cumulative *= 1 + yearRate / 100;
  }
  if (cumulative <= 0) return terminalPct;
  return (Math.pow(cumulative, 1 / years) - 1) * 100;
}

// Terminal/normalized growth rate the fade decays toward, by bucket and case.
// Mega-caps revert toward GDP-plus; small/micro keep a higher terminal.
const TERMINAL_CAGR_BY_BUCKET: Record<MarketCapBucket, { bear: number; base: number; bull: number }> = {
  mega: { bear: 0, base: 8, bull: 12 },
  large: { bear: 1, base: 9, bull: 14 },
  mid: { bear: 2, base: 11, bull: 18 },
  small: { bear: 3, base: 14, bull: 22 },
  micro: { bear: 4, base: 16, bull: 26 },
};

interface BridgeInputs {
  price: number;
  currency: string | null;
  revenueTtm: number;
  shares: number;
  sharesSource: ScenarioSource;
  // anchors (may be null → assumption used)
  anchorGrowthPct: number | null;
  anchorMarginPct: number | null; // operating preferred, else net
  marginSource: ScenarioSource;
  anchorPe: number | null;
  valuationBasis: "P/E" | "P/S";
  baseMultiple: number; // P/E if profitable, else P/S
  multipleSource: ScenarioSource;
}

function buildFundamentalsCase(
  caseKey: "bear" | "base" | "bull",
  classification: ScenarioClassification,
  inp: BridgeInputs,
  years: number,
  pick: StockPick,
  scaleNotes: string[],
): ScenarioCase {
  const tilt = caseTilts(caseKey, classification);
  const bucket = pick.marketCapBucket;
  const isLargeScale = bucket === "mega" || bucket === "large";

  // --- Revenue CAGR with growth fade + scale-aware caps --------------------
  // Anchor on reported growth, but never hold year-1 growth flat for 5 years:
  // fade it toward a bucket/case terminal rate, then clamp the *effective*
  // CAGR by bucket so a mega-cap can't average a small-cap growth rate.
  const anchor = inp.anchorGrowthPct;
  let cagr: number;
  let cagrSource: ScenarioSource;
  const terminal = TERMINAL_CAGR_BY_BUCKET[bucket][caseKey];
  if (anchor != null && Number.isFinite(anchor)) {
    const startGrowth = anchor * tilt.cagrMultiplier;
    cagr = effectiveFadedCagr(startGrowth, terminal, years);
    cagrSource = "sec-fundamentals";
  } else {
    // No reported growth: fade the floor toward terminal too (mild fade).
    cagr = effectiveFadedCagr(tilt.cagrFloor, terminal, years);
    cagrSource = "treasurylens-assumption";
  }
  const cagrCap = CAGR_CAP_BY_BUCKET[bucket][caseKey];
  const cagrFloorByBucket = caseKey === "bear" ? -20 : 0;
  const cagrPreClamp = cagr;
  cagr = clampNum(cagr, cagrFloorByBucket, cagrCap);
  if (cagrPreClamp > cagrCap + 0.05) {
    scaleNotes.push(
      `${caseKey} revenue CAGR faded/capped to ${round(cagr, 1)}% for a ${bucket}-cap (raw ${round(cagrPreClamp, 1)}%).`,
    );
  }

  const futureRevenue = inp.revenueTtm * Math.pow(1 + cagr / 100, years);

  // --- Terminal margin with scale-aware ceiling ----------------------------
  let margin: number;
  let marginSrc: ScenarioSource;
  if (inp.anchorMarginPct != null && Number.isFinite(inp.anchorMarginPct)) {
    margin = inp.anchorMarginPct + tilt.marginDelta;
    marginSrc = inp.marginSource;
  } else {
    margin = clampNum(8 + tilt.marginDelta, 1, 30);
    marginSrc = "treasurylens-assumption";
  }
  const marginCap = MARGIN_CAP_BY_BUCKET[bucket];
  margin = clampNum(margin, inp.valuationBasis === "P/S" ? 0 : -10, marginCap);

  // --- Exit multiple with valuation discipline -----------------------------
  // No automatic expansion for already-expensive names; cap bull-case
  // expansion by bucket. Mega-caps hold-or-compress.
  let multMultiplier = tilt.multipleMultiplier;
  const richThreshold = inp.valuationBasis === "P/E" ? RICH_PE : RICH_PS;
  const isRich = inp.baseMultiple >= richThreshold;
  if (caseKey === "bull") {
    const expansionCap = BULL_MULT_EXPANSION_CAP[bucket];
    const cap = isRich ? Math.min(expansionCap, 1.0) : expansionCap;
    if (multMultiplier > cap) {
      multMultiplier = cap;
      scaleNotes.push(
        `bull exit ${inp.valuationBasis} expansion capped (${isRich ? "rich" : bucket + "-cap"} valuation — held at ${round(cap, 2)}×).`,
      );
    }
  } else if (caseKey === "base" && isRich && multMultiplier > 1.0) {
    // Expensive name in base case: lean toward modest compression, not hold.
    multMultiplier = Math.min(multMultiplier, isLargeScale ? 0.95 : 1.0);
  }
  const exitMultiple = clampNum(
    inp.baseMultiple * multMultiplier,
    inp.valuationBasis === "P/E" ? 5 : 1,
    inp.valuationBasis === "P/E" ? 120 : 40,
  );

  let earningsProxy: number | null;
  let impliedEquity: number;
  if (inp.valuationBasis === "P/E") {
    earningsProxy = futureRevenue * (margin / 100);
    impliedEquity = earningsProxy * exitMultiple;
  } else {
    // Pre-profit / P/S basis: value off revenue. Earnings proxy still shown.
    earningsProxy = futureRevenue * (margin / 100);
    impliedEquity = futureRevenue * exitMultiple;
  }
  // Floor equity value at zero — negative implied equity is meaningless here.
  impliedEquity = Math.max(0, impliedEquity);

  const dilutedShares = inp.shares * (1 + tilt.dilutionPct / 100);
  let targetPrice = dilutedShares > 0 ? impliedEquity / dilutedShares : null;

  let multiple =
    targetPrice != null && inp.price > 0 ? targetPrice / inp.price : 0;

  // --- Implied-return sanity caps (bucket × case) --------------------------
  // Final guardrail: cap the implied return so the main model can't surface
  // absurd 5x/10x mega-cap upside, and a mega/large compounder bear can't show
  // big positive upside. We haircut the multiple (and target price/equity) to
  // keep the bridge internally consistent.
  const returnCap = RETURN_CAP_BY_BUCKET[bucket];
  const applyCap = (capMultiple: number, why: string) => {
    if (multiple > capMultiple && capMultiple > 0) {
      const ratio = capMultiple / multiple;
      multiple = capMultiple;
      impliedEquity = impliedEquity * ratio;
      if (targetPrice != null) targetPrice = targetPrice * ratio;
      scaleNotes.push(why);
    }
  };
  if (caseKey === "bull") {
    applyCap(
      1 + returnCap.bull / 100,
      `bull upside capped at +${returnCap.bull}% for a ${bucket}-cap (scale-aware sanity cap).`,
    );
  } else if (caseKey === "base") {
    applyCap(
      1 + returnCap.base / 100,
      `base upside capped at +${returnCap.base}% for a ${bucket}-cap (scale-aware sanity cap).`,
    );
  } else {
    // Bear sanity: a bear case should not show large positive upside for the
    // bigger compounders. Cap bear upside near flat/slightly-positive.
    applyCap(
      1 + returnCap.bearMaxUpside / 100,
      `bear case constrained to ≤+${returnCap.bearMaxUpside}% upside — a ${bucket}-cap bear should not be strongly positive.`,
    );
  }

  const impliedReturn = (multiple - 1) * 100;
  const requiredCagr = requiredCagrPct(multiple, years);

  const rows: ScenarioDerivationRow[] = [
    pctRow("revenueCagr", "Revenue CAGR (est.)", round(cagr, 1), cagrSource, `${years}y annualised`),
    usdRow("Future revenue (est.)", round(futureRevenue, 0), cagrSource === "sec-fundamentals" ? "sec-fundamentals" : "treasurylens-assumption"),
    pctRow("terminalMargin", inp.valuationBasis === "P/E" ? "Terminal op. margin (est.)" : "Terminal margin (est.)", round(margin, 1), marginSrc),
    usdRow(inp.valuationBasis === "P/E" ? "Earnings proxy (est.)" : "Profit proxy (est.)", round(earningsProxy ?? 0, 0), marginSrc === "sec-fundamentals" ? "treasurylens-assumption" : marginSrc),
    multRow("exitMultiple", inp.valuationBasis === "P/E" ? "Exit P/E (est.)" : "Exit P/S (est.)", round(exitMultiple, 1), inp.multipleSource),
    usdRow("Implied equity value (est.)", round(impliedEquity, 0), "treasurylens-assumption"),
    sharesRow(round(dilutedShares, 0), inp.sharesSource),
    priceRow("Target price (est.)", targetPrice != null ? round(targetPrice, 2) : null, inp.currency),
  ];

  const derivation: ScenarioCaseDerivation = {
    rows,
    futureRevenue: round(futureRevenue, 0),
    marginPct: round(margin, 1),
    earningsProxy: round(earningsProxy ?? 0, 0),
    valuationMultiple: round(exitMultiple, 1),
    valuationBasis: inp.valuationBasis,
    impliedEquityValue: round(impliedEquity, 0),
    shareCount: round(dilutedShares, 0),
    targetPrice: targetPrice != null ? round(targetPrice, 2) : null,
  };

  const assumptions: ScenarioCaseAssumptions = {
    revenueCagrPct: round(cagr, 1),
    terminalMarginPct: round(margin, 1),
    exitMultipleChangePct: round((tilt.multipleMultiplier - 1) * 100, 1),
    dilutionPct: round(tilt.dilutionPct, 1),
    executionProbability: tilt.execProb,
    rationale: rationaleForCase(caseKey, pick, inp.valuationBasis),
  };

  const outputs: ScenarioCaseOutputs = {
    targetMultipleOfCurrent: round(multiple, 2),
    impliedReturnPct: round(impliedReturn, 1),
    targetPrice: targetPrice != null ? round(targetPrice, 2) : null,
    targetMarketCap: round(impliedEquity, 0),
    requiredCagrPct: round(requiredCagr, 1),
    warning: null,
  };

  return {
    key: caseKey,
    label: caseKey === "bear" ? "Bear case" : caseKey === "base" ? "Base case" : "Bull case",
    assumptions,
    outputs,
    derivation,
  };
}

function rationaleForCase(
  caseKey: "bear" | "base" | "bull",
  pick: StockPick,
  basis: "P/E" | "P/S",
): string[] {
  const valLine =
    basis === "P/S"
      ? "Valued on revenue (P/S) — not yet sustainably profitable."
      : "Valued on an earnings (P/E) bridge from terminal margin.";
  if (caseKey === "bear") {
    return [
      "Growth decays toward the floor; margin compresses and the multiple de-rates.",
      pick.risks[0] ?? "Idiosyncratic execution risk shows up.",
      valLine,
    ];
  }
  if (caseKey === "base") {
    return [
      "Reported growth persists at a discounted rate; margin and multiple roughly hold.",
      pick.thesis[0] ?? "Thesis executes at a steady pace.",
      valLine,
    ];
  }
  return [
    pick.upsideCase || "Growth re-accelerates and operating leverage lifts margin.",
    "Multiple re-rates as durable growth becomes consensus.",
    valLine,
  ];
}

// Decide whether we have enough to run the fundamentals bridge, and assemble
// the shared inputs. Returns null when too sparse (caller falls back).
function buildBridgeInputs(pick: StockPick): { inputs: BridgeInputs; missing: string[] } | null {
  const km = pick.keyMetrics ?? null;
  if (!km) return null;
  const price = km.price;
  const revenueTtm = km.revenueTtm ?? null;
  const shares = km.sharesOutstanding ?? null;

  // Hard requirements: a current price, TTM revenue, and a share count.
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (revenueTtm == null || !Number.isFinite(revenueTtm) || revenueTtm <= 0) return null;
  if (shares == null || !Number.isFinite(shares) || shares <= 0) return null;

  const missing: string[] = [];

  // Margin: prefer operating, then net. Null → assumption later.
  let anchorMarginPct: number | null = null;
  let marginSource: ScenarioSource = "treasurylens-assumption";
  if (km.operatingMargin != null && Number.isFinite(km.operatingMargin)) {
    anchorMarginPct = km.operatingMargin;
    marginSource = "sec-fundamentals";
  } else if (km.netMargin != null && Number.isFinite(km.netMargin)) {
    anchorMarginPct = km.netMargin;
    marginSource = "sec-fundamentals";
  } else {
    missing.push("operating/net margin");
  }

  // Valuation basis: P/E when we have a positive P/E and positive margin,
  // otherwise P/S (pre-profit names). P/S base multiple = marketCap / revenue.
  const profitable =
    km.peRatio != null && Number.isFinite(km.peRatio) && km.peRatio > 0 &&
    (anchorMarginPct == null || anchorMarginPct > 0);
  let valuationBasis: "P/E" | "P/S";
  let baseMultiple: number;
  let multipleSource: ScenarioSource;
  if (profitable) {
    valuationBasis = "P/E";
    baseMultiple = km.peRatio as number;
    multipleSource = "market-data";
  } else {
    valuationBasis = "P/S";
    const mcap = km.marketCap ?? price * shares;
    baseMultiple = mcap / revenueTtm;
    multipleSource = km.marketCap != null ? "market-data" : "treasurylens-assumption";
    if (km.peRatio == null) missing.push("positive P/E (using P/S basis)");
  }
  // Sanity clamp the base multiple.
  if (valuationBasis === "P/E") baseMultiple = clampNum(baseMultiple, 5, 120);
  else baseMultiple = clampNum(baseMultiple, 0.5, 40);

  const anchorGrowthPct =
    km.revenueGrowth != null && Number.isFinite(km.revenueGrowth)
      ? km.revenueGrowth
      : null;
  if (anchorGrowthPct == null) missing.push("reported revenue growth");

  const sharesSource: ScenarioSource =
    km.sharesOutstanding != null ? "sec-fundamentals" : "market-data";

  return {
    inputs: {
      price,
      currency: km.priceCurrency ?? null,
      revenueTtm,
      shares,
      sharesSource,
      anchorGrowthPct,
      anchorMarginPct,
      marginSource,
      anchorPe: km.peRatio ?? null,
      valuationBasis,
      baseMultiple,
      multipleSource,
    },
    missing,
  };
}

function buildFundamentalsModel(
  pick: StockPick,
  built: { inputs: BridgeInputs; missing: string[] },
): ScenarioModel {
  const classification0 = classifyFromPotential(pick.scenarioPotential);
  const inp = built.inputs;
  const years = HORIZON_YEARS;

  const scaleNotes: string[] = [];
  const bear = buildFundamentalsCase("bear", classification0, inp, years, pick, scaleNotes);
  const base = buildFundamentalsCase("base", classification0, inp, years, pick, scaleNotes);
  const bull = buildFundamentalsCase("bull", classification0, inp, years, pick, scaleNotes);

  const bullUpsidePct = bull.outputs.impliedReturnPct;
  const bearDownsidePct = bear.outputs.impliedReturnPct;
  const denom = Math.abs(bearDownsidePct);
  const rewardRiskRatio = denom > 0.01 ? round(bullUpsidePct / denom, 2) : null;

  const finalClassification = reclassifyFromBull(bullUpsidePct, classification0, pick.marketCapBucket);

  // Hybrid when any leg fell back to a TreasuryLens assumption.
  const isHybrid = built.missing.length > 0;
  const method: ScenarioMethod = isHybrid ? "hybrid" : "fundamentals-driven";
  const modelType = isHybrid ? "fundamentals-bridge-hybrid-v1" : "fundamentals-bridge-v1";

  // Coverage confidence: high when growth + margin + P/E all reported.
  let coverage: "high" | "medium" | "low";
  if (built.missing.length === 0) coverage = "high";
  else if (built.missing.length <= 1) coverage = "medium";
  else coverage = "low";

  const modelConfidence: DataConfidence = coverage === "high" ? "approximate" : "low";

  const modelWarnings: string[] = [];
  if (isHybrid) {
    modelWarnings.push(
      `Hybrid model: ${built.missing.join(", ")} not reported — TreasuryLens assumptions used for those legs.`,
    );
  }
  if (inp.valuationBasis === "P/S") {
    modelWarnings.push(
      "Valued on a price-to-sales basis (not yet sustainably profitable) — more sensitive to the multiple assumption than an earnings bridge.",
    );
  }
  if (pick.riskLevel === "high" || pick.riskLevel === "very high") {
    modelWarnings.push(
      "High-risk name: the bear case may still understate worst-case dilution or going-concern outcomes.",
    );
  }
  if ((pick.marketCapBucket === "mega" || pick.marketCapBucket === "large") && scaleNotes.length > 0) {
    modelWarnings.push(
      `Scale-aware constraints applied (${pick.marketCapBucket}-cap): growth fade, valuation discipline and implied-return caps limit the bridge so it can't compound hypergrowth indefinitely.`,
    );
  }
  // Surface the specific caps/fades that fired (deduped) so the "How derived"
  // UI shows exactly what was constrained.
  for (const n of Array.from(new Set(scaleNotes))) {
    modelWarnings.push(n);
  }

  const inputRows: ScenarioDerivationRow[] = [
    priceRow("Current price", inp.price, inp.currency),
    usdRow("TTM revenue", inp.revenueTtm, "sec-fundamentals"),
    pctRow(
      "anchorGrowth",
      "Reported revenue growth",
      inp.anchorGrowthPct,
      inp.anchorGrowthPct != null ? "sec-fundamentals" : "treasurylens-assumption",
      "Latest annual YoY",
    ),
    pctRow(
      "anchorMargin",
      "Current margin",
      inp.anchorMarginPct,
      inp.anchorMarginPct != null ? inp.marginSource : "treasurylens-assumption",
    ),
    multRow(
      "baseMultiple",
      inp.valuationBasis === "P/E" ? "Current P/E" : "Current P/S",
      round(inp.baseMultiple, 1),
      inp.multipleSource,
    ),
    sharesRow(inp.shares, inp.sharesSource),
  ];

  const methodology =
    `Fundamentals bridge over a ${years}-year horizon. We start from TTM revenue ` +
    `(${fmtUsd(inp.revenueTtm)}) and grow it at a per-case CAGR anchored on reported revenue growth ` +
    `(${inp.anchorGrowthPct != null ? `${inp.anchorGrowthPct.toFixed(1)}%` : "assumption"}). ` +
    `Future revenue × a terminal margin gives an earnings proxy, valued on a ${inp.valuationBasis} ` +
    `multiple (current ${round(inp.baseMultiple, 1)}×, re-rated per case) to an implied equity value, ` +
    `then divided by a dilution-adjusted share count to get a target price. Upside/downside are vs the current price. ` +
    `${isHybrid ? `Hybrid: ${built.missing.join(", ")} used TreasuryLens assumptions. ` : ""}` +
    `Estimates only — not a forecast.`;

  return {
    horizonYears: years,
    modelType,
    modelConfidence,
    modelWarnings,
    methodology,
    classification: finalClassification,
    bear,
    base,
    bull,
    bullUpsidePct: round(bullUpsidePct, 1),
    bearDownsidePct: round(bearDownsidePct, 1),
    rewardRiskRatio,
    disclaimer: SCENARIO_DISCLAIMER,
    method,
    coverageConfidence: coverage,
    derivationInputs: inputRows,
    missingInputs: built.missing,
  };
}

// Public entry: try the fundamentals bridge; fall back to the curated-bands
// heuristic when data is too sparse. Backward compatible — same return shape,
// same top-level fields (bullUpsidePct, base/bear outputs, classification…).
export function buildScenarioModel(pick: StockPick): ScenarioModel {
  let built: { inputs: BridgeInputs; missing: string[] } | null = null;
  try {
    built = buildBridgeInputs(pick);
  } catch {
    built = null;
  }
  if (!built) {
    const km = pick.keyMetrics ?? null;
    let reason = "insufficient SEC fundamentals (need price, TTM revenue and share count).";
    if (!km || km.price == null) reason = "no live price available.";
    else if (km.revenueTtm == null) reason = "no TTM revenue reported (non-US issuer, ETF, or sparse filer).";
    else if (km.sharesOutstanding == null) reason = "no share count available.";
    return buildHeuristicModel(pick, reason);
  }
  try {
    return buildFundamentalsModel(pick, built);
  } catch {
    return buildHeuristicModel(pick, "fundamentals bridge failed to compute.");
  }
}

export function buildScenarioMethodology(): ScenarioMethodology {
  return {
    modelType: "fundamentals-bridge-v1",
    horizonYears: HORIZON_YEARS,
    summary:
      `TreasuryLens scenario models are deterministic and transparent. When SEC fundamentals exist we run a ` +
      `fundamentals bridge over ${HORIZON_YEARS} years: TTM revenue is grown at a per-case CAGR (anchored on the ` +
      `company's reported growth), a terminal margin yields an earnings proxy, a re-rated P/E or P/S multiple gives ` +
      `an implied equity value, and a dilution-adjusted share count converts that to a target price. When ` +
      `fundamentals are too sparse (non-US issuers, ETFs, pre-revenue names) we fall back to the curated-bands ` +
      `heuristic — a bull/base/bear target multiple from the curated scenario tag — and label the model accordingly. ` +
      `Every assumption carries a source badge. No machine learning, no forecasts.`,
    notes: [
      "Method is labelled per name: fundamentals-driven, hybrid (some assumptions), or fallback heuristic.",
      "Estimates are illustrative scenarios — they describe how a case *could* shape up, not where the stock will trade.",
      "Reward/risk = bull case implied return % divided by absolute value of bear case implied return %.",
      "Pre-profit names are valued on price-to-sales; profitable names on an earnings (P/E) bridge.",
      "Source badges show whether each input came from market data, SEC fundamentals, or a TreasuryLens assumption.",
      "This is research, not personalized advice. Do not size positions off these numbers.",
    ],
    classificationBands: [
      {
        classification: "defensive",
        bullUpsidePctMin: 10,
        description: "Steady, low-multiple-expansion names; bull <40% upside.",
      },
      {
        classification: "compounder",
        bullUpsidePctMin: 40,
        description: "Quality compounders; bull 40–100% upside.",
      },
      {
        classification: "2x potential",
        bullUpsidePctMin: 100,
        description: "Bull case implies ≥2x (≥100% upside).",
      },
      {
        classification: "3x potential",
        bullUpsidePctMin: 200,
        description: "Bull case implies ≥3x (≥200% upside).",
      },
      {
        classification: "5x potential",
        bullUpsidePctMin: 400,
        description: "Long-tail bull case implies ≥5x (≥400% upside).",
      },
      {
        classification: "speculative",
        bullUpsidePctMin: 200,
        description: "Wide-band, low-probability names — bear and bull both pronounced.",
      },
    ],
    disclaimer: SCENARIO_DISCLAIMER,
  };
}
