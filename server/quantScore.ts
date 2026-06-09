// Quant Score v1 — a transparent, weighted factor-score model.
//
// DESIGN: this is intentionally NOT a black-box price predictor. It reuses the
// same deterministic per-factor reads the Action Signal already computes
// (momentum/trend, analyst consensus, valuation, growth, quality, risk) so the
// quant score and the action label never disagree on the underlying evidence.
// Each factor is mapped to a labelled, source-tagged QuantFactor with an
// explicit data status. Factors with no data are marked "unavailable" (or
// "pending" when the path exists but is empty) and their weight is
// redistributed across the scored factors. The overall 0-100 is the
// weight-normalised sum of scored contributions; the confidence level falls out
// of how much of the model's intended weight was actually backed by data.
//
// Nothing here calls an LLM and nothing overstates precision: when coverage is
// thin we return a null overall with an "Insufficient data" band rather than a
// fabricated number.

import type {
  ActionFactor,
  QuantBacktestStatus,
  QuantBand,
  QuantConfidence,
  QuantFactor,
  QuantFactorKey,
  QuantScore,
  QuantSource,
} from "@shared/schema";
import { QUANT_BACKTEST_METHOD_ID } from "./quantBacktestMeta";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

// Base weights for the six quant factors. They sum to 1. Momentum/trend and
// analyst sentiment are the most reliably-available, price-and-coverage-derived
// signals, so they carry the most weight; valuation/growth/quality lean on
// fundamentals that are frequently missing for ETFs/funds; risk rounds it out.
export const BASE_WEIGHTS: Record<QuantFactorKey, number> = {
  momentum: 0.26,
  analyst: 0.2,
  valuation: 0.16,
  growth: 0.14,
  quality: 0.14,
  risk: 0.1,
};

// Human labels for the six factors, exported so the Model Lab can render weight
// controls without duplicating the strings.
export const QUANT_FACTOR_LABELS: Record<QuantFactorKey, string> = {
  momentum: "Momentum / Trend",
  analyst: "Analyst Sentiment",
  valuation: "Valuation",
  growth: "Growth",
  quality: "Quality / Financial Strength",
  risk: "Risk / Volatility",
};

const SOURCE: Record<QuantFactorKey, QuantSource> = {
  momentum: "technical",
  analyst: "analyst",
  valuation: "fundamental",
  growth: "fundamental",
  quality: "fundamental",
  risk: "risk",
};

const LABEL = QUANT_FACTOR_LABELS;

// Map an ActionFactor key to its quant key (they share names except the quant
// model treats them identically). The action engine already produces a 0-100
// score, an `available` flag and a one-line rationale for each.
const ACTION_KEY: Record<QuantFactorKey, ActionFactor["key"]> = {
  momentum: "momentum",
  analyst: "analyst",
  valuation: "valuation",
  growth: "growth",
  quality: "quality",
  risk: "risk",
};

// Factors whose data path *exists* in the app but is often empty (live price,
// SEC fundamentals, Finnhub coverage). When such a factor is unavailable we
// label it "pending" (data may arrive) rather than the harder "unavailable".
const PENDING_WHEN_MISSING: Record<QuantFactorKey, boolean> = {
  momentum: true, // needs live price history
  analyst: true, // needs Finnhub coverage/token
  valuation: true, // needs fundamentals / valuation anchor
  growth: true, // needs revenue/EPS history
  quality: false, // genuinely N/A for ETFs/funds → unavailable
  risk: true, // needs price history
};

function bandFor(score: number): { band: QuantBand; label: string } {
  if (score >= 70) return { band: "strong", label: "Strong" };
  if (score >= 58) return { band: "constructive", label: "Constructive" };
  if (score >= 45) return { band: "mixed", label: "Mixed" };
  return { band: "weak", label: "Weak" };
}

function confidenceFor(coverage: number, scoredCount: number): QuantConfidence {
  if (scoredCount < 2 || coverage < 0.3) return "insufficient";
  if (coverage >= 0.75 && scoredCount >= 4) return "high";
  if (coverage >= 0.5) return "medium";
  return "low";
}

function quantBacktestStatus(): QuantBacktestStatus {
  return {
    tested: false,
    label: "Not validated yet",
    note:
      "The full quant score (which blends fundamentals and analyst data) has not been backtested. A separate technical-only backtest validates just the price/momentum portion of these rules over a 1-year window — see the Backtest panel. Treat the quant score as a transparent heuristic until validated.",
    methodId: QUANT_BACKTEST_METHOD_ID,
  };
}

// Build the QuantScore from the already-computed Action Signal factors. Pure —
// no I/O. Reusing the action factors guarantees the two views are consistent.
export function buildQuantScore(args: {
  symbol: string;
  factors: ActionFactor[];
}): QuantScore {
  const { symbol, factors } = args;
  const byKey = new Map(factors.map((f) => [f.key, f]));
  const keys = Object.keys(BASE_WEIGHTS) as QuantFactorKey[];

  // First pass: map each quant factor to its action read + status.
  const draft = keys.map((key) => {
    const af = byKey.get(ACTION_KEY[key]) ?? null;
    const scored = !!af && af.available && af.score != null;
    const status: QuantFactor["status"] = scored
      ? "scored"
      : PENDING_WHEN_MISSING[key]
        ? "pending"
        : "unavailable";
    const score = scored ? clamp(af!.score as number) : null;
    const rationale = (() => {
      if (af?.rationale) return af.rationale;
      if (status === "pending") return "Pending market/fundamental data.";
      return "Not applicable to this instrument.";
    })();
    return { key, scored, status, score, rationale };
  });

  // Redistribute weight across the scored factors.
  const scoredKeys = draft.filter((d) => d.scored).map((d) => d.key);
  const scoredWeightTotal =
    scoredKeys.reduce((a, k) => a + BASE_WEIGHTS[k], 0) || 0;

  const factorsOut: QuantFactor[] = draft.map((d) => {
    const baseWeight = BASE_WEIGHTS[d.key];
    const weight =
      d.scored && scoredWeightTotal > 0 ? baseWeight / scoredWeightTotal : 0;
    const contribution = d.scored && d.score != null ? d.score * weight : 0;
    return {
      key: d.key,
      label: LABEL[d.key],
      source: SOURCE[d.key],
      status: d.status,
      score: d.score,
      baseWeight: round1(baseWeight * 100) / 100,
      weight: round1(weight * 100) / 100,
      contribution: Math.round(contribution * 10) / 10,
      rationale: d.rationale,
    };
  });

  // Data coverage = fraction of the model's *intended base weight* that ended up
  // backed by a real score. This is a more honest coverage measure than a raw
  // factor count because it weights the important factors more heavily.
  const dataCoverage = round1(scoredWeightTotal * 100) / 100;
  const scoredFactors = scoredKeys.length;
  const totalFactors = keys.length;

  const confidence = confidenceFor(dataCoverage, scoredFactors);

  let overall: number | null = null;
  let band: QuantBand;
  let bandLabel: string;
  if (confidence === "insufficient") {
    band = "insufficient";
    bandLabel = "Insufficient data";
  } else {
    const composite = clamp(
      factorsOut.reduce((acc, f) => acc + f.contribution, 0),
    );
    overall = Math.round(composite);
    const b = bandFor(overall);
    band = b.band;
    bandLabel = b.label;
  }

  const summary =
    overall == null
      ? `Insufficient data — only ${scoredFactors}/${totalFactors} factors scored (${Math.round(
          dataCoverage * 100,
        )}% coverage). Pending market/fundamental data.`
      : `${bandLabel} — quant score ${overall}/100 on ${scoredFactors}/${totalFactors} factors (${Math.round(
          dataCoverage * 100,
        )}% data coverage, ${confidence} confidence).`;

  return {
    symbol,
    asOf: Date.now(),
    overall,
    band,
    bandLabel,
    confidence,
    dataCoverage,
    scoredFactors,
    totalFactors,
    factors: factorsOut,
    summary,
    backtest: quantBacktestStatus(),
  };
}
