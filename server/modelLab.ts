// Model Lab — a sandbox over the Quant Score v1 factor weights.
//
// HONEST FRAMING: the live Quant Score blends six factors (momentum/trend,
// analyst sentiment, valuation, growth, quality, risk). Only two of those —
// Momentum/Trend and Risk/Volatility — can be reconstructed point-in-time from
// price history alone without look-ahead bias. So when the user tunes weights
// here, we apply their *momentum* and *risk* weights end-to-end to the same
// technical-only backtest engine that powers Backtest v1 (re-blending the
// trend/momentum vs. volatility technical components under those weights), and
// we clearly flag the fundamental/analyst weights as informational-only: they
// shape the live score but cannot be backtested technically. Nothing here is
// personalized financial advice; it is a modeling sandbox.

import type {
  ModelLabBacktestRequest,
  ModelLabBacktestResponse,
  ModelLabBacktestResult,
  ModelLabFactorApplication,
  ModelStrategyPreset,
  ModelWeights,
  QuantBacktestVerdict,
  QuantFactorKey,
} from "@shared/schema";
import { BASE_WEIGHTS, QUANT_FACTOR_LABELS } from "./quantScore";
import { runWeightedBacktest } from "./quantBacktest";

const FACTOR_KEYS: QuantFactorKey[] = [
  "momentum",
  "analyst",
  "valuation",
  "growth",
  "quality",
  "risk",
];

// Factors the technical-only backtest can honour point-in-time. Everything else
// is informational (it shapes the live Quant Score but cannot be backtested
// without look-ahead).
const TECHNICAL_FACTORS = new Set<QuantFactorKey>(["momentum", "risk"]);

const DEFAULT_WEIGHTS: ModelWeights = { ...BASE_WEIGHTS };

// The comparison strategies surfaced in the lab. Default mirrors Quant Score v1;
// the tilts shift emphasis so the user can see how a momentum/growth/risk lean
// changes the technically-validatable behaviour. Weights are intentionally
// human-round and need not sum to 1 (they are normalised on use).
const PRESETS: ModelStrategyPreset[] = [
  {
    id: "default",
    label: "Default Model",
    description: "Quant Score v1 base weights — balanced across all six factors.",
    weights: { ...DEFAULT_WEIGHTS },
  },
  {
    id: "momentum-tilt",
    label: "Momentum Tilt",
    description: "Leans into price trend/momentum; lighter on valuation.",
    weights: {
      momentum: 0.4,
      analyst: 0.18,
      valuation: 0.08,
      growth: 0.14,
      quality: 0.1,
      risk: 0.1,
    },
  },
  {
    id: "growth-tilt",
    label: "Growth Tilt",
    description: "Emphasises growth and analyst expectations over valuation.",
    weights: {
      momentum: 0.22,
      analyst: 0.24,
      valuation: 0.06,
      growth: 0.28,
      quality: 0.12,
      risk: 0.08,
    },
  },
  {
    id: "risk-control",
    label: "Risk-Control Tilt",
    description: "Down-weights momentum, up-weights risk/quality for a calmer book.",
    weights: {
      momentum: 0.18,
      analyst: 0.16,
      valuation: 0.16,
      growth: 0.1,
      quality: 0.18,
      risk: 0.22,
    },
  },
];

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// Normalise a (possibly partial / unnormalised) weight set to a full set that
// sums to 1 across the six factors. Falls back to the default weights when the
// input has no positive weight at all.
function normaliseWeights(input: Partial<ModelWeights> | undefined): ModelWeights {
  const raw: ModelWeights = { ...DEFAULT_WEIGHTS };
  if (input) {
    for (const k of FACTOR_KEYS) {
      if (input[k] != null) raw[k] = clamp01(input[k] as number);
    }
  }
  const total = FACTOR_KEYS.reduce((a, k) => a + raw[k], 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as ModelWeights;
  for (const k of FACTOR_KEYS) out[k] = Math.round((raw[k] / total) * 1000) / 1000;
  return out;
}

// Map normalised factor weights to the two technical sub-weights the backtest
// engine understands. Momentum/Trend → trend+momentum component; Risk →
// volatility component. Their ratio is preserved; if both are zero we fall back
// to a momentum-only blend so a signal can still be produced.
function technicalSubWeights(w: ModelWeights): {
  trendMomentum: number;
  volatility: number;
} {
  const tm = w.momentum;
  const vol = w.risk;
  const total = tm + vol;
  if (total <= 0) return { trendMomentum: 1, volatility: 0 };
  return {
    trendMomentum: Math.round((tm / total) * 1000) / 1000,
    volatility: Math.round((vol / total) * 1000) / 1000,
  };
}

function factorApplication(w: ModelWeights): ModelLabFactorApplication[] {
  return FACTOR_KEYS.map((key) => {
    const technicallyApplied = TECHNICAL_FACTORS.has(key);
    return {
      key,
      label: QUANT_FACTOR_LABELS[key],
      requestedWeight: w[key],
      technicallyApplied,
      note: technicallyApplied
        ? "Applied point-in-time in the technical backtest."
        : "Shapes the live Quant Score, but excluded from the technical backtest to avoid look-ahead bias.",
    };
  });
}

const DISCLAIMER =
  "Model Lab is a research/modeling sandbox, not personalized financial advice. Only the momentum/trend and risk/volatility weights are validated against price history; fundamental and analyst weights are informational. Past technical behaviour is not a track record or a performance guarantee.";

function resolveStrategy(req: ModelLabBacktestRequest): {
  id: string;
  label: string;
  weights: ModelWeights;
} {
  // Explicit custom weights win over a preset id.
  if (req.weights && Object.keys(req.weights).length > 0) {
    return {
      id: "custom",
      label: "Custom weights",
      weights: normaliseWeights(req.weights),
    };
  }
  if (req.presetId) {
    const preset = PRESETS.find((p) => p.id === req.presetId);
    if (preset) {
      return {
        id: preset.id,
        label: preset.label,
        weights: normaliseWeights(preset.weights),
      };
    }
  }
  return {
    id: "default",
    label: "Default Model",
    weights: normaliseWeights(DEFAULT_WEIGHTS),
  };
}

export async function runModelLabBacktest(
  req: ModelLabBacktestRequest,
): Promise<ModelLabBacktestResponse> {
  const strategy = resolveStrategy(req);
  const techWeights = technicalSubWeights(strategy.weights);
  const run = await runWeightedBacktest(techWeights);

  const technicalCoverage =
    Math.round((strategy.weights.momentum + strategy.weights.risk) * 1000) /
    1000;

  // Headline pulled from the 1Y window's top-cohort (falls back to the first
  // available window / its first cohort) for the comparison strip.
  let headline: ModelLabBacktestResult["headline"] = null;
  const headlineWindow =
    run.windows.find((w) => w.key === "1Y" && w.available) ??
    run.windows.find((w) => w.available);
  if (headlineWindow) {
    const cohort =
      headlineWindow.thresholds.find((t) => t.key === "top-cohort") ??
      headlineWindow.thresholds[0];
    if (cohort) {
      headline = {
        windowKey: headlineWindow.key,
        selectedAvgReturnPct: cohort.selectedAvgReturnPct,
        excessVsBenchmarkPct: cohort.excessVsBenchmarkPct,
        hitRatePct: cohort.hitRatePct,
        verdict: cohort.verdict as QuantBacktestVerdict,
      };
    }
  }

  const result: ModelLabBacktestResult = {
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    weights: strategy.weights,
    technicalWeights: techWeights,
    factorApplication: factorApplication(strategy.weights),
    technicalCoverage,
    tested: run.tested,
    benchmarkSymbol: run.benchmarkSymbol,
    windows: run.windows,
    headline,
  };

  const methodology = [
    "Model Lab reuses the Backtest v1 engine: at each window's decision date (today − window) it scores a point-in-time technical signal from prior bars only, then measures the forward return to today.",
    "Your Momentum/Trend and Risk/Volatility weights are applied end-to-end by re-blending the trend/momentum and volatility technical components in that exact ratio.",
    "Valuation, Growth, Quality and Analyst weights are accepted and shown, but are intentionally NOT used in the technical backtest because their data is only available as today's snapshot and would inject look-ahead bias.",
  ].join(" ");

  const limitations = [
    `Only ${Math.round(technicalCoverage * 100)}% of your model weight (momentum + risk) is technically validated here; the rest shapes the live Quant Score but is not backtested.`,
    "Technical-only and point-in-time, but still subject to universe look-ahead/survivorship: the tested names are today's curated universe.",
    "Overlapping windows are correlated, not independent out-of-sample tests. Price-only returns; dividends/corporate actions are not modelled.",
    "The trend/momentum and volatility component formulas are fixed heuristics, not fitted parameters; only their blend ratio responds to your weights.",
    "Research/education only — not a track record, performance claim, or recommendation.",
  ];

  return {
    asOf: Date.now(),
    methodId: run.methodId,
    universeSize: run.universeSize,
    benchmarkSymbol: run.benchmarkSymbol,
    result,
    presets: PRESETS,
    defaultWeights: { ...DEFAULT_WEIGHTS },
    technicalOnly: true,
    validationBadge: "Technical-only",
    methodology,
    limitations,
    disclaimer: DISCLAIMER,
  };
}
