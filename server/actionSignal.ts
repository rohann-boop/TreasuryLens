// Explainable Action Signal engine. Pure composition over the existing
// deterministic engines — no I/O of its own; the route fetches the inputs and
// passes them in. It folds momentum/trend, valuation/Buffett quality, growth,
// risk/volatility, thesis review status and (optionally) Finnhub analyst
// consensus into one of six plain-English action labels, with a per-factor
// scorecard, plain-English rationale, and upgrade/downgrade triggers.
//
// IMPORTANT (UX/legal): this is rules-based research, NOT financial advice.

import type {
  ActionFactor,
  ActionLabel,
  ActionSignal,
  ActionAgreement,
  AnalystConsensus,
  BacktestStatus,
  BuffettIndex,
  ConfidenceLabel,
  ConvictionIdea,
  ConvictionSignal,
  DownsideRisk,
  EntryQuality,
  FactorVerdict,
  ModelSignal,
  SignalHorizon,
  SubModelOutput,
  UpsidePotential,
} from "@shared/schema";
import { buildQuantScore } from "./quantScore";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function verdictFor(score: number | null): FactorVerdict {
  if (score == null) return "unavailable";
  if (score >= 70) return "strong";
  if (score >= 58) return "favorable";
  if (score >= 45) return "neutral";
  if (score >= 32) return "caution";
  return "weak";
}

function chipLabel(v: FactorVerdict): string {
  switch (v) {
    case "strong":
      return "Strong";
    case "favorable":
      return "Favorable";
    case "neutral":
      return "Neutral";
    case "caution":
      return "Caution";
    case "weak":
      return "Weak";
    default:
      return "No data";
  }
}

function sub(
  signal: ModelSignal | null,
  key: SubModelOutput["key"],
): SubModelOutput | null {
  if (!signal) return null;
  return signal.models.find((m) => m.key === key) ?? null;
}

// -------------------- factor builders --------------------

function momentumFactor(signal: ModelSignal | null): ActionFactor {
  const m = sub(signal, "momentum");
  const t = sub(signal, "trend");
  // Blend momentum + trend (both technical, price-derived).
  const parts: number[] = [];
  if (m?.available) parts.push(m.score);
  if (t?.available) parts.push(t.score);
  const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  const verdict = verdictFor(score);
  const rationale = (() => {
    if (score == null) return "No usable price history to read momentum or trend.";
    const bits: string[] = [];
    if (t?.bullets[0]) bits.push(t.bullets[0]);
    if (m?.bullets[0]) bits.push(m.bullets[0]);
    if (bits.length) return bits.slice(0, 2).join(" ");
    return score >= 55 ? "Price action is constructive." : "Price action is soft.";
  })();
  return {
    key: "momentum",
    name: "Momentum",
    score: score != null ? Math.round(score) : null,
    verdict,
    label: chipLabel(verdict),
    rationale,
    weight: 0,
    available: score != null,
  };
}

function valuationFactor(
  signal: ModelSignal | null,
  buffett: BuffettIndex | null,
): ActionFactor {
  const v = sub(signal, "valuation");
  // Prefer the signal's valuation sub-model; fall back to the Buffett valuation
  // category if present so equities without a treasury/PE still score.
  let score: number | null = v?.available ? v.score : null;
  let rationale = v?.available && v.bullets[0] ? v.bullets[0] : "";
  if (score == null && buffett?.applicable) {
    const cat = buffett.categories.find((c) => c.key === "valuation");
    if (cat && cat.score != null) {
      score = cat.score;
      rationale = cat.bullets[0] ?? "Valuation scored from Buffett framework.";
    }
  }
  if (!rationale) {
    rationale =
      score == null
        ? "No valuation anchor available (no P/E, treasury NAV or fundamentals)."
        : score >= 55
          ? "Valuation looks reasonable on available inputs."
          : "Valuation looks full on available inputs.";
  }
  const verdict = verdictFor(score);
  return {
    key: "valuation",
    name: "Valuation",
    score: score != null ? Math.round(score) : null,
    verdict,
    label: chipLabel(verdict),
    rationale,
    weight: 0,
    available: score != null,
  };
}

function qualityFactor(buffett: BuffettIndex | null): ActionFactor {
  // Business quality from the Buffett Index overall score. ETFs / funds /
  // non-operating issuers (low coverage, no fundamentals) → unavailable.
  const meaningful =
    !!buffett &&
    buffett.applicable &&
    buffett.overallScore != null &&
    !(buffett.framework === "equity" && !buffett.fundamentals && (buffett.dataCoverage ?? 0) < 0.15);
  const score = meaningful ? (buffett!.overallScore as number) : null;
  const verdict = verdictFor(score);
  const rationale = (() => {
    if (!meaningful) {
      return buffett && !buffett.applicable
        ? "Business-quality framework does not apply to this instrument."
        : "No company fundamentals to judge business quality (looks like an ETF/fund or uncovered issuer).";
    }
    if (buffett!.strengths[0]) return `${buffett!.label}. ${buffett!.strengths[0]}`;
    return `${buffett!.label} on Buffett business-quality framework.`;
  })();
  return {
    key: "quality",
    name: "Quality",
    score: score != null ? Math.round(score) : null,
    verdict,
    label: chipLabel(verdict),
    rationale,
    weight: 0,
    available: score != null,
  };
}

function growthFactor(idea: ConvictionIdea | null, buffett: BuffettIndex | null): ActionFactor {
  // Prefer revenue growth from enriched keyMetrics; fall back to fundamentals.
  const km = idea?.keyMetrics ?? null;
  let revGrowth: number | null =
    km?.revenueGrowth != null && Number.isFinite(km.revenueGrowth)
      ? km.revenueGrowth
      : null;
  let epsGrowth: number | null = null;
  if (buffett?.fundamentals) {
    if (revGrowth == null && buffett.fundamentals.revenueGrowth != null)
      revGrowth = buffett.fundamentals.revenueGrowth;
    epsGrowth = buffett.fundamentals.epsGrowth ?? null;
  }
  if (revGrowth == null && epsGrowth == null) {
    return {
      key: "growth",
      name: "Growth",
      score: null,
      verdict: "unavailable",
      label: chipLabel("unavailable"),
      rationale: "No revenue or earnings growth data available.",
      weight: 0,
      available: false,
    };
  }
  // Map growth → 0..100. ~0% growth ≈ 45; 40%+ ≈ 90; negative ≈ <30.
  const g = revGrowth ?? epsGrowth ?? 0;
  let score = 45 + clamp(g, -40, 60) * (g >= 0 ? 0.9 : 1.1);
  score = clamp(score);
  const verdict = verdictFor(score);
  const rationale = (() => {
    const parts: string[] = [];
    if (revGrowth != null) parts.push(`Revenue ${revGrowth >= 0 ? "+" : ""}${revGrowth.toFixed(1)}% YoY.`);
    if (epsGrowth != null) parts.push(`EPS ${epsGrowth >= 0 ? "+" : ""}${epsGrowth.toFixed(1)}% YoY.`);
    return parts.join(" ") || "Growth derived from available fundamentals.";
  })();
  return {
    key: "growth",
    name: "Growth",
    score: Math.round(score),
    verdict,
    label: chipLabel(verdict),
    rationale,
    weight: 0,
    available: true,
  };
}

function riskFactor(signal: ModelSignal | null): ActionFactor {
  // The signal's risk sub-model scores *safety* (higher = calmer). Higher safety
  // is constructive for the action, so we use it directly as the factor score.
  const r = sub(signal, "risk");
  const score = r?.available ? r.score : null;
  const verdict = verdictFor(score);
  const rationale = (() => {
    if (score == null) return "Limited history — risk read is approximate.";
    const bits = (r?.bullets ?? []).slice(0, 2);
    if (bits.length) return bits.join(" ");
    return score >= 55 ? "Volatility and drawdown look contained." : "Volatility/drawdown elevate the risk.";
  })();
  return {
    key: "risk",
    name: "Risk",
    score: score != null ? Math.round(score) : null,
    verdict,
    label: chipLabel(verdict),
    rationale,
    weight: 0,
    available: score != null,
  };
}

function analystToScore(c: AnalystConsensus | null): number | null {
  if (!c || c.status !== "available" || c.meanScore == null) return null;
  // meanScore is 1..5 (1 = Strong Buy). Map to 0..100 (1 → 100, 5 → 0).
  return clamp(((5 - c.meanScore) / 4) * 100);
}

function analystFactor(c: AnalystConsensus | null): ActionFactor {
  const score = analystToScore(c);
  if (score == null) {
    return {
      key: "analyst",
      name: "Analyst Consensus",
      score: null,
      verdict: "unavailable",
      label: chipLabel("unavailable"),
      rationale:
        c?.message ?? "No analyst consensus available (token missing or ticker uncovered).",
      weight: 0,
      available: false,
    };
  }
  const verdict = verdictFor(score);
  const trend =
    c!.trendDirection === "improving"
      ? " Trend improving."
      : c!.trendDirection === "deteriorating"
        ? " Trend deteriorating."
        : "";
  const rationale = `${c!.totalAnalysts} analysts: ${c!.consensusLabel} (${c!.bullishPercent ?? 0}% bullish).${trend}`;
  return {
    key: "analyst",
    name: "Analyst Consensus",
    score: Math.round(score),
    verdict,
    label: c!.consensusLabel ?? chipLabel(verdict),
    rationale,
    weight: 0,
    available: true,
  };
}

// -------------------- composition --------------------

// Base weights across the six factors. Quality + valuation lean long-term;
// momentum + risk capture timing; growth and analyst round it out. Unavailable
// factors have their weight redistributed proportionally across the rest.
const BASE_WEIGHTS: Record<ActionFactor["key"], number> = {
  momentum: 0.22,
  valuation: 0.18,
  quality: 0.2,
  growth: 0.15,
  risk: 0.15,
  analyst: 0.1,
};

function actionForScore(score: number): ActionLabel {
  // Six-way label. "Add"/"Starter" are constructive entries at different
  // conviction; "Hold" is steady; "Trim" lightens; "Avoid" stays away/exits.
  if (score >= 70) return "Add";
  if (score >= 58) return "Starter";
  if (score >= 48) return "Hold";
  if (score >= 38) return "Watch";
  if (score >= 28) return "Trim";
  return "Avoid";
}

function confidenceFor(availableFrac: number, score: number): ConfidenceLabel {
  if (availableFrac < 0.5) return "Low";
  const conviction = Math.abs(score - 50);
  if (conviction >= 20 && availableFrac >= 0.75) return "High";
  if (conviction >= 10) return "Medium";
  return "Low";
}

function stanceForScore(score: number): "bullish" | "neutral" | "bearish" {
  if (score >= 58) return "bullish";
  if (score >= 42) return "neutral";
  return "bearish";
}

function analystStance(c: AnalystConsensus | null): "bullish" | "neutral" | "bearish" | null {
  if (!c || c.status !== "available" || c.meanScore == null) return null;
  if (c.meanScore <= 2.5) return "bullish";
  if (c.meanScore <= 3.5) return "neutral";
  return "bearish";
}

const ACTION_SUMMARY: Record<ActionLabel, string> = {
  Add: "Constructive across most factors — a candidate to add on the research checklist.",
  Starter: "Reasonably constructive — could merit a starter-sized research position.",
  Hold: "Mixed signals — steady-state; nothing forcing a change.",
  Watch: "Not compelling yet — keep on the watchlist for confirmation.",
  Trim: "Deteriorating factors — a candidate to lighten on the checklist.",
  Avoid: "Weak across factors — stay on the sidelines for now.",
};

// -------------------- conviction signal (honest, separated read) --------------

// Backtest status is honest by default: the *exact* conviction-signal rules
// have not been validated on history yet. The existing scenario backtest
// validates a related-but-different thing (scenario labels over price), so we
// surface "not tested yet" rather than implying these rules are proven.
function buildBacktestStatus(): BacktestStatus {
  return {
    confidence: "not-tested",
    tested: false,
    label: "Not tested yet",
    note:
      "These conviction rules have not been backtested on historical data. A technical-only quant backtest validates just the price/momentum portion of the quant score over a 1-year window (see the Backtest panel); fundamentals and analyst inputs are not validated. Treat the signal as a transparent heuristic until the full rules are validated.",
    methodId: "quant-technical-v1",
    asOf: null,
  };
}

const UPSIDE_LABEL: Record<UpsidePotential, string> = {
  base: "Base upside",
  "2x candidate": "2x candidate",
  "3x candidate": "3x candidate",
  "5x candidate": "5x candidate",
  unknown: "Not enough evidence",
};

const DOWNSIDE_LABEL: Record<DownsideRisk, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  unknown: "Unknown",
};

const ENTRY_LABEL: Record<EntryQuality, string> = {
  attractive: "Attractive",
  fair: "Fair",
  extended: "Extended",
  "wait-for-setup": "Wait for setup",
  unknown: "Unknown",
};

const HORIZON_LABEL: Record<SignalHorizon, string> = {
  "short-term-trade": "Short-term trade",
  "12-month-setup": "12-month setup",
  "3-5-year-compounder": "3-5 year compounder",
  "speculative-optionality": "Speculative optionality",
  unknown: "Unknown",
};

// Classify upside from the scenario model's bull-case implied return when
// present; otherwise fall back to the curated scenario tag. Evidence-based,
// explicitly a *candidate*, never a promise.
function classifyUpside(idea: ConvictionIdea | null): {
  potential: UpsidePotential;
  upsidePctEstimate: number | null;
  rationale: string[];
} {
  const sm = idea?.scenarioModel ?? null;
  const rationale: string[] = [];
  if (sm && sm.bullUpsidePct != null && Number.isFinite(sm.bullUpsidePct)) {
    const up = sm.bullUpsidePct;
    let potential: UpsidePotential;
    if (up >= 400) potential = "5x candidate";
    else if (up >= 200) potential = "3x candidate";
    else if (up >= 100) potential = "2x candidate";
    else potential = "base";
    rationale.push(
      `Scenario model bull case implies roughly +${Math.round(up)}% over ${sm.horizonYears}y (estimate, not a target).`,
    );
    if (sm.classification) rationale.push(`Curated/derived classification: ${sm.classification}.`);
    if (potential === "base")
      rationale.push("Bull case is under 2x — treat as ordinary upside, not a multibagger candidate.");
    return { potential, upsidePctEstimate: Math.round(up), rationale };
  }
  // Fall back to the curated scenario tag if no modelled band.
  const tag = idea?.scenarioModel?.classification ?? null;
  if (tag === "5x potential")
    return { potential: "5x candidate", upsidePctEstimate: null, rationale: ["Curated tag: 5x potential (no live price to model a band)."] };
  if (tag === "3x potential")
    return { potential: "3x candidate", upsidePctEstimate: null, rationale: ["Curated tag: 3x potential (no live price to model a band)."] };
  if (tag === "2x potential")
    return { potential: "2x candidate", upsidePctEstimate: null, rationale: ["Curated tag: 2x potential (no live price to model a band)."] };
  if (tag === "compounder" || tag === "defensive")
    return { potential: "base", upsidePctEstimate: null, rationale: ["Curated tag points to steady compounding rather than a multiple."] };
  return {
    potential: "unknown",
    upsidePctEstimate: null,
    rationale: ["No scenario model or curated potential available — upside not classifiable yet."],
  };
}

// Classify downside from the scenario model bear case + the risk factor.
function classifyDownside(
  idea: ConvictionIdea | null,
  risk: ActionFactor,
  signal: ModelSignal | null,
): {
  risk: DownsideRisk;
  downsidePctEstimate: number | null;
  invalidationLevel: number | null;
  rationale: string[];
} {
  const sm = idea?.scenarioModel ?? null;
  const rationale: string[] = [];
  let downsidePct: number | null = null;
  if (sm && sm.bearDownsidePct != null && Number.isFinite(sm.bearDownsidePct)) {
    downsidePct = Math.round(sm.bearDownsidePct); // negative
    rationale.push(`Scenario bear case implies roughly ${downsidePct}% (illustrative, not a floor).`);
  }
  const invalidationLevel =
    signal?.stopPrice != null && Number.isFinite(signal.stopPrice) ? signal.stopPrice : null;
  if (invalidationLevel != null)
    rationale.push(`Technical invalidation near ${invalidationLevel.toFixed(2)} (model stop).`);

  // Combine modelled downside magnitude with the safety/risk factor score.
  // riskFactor score is *safety* (higher = calmer).
  let level: DownsideRisk;
  const mag = downsidePct != null ? Math.abs(downsidePct) : null;
  const safety = risk.available ? (risk.score ?? null) : null;
  if (mag == null && safety == null) {
    level = "unknown";
    rationale.push("Not enough price history or scenario data to size downside.");
  } else {
    // Score downside risk 0..100 (higher = riskier). Blend magnitude + (100-safety).
    const fromMag = mag == null ? null : Math.min(100, mag);
    const fromSafety = safety == null ? null : 100 - safety;
    const parts = [fromMag, fromSafety].filter((x): x is number => x != null);
    const blended = parts.reduce((a, b) => a + b, 0) / parts.length;
    if (blended >= 60) level = "high";
    else if (blended >= 38) level = "moderate";
    else level = "low";
    if (!risk.available) rationale.push("Risk read is approximate (limited history).");
    else rationale.push(risk.rationale);
  }
  return { risk: level, downsidePctEstimate: downsidePct, invalidationLevel, rationale };
}

// Entry quality from valuation (cheaper = better entry) + momentum (extended
// runs are worse entries) + any invalid timing setup.
function classifyEntry(
  valuation: ActionFactor,
  momentum: ActionFactor,
  signal: ModelSignal | null,
): { quality: EntryQuality; rationale: string[] } {
  const rationale: string[] = [];
  if (signal && signal.invalidReasons.length > 0) {
    rationale.push("Timing model flags an invalid setup — wait for confirmation.");
    return { quality: "wait-for-setup", rationale };
  }
  const val = valuation.available ? valuation.score : null;
  const mom = momentum.available ? momentum.score : null;
  if (val == null && mom == null) {
    return {
      quality: "unknown",
      rationale: ["No valuation or technical context to judge entry timing."],
    };
  }
  if (val != null) rationale.push(valuation.rationale);
  if (mom != null) rationale.push(momentum.rationale);
  // Higher valuation score = cheaper = better entry. Very high momentum can
  // mean an extended chase.
  if (mom != null && mom >= 75 && (val == null || val < 45)) {
    return { quality: "extended", rationale };
  }
  const valGood = val != null && val >= 58;
  const momOk = mom == null || (mom >= 45 && mom < 78);
  if (valGood && momOk) return { quality: "attractive", rationale };
  if ((val != null && val < 38) || (mom != null && mom >= 80))
    return { quality: "extended", rationale };
  return { quality: "fair", rationale };
}

// Infer holding horizon from curated role/timeHorizon/scenario classification.
function classifyHorizon(idea: ConvictionIdea | null): {
  kind: SignalHorizon;
  rationale: string;
} {
  if (!idea) return { kind: "unknown", rationale: "No curated idea metadata to infer a horizon." };
  const tag = idea.scenarioModel?.classification ?? null;
  const th = (idea.timeHorizon ?? "").toLowerCase();
  const role = (idea.roleLabel ?? "").toLowerCase();
  if (tag === "speculative" || role.includes("optionality") || role.includes("variance"))
    return { kind: "speculative-optionality", rationale: `Curated as ${idea.roleLabel || "speculative optionality"}.` };
  if (tag === "5x potential" || tag === "3x potential")
    return { kind: "speculative-optionality", rationale: "High-multiple candidate — outcome is long-tail and binary-ish." };
  if (tag === "compounder" || th.includes("5y") || th.includes("3-5") || th.includes("long"))
    return { kind: "3-5-year-compounder", rationale: `Curated horizon: ${idea.timeHorizon || "multi-year compounder"}.` };
  if (th.includes("12") || th.includes("year") || th.includes("medium"))
    return { kind: "12-month-setup", rationale: `Curated horizon: ${idea.timeHorizon || "~12 months"}.` };
  if (th.includes("short") || th.includes("trade"))
    return { kind: "short-term-trade", rationale: `Curated horizon: ${idea.timeHorizon}.` };
  if (idea.timeHorizon) return { kind: "12-month-setup", rationale: `Curated horizon: ${idea.timeHorizon}.` };
  return { kind: "unknown", rationale: "No clear horizon signal from curated metadata." };
}

function buildConvictionSignal(args: {
  signal: ModelSignal | null;
  idea: ConvictionIdea | null;
  factors: ActionFactor[];
  downgradeTriggers: string[];
}): ConvictionSignal {
  const { signal, idea, factors, downgradeTriggers } = args;
  const byKey = new Map(factors.map((f) => [f.key, f]));
  const valuation = byKey.get("valuation")!;
  const momentum = byKey.get("momentum")!;
  const risk = byKey.get("risk")!;
  const growth = byKey.get("growth")!;
  const analyst = byKey.get("analyst")!;

  const up = classifyUpside(idea);
  const down = classifyDownside(idea, risk, signal);
  const entry = classifyEntry(valuation, momentum, signal);
  const horizon = classifyHorizon(idea);

  // Honest reward/risk *estimate* from the scenario bands when both are present.
  const sm = idea?.scenarioModel ?? null;
  const estimatedRewardRisk =
    sm && sm.rewardRiskRatio != null && Number.isFinite(sm.rewardRiskRatio)
      ? sm.rewardRiskRatio
      : null;

  // Top-level evidence bullets — pull the strongest available factor rationales.
  const evidence: string[] = [];
  if (analyst.available) evidence.push(analyst.rationale);
  if (momentum.available) evidence.push(momentum.rationale);
  if (valuation.available) evidence.push(valuation.rationale);
  if (growth.available) evidence.push(growth.rationale);
  if (risk.available) evidence.push(risk.rationale);
  if (evidence.length === 0)
    evidence.push("Limited live data — signal rests on curated metadata only.");

  // Not-enough-evidence gate: if both upside and downside are unknown and we
  // have almost no usable factors, render the honest "pending" state.
  const availableCount = factors.filter((f) => f.available).length;
  const insufficientEvidence =
    up.potential === "unknown" && down.risk === "unknown" && availableCount < 2;

  // Invalidation triggers reuse the action-signal downgrade triggers plus a
  // concrete downside-tolerance line.
  const invalidationTriggers = [...downgradeTriggers];
  if (down.downsidePctEstimate != null)
    invalidationTriggers.push(
      `Loss exceeds your downside tolerance (bear-case estimate ~${down.downsidePctEstimate}%).`,
    );
  if (down.invalidationLevel != null)
    invalidationTriggers.push(`Price closes below the ${down.invalidationLevel.toFixed(2)} invalidation level.`);

  return {
    upside: {
      potential: up.potential,
      label: UPSIDE_LABEL[up.potential],
      upsidePctEstimate: up.upsidePctEstimate,
      rationale: up.rationale,
    },
    downside: {
      risk: down.risk,
      label: DOWNSIDE_LABEL[down.risk],
      downsidePctEstimate: down.downsidePctEstimate,
      invalidationLevel: down.invalidationLevel,
      rationale: down.rationale,
    },
    entry: {
      quality: entry.quality,
      label: ENTRY_LABEL[entry.quality],
      rationale: entry.rationale,
    },
    horizon: {
      kind: horizon.kind,
      label: HORIZON_LABEL[horizon.kind],
      rationale: horizon.rationale,
    },
    estimatedRewardRisk,
    insufficientEvidence,
    evidence: evidence.slice(0, 5),
    invalidationTriggers: invalidationTriggers.slice(0, 5),
    backtest: buildBacktestStatus(),
  };
}

export function buildActionSignal(args: {
  symbol: string;
  signal: ModelSignal | null;
  buffett: BuffettIndex | null;
  idea: ConvictionIdea | null;
  analyst: AnalystConsensus | null;
}): ActionSignal {
  const { symbol, signal, buffett, idea, analyst } = args;

  const factors: ActionFactor[] = [
    momentumFactor(signal),
    valuationFactor(signal, buffett),
    qualityFactor(buffett),
    growthFactor(idea, buffett),
    riskFactor(signal),
    analystFactor(analyst),
  ];

  // Assign weights, redistributing the weight of any unavailable factor.
  const availableKeys = factors.filter((f) => f.available).map((f) => f.key);
  const availableWeightTotal = availableKeys.reduce((a, k) => a + BASE_WEIGHTS[k], 0) || 1;
  for (const f of factors) {
    f.weight = f.available ? BASE_WEIGHTS[f.key] / availableWeightTotal : 0;
  }

  const composite = clamp(
    factors.reduce((acc, f) => (f.available && f.score != null ? acc + f.score * f.weight : acc), 0),
  );

  // Thesis / review-status gate: a "needs-review" idea should not surface as a
  // fresh buy; cap it at Hold and note why.
  const notes: string[] = [];
  let score = composite;
  let action = actionForScore(score);
  if (idea?.reviewStatus === "needs-review" && (action === "Add" || action === "Starter")) {
    action = "Hold";
    notes.push("Capped at Hold: thesis is flagged needs-review.");
  }
  // Invalid setup from the timing model forces caution.
  if (signal && signal.invalidReasons.length > 0 && action !== "Avoid" && action !== "Trim") {
    action = "Watch";
    notes.push("Downgraded to Watch: timing model flagged an invalid setup.");
  }

  const availableFrac = availableKeys.length / factors.length;
  const confidence = confidenceFor(availableFrac, score);

  // Agreement vs. analyst consensus.
  const internalStance = stanceForScore(score);
  const aStance = analystStance(analyst);
  let agreement: ActionAgreement["agreement"];
  let note: string;
  if (aStance == null) {
    agreement = "no-coverage";
    note = "No analyst coverage to compare against — internal view stands alone.";
  } else if (aStance === internalStance) {
    agreement = "aligned";
    note = `Internal model and analysts agree (${internalStance}).`;
  } else {
    const rank = { bearish: 0, neutral: 1, bullish: 2 } as const;
    if (rank[aStance] > rank[internalStance]) {
      agreement = "analysts-more-bullish";
      note = `Analysts are more bullish (${analyst?.consensusLabel}) than the internal ${action} call.`;
    } else {
      agreement = "analysts-more-bearish";
      note = `Analysts are more cautious (${analyst?.consensusLabel}) than the internal ${action} call.`;
    }
  }

  // Upgrade / downgrade triggers — concrete, factor-driven.
  const upgradeTriggers: string[] = [];
  const downgradeTriggers: string[] = [];
  const byKey = new Map(factors.map((f) => [f.key, f]));
  const mo = byKey.get("momentum")!;
  const va = byKey.get("valuation")!;
  const ri = byKey.get("risk")!;
  const an = byKey.get("analyst")!;
  const gr = byKey.get("growth")!;

  if (mo.available && (mo.score ?? 0) < 55)
    upgradeTriggers.push("Momentum turns up — price reclaims its 50/200-day moving averages.");
  if (va.available && (va.score ?? 0) < 50)
    upgradeTriggers.push("Valuation resets lower (pullback or earnings catch-up).");
  if (gr.available && (gr.score ?? 0) < 55)
    upgradeTriggers.push("Revenue/EPS growth re-accelerates in the next print.");
  if (an.available && (an.score ?? 0) < 60)
    upgradeTriggers.push("Analyst consensus shifts toward Buy/Strong Buy.");
  if (idea?.reviewStatus === "needs-review")
    upgradeTriggers.push("Thesis review is completed and confirmed.");
  if (upgradeTriggers.length === 0)
    upgradeTriggers.push("Sustained strength across momentum, growth and analyst trend.");

  if (mo.available && (mo.score ?? 100) >= 55)
    downgradeTriggers.push("Trend breaks — price loses its 50-day moving average.");
  if (ri.available && (ri.score ?? 100) >= 45)
    downgradeTriggers.push("Volatility or drawdown spikes (risk score deteriorates).");
  if (va.available && (va.score ?? 0) >= 55)
    downgradeTriggers.push("Valuation re-rates to a stretched multiple.");
  if (an.available)
    downgradeTriggers.push("Analyst downgrades push consensus toward Hold/Sell.");
  if (signal && signal.stopPrice != null)
    downgradeTriggers.push(`Price breaches the model stop (~${signal.stopPrice.toFixed(2)}).`);
  if (downgradeTriggers.length === 0)
    downgradeTriggers.push("Material deterioration in growth, quality or risk.");

  const trimmedDowngrade = downgradeTriggers.slice(0, 4);
  const conviction = buildConvictionSignal({
    signal,
    idea,
    factors,
    downgradeTriggers: trimmedDowngrade,
  });

  // Transparent Quant Score v1, built from the same per-factor reads so the two
  // views stay consistent. The action engine references it via the dedicated
  // quantScore field (and its own panel) rather than the amber notes list.
  const quantScore = buildQuantScore({ symbol, factors });

  return {
    symbol,
    asOf: Date.now(),
    action,
    compositeScore: Math.round(score),
    confidence,
    summary: ACTION_SUMMARY[action],
    factors,
    upgradeTriggers: upgradeTriggers.slice(0, 4),
    downgradeTriggers: trimmedDowngrade,
    agreement: { internalStance, analystStance: aStance, agreement, note },
    conviction,
    quantScore,
    legacySignal: signal?.signal ?? "Invalid Setup",
    analystConsensus: analyst,
    notes,
  };
}
