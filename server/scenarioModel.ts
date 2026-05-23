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
  ScenarioCaseOutputs,
  ScenarioClassification,
  ScenarioMethodology,
  ScenarioModel,
  ScenarioPotential,
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

function reclassifyFromBull(bullUpsidePct: number, fallback: ScenarioClassification): ScenarioClassification {
  // If the math diverges materially from the curated label, prefer the math.
  // Bands: ≥400% → 5x, ≥200% → 3x, ≥100% → 2x, ≥40% → compounder, ≥10% → defensive.
  if (bullUpsidePct >= 400) return "5x potential";
  if (bullUpsidePct >= 200) return "3x potential";
  if (bullUpsidePct >= 100) return "2x potential";
  if (bullUpsidePct >= 40) return "compounder";
  if (bullUpsidePct >= 10) return "defensive";
  return fallback;
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

export function buildScenarioModel(pick: StockPick): ScenarioModel {
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
  };
}

function formatAdj(n: number): string {
  const r = round(n, 2);
  if (r === 0) return "+0.00";
  return r > 0 ? `+${r.toFixed(2)}` : r.toFixed(2);
}

export function buildScenarioMethodology(): ScenarioMethodology {
  return {
    modelType: "curated-bands-with-price-v1",
    horizonYears: HORIZON_YEARS,
    summary:
      `TreasuryLens scenario models are deterministic and transparent: for each pick we publish a bull/base/bear ` +
      `target multiple of current price over ${HORIZON_YEARS} years, derived from the curated scenario tag and ` +
      `adjusted for market-cap bucket, risk level, and conviction. Implied return %, target price, target market ` +
      `cap, and required CAGR are computed from those multiples — no machine learning, no forecasts.`,
    notes: [
      "Bands are illustrative — they describe how a scenario *could* shape up, not where the stock will trade.",
      "Reward/risk = bull case implied return % divided by absolute value of bear case implied return %.",
      "Required CAGR is the annualised return the bull multiple implies over the horizon — useful as a sanity check.",
      "Target price/market cap are shown only when a current quote is available; otherwise we expose multiples only.",
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
