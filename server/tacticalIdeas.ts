// Tactical Ideas — deterministic, transparent ranking of SHORT-TERM / tactical
// setups from the SAME curated Stock Picks universe Trade Ideas uses (no
// universe expansion in this pass).
//
// Where Trade Ideas' Longs view ranks multi-year conviction, Tactical Ideas
// surfaces names where the model sees a near-term, actionable mispricing:
//   - a constructive-but-not-parabolic trend (momentum windows),
//   - real remaining base-case room (scenario model),
//   - a contained invalidation level (scenario bear target),
//   - and, where present, a catalyst.
//
// Design (mirrors the rest of TreasuryLens):
//   - No LLM, no black box. Every score is a visible weighted blend.
//   - Reuse the already-enriched universe (getStockPicks) — picks arrive with
//     keyMetrics.performance (1m/6m/12m momentum) and a scenarioModel. We do
//     NOT recompute pricing or fetch intraday technicals.
//   - The expected tactical upside RANGE is a near-term window, not the
//     multi-year bull case: a conservative leg (a fraction of remaining
//     base-case room) and a stretch leg (toward the base / lower-bull target),
//     compressed to a tactical horizon. Research-only language throughout.
//   - Options reuse Trade Ideas' modeled-fallback structures (no live chain),
//     re-labelled to the tactical horizon and tagged with the setup kind.
//
// Research / education only. Not personalized financial advice. Short-term and
// options ideas carry ELEVATED risk. "Potential" / "model-implied" framing — no
// deterministic promises.

import { getStockPicks } from "./stockPicks";
import {
  buildLong,
  buildOption,
  ivProxyPct,
  structuresFor,
  type LongWithVol,
} from "./tradeIdeas";
import type {
  RiskLevel,
  StockPick,
  TacticalFactor,
  TacticalHorizon,
  TacticalIdea,
  TacticalIdeasResponse,
  TacticalOption,
  TacticalSetupKind,
  TradeIdeaLong,
  TradeIdeaTier,
} from "@shared/schema";

const TTL_MS = 30 * 60 * 1000;
let cached: { at: number; data: TacticalIdeasResponse } | null = null;

const DISCLAIMER =
  "Tactical Ideas are deterministic research distillations of TreasuryLens's curated universe and scenario model — not personalized financial advice, not signals to trade. They rank SHORT-TERM setups from trailing momentum windows and the scenario model; short-term and options ideas carry ELEVATED risk and can move against you quickly. The expected upside is a model-implied RANGE over a tactical horizon, never a promise. Option structures are MODELED fallbacks (no live option chain): premiums, breakevens, max-loss and probabilities are illustrative estimates. Verify every level with your broker before acting.";

function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function tierFromScore(score: number): TradeIdeaTier {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

const SETUPS: { kind: TacticalSetupKind; label: string; blurb: string }[] = [
  {
    kind: "momentum-continuation",
    label: "Momentum continuation",
    blurb:
      "A healthy, established uptrend that still has model-implied room to the base case — riding strength rather than fading it.",
  },
  {
    kind: "breakout-watch",
    label: "Breakout watch",
    blurb:
      "Accelerating recent momentum pushing toward prior strength, with base-case room left. Higher beta, tighter invalidation.",
  },
  {
    kind: "pullback-in-uptrend",
    label: "Pullback in uptrend",
    blurb:
      "A constructive longer-term trend that has recently cooled — a potential lower-risk entry into an intact uptrend.",
  },
  {
    kind: "mean-reversion-rebound",
    label: "Mean-reversion rebound",
    blurb:
      "A washed-out name showing signs of stabilising with meaningful model-implied upside. Elevated risk — could be a falling knife.",
  },
  {
    kind: "value-dislocation",
    label: "Value dislocation",
    blurb:
      "Muted momentum but a large model-implied gap to the base case — the model sees the market discounting the thesis.",
  },
];

const SETUP_LABEL: Record<TacticalSetupKind, string> = Object.fromEntries(
  SETUPS.map((s) => [s.kind, s.label]),
) as Record<TacticalSetupKind, string>;

const SETUP_HORIZON: Record<TacticalSetupKind, TacticalHorizon> = {
  "momentum-continuation": "1-3 months",
  "breakout-watch": "2-6 weeks",
  "pullback-in-uptrend": "1-3 months",
  "mean-reversion-rebound": "3-6 months",
  "value-dislocation": "3-6 months",
};

// Classify the tactical setup from trailing momentum windows + remaining
// base-case room. Transparent thresholds — momentum is the trend proxy (no
// intraday technicals are attached to picks).
function classifySetup(
  c1m: number | null,
  c6m: number | null,
  baseUpside: number | null,
): TacticalSetupKind {
  const room = baseUpside ?? 0;
  // Sharp recent acceleration → breakout watch.
  if (c1m != null && c1m > 12 && (c6m == null || c6m > 0)) return "breakout-watch";
  // Drawn down recently but longer trend intact → pullback.
  if (c1m != null && c1m < -6 && c6m != null && c6m > 10)
    return "pullback-in-uptrend";
  // Washed out over 6m but stabilising in the last month → rebound.
  if (c6m != null && c6m < -20 && c1m != null && c1m > -3)
    return "mean-reversion-rebound";
  // Muted momentum, large room → value dislocation.
  if ((c6m == null || Math.abs(c6m) < 12) && room >= 45) return "value-dislocation";
  // Healthy established trend → continuation.
  if (c6m != null && c6m > 8) return "momentum-continuation";
  // Default lean: if there's room, treat as a dislocation, else continuation.
  return room >= 30 ? "value-dislocation" : "momentum-continuation";
}

// 0-100 momentum score: rewards constructive-but-not-parabolic trend. Parabolic
// (very large 6m) is trimmed because tactical entries chase less; deep negatives
// score low unless a rebound is forming (handled by setup kind, not here).
function momentumScore(c1m: number | null, c6m: number | null): number {
  if (c1m == null && c6m == null) return 50;
  const m1 = c1m ?? 0;
  const m6 = c6m ?? 0;
  // 6m trend: peak reward around +20–40%, trimmed beyond +80% (extended).
  let s6: number;
  if (m6 <= 0) s6 = clamp(50 + m6 * 0.8, 5, 50);
  else if (m6 <= 40) s6 = clamp(50 + m6, 50, 90);
  else s6 = clamp(90 - (m6 - 40) * 0.5, 45, 90);
  // 1m: mild positive is good; sharp spikes slightly trimmed.
  let s1: number;
  if (m1 <= 0) s1 = clamp(55 + m1 * 1.2, 10, 55);
  else if (m1 <= 12) s1 = clamp(55 + m1 * 2, 55, 90);
  else s1 = clamp(90 - (m1 - 12) * 1.0, 55, 90);
  return clamp(s6 * 0.6 + s1 * 0.4, 0, 100);
}

// Near-term tactical upside RANGE. We compress the scenario base/bull room into
// a tactical window: the low leg is a fraction of remaining base-case room; the
// high leg reaches toward the base target (or a capped fraction of the bull leg
// when base room is thin). Deliberately conservative vs the multi-year case.
function tacticalUpsideRange(
  baseUpside: number | null,
  bullUpside: number | null,
  setup: TacticalSetupKind,
): { low: number | null; high: number | null } {
  if (baseUpside == null && bullUpside == null) return { low: null, high: null };
  const base = baseUpside ?? 0;
  const bull = bullUpside ?? base * 1.6;
  // Tactical capture fractions by setup — breakouts/rebounds aim for a bigger
  // near-term move, continuations/dislocations a steadier one.
  const cap: Record<TacticalSetupKind, { lo: number; hi: number }> = {
    "momentum-continuation": { lo: 0.3, hi: 0.6 },
    "breakout-watch": { lo: 0.35, hi: 0.7 },
    "pullback-in-uptrend": { lo: 0.3, hi: 0.6 },
    "mean-reversion-rebound": { lo: 0.4, hi: 0.8 },
    "value-dislocation": { lo: 0.35, hi: 0.65 },
  };
  const f = cap[setup];
  const low = clamp(base * f.lo, 4, 120);
  // High leg blends base and a slice of the bull tail.
  const high = clamp(Math.max(base * f.hi, base * f.lo + 6, bull * 0.45), low + 4, 200);
  return { low: round(low, 0), high: round(high, 0) };
}

const RISK_RANK: Record<RiskLevel, number> = {
  low: 1,
  moderate: 2,
  elevated: 3,
  high: 4,
  "very high": 5,
};

function buildTactical(pick: StockPick, long: TradeIdeaLong): TacticalIdea {
  const km = pick.keyMetrics ?? null;
  const perf = km?.performance ?? null;
  const sm = pick.scenarioModel ?? null;
  const c1m = perf?.change1mPct ?? null;
  const c6m = perf?.change6mPct ?? null;
  const c12m = perf?.change12mPct ?? null;
  const baseUpside = sm?.base.outputs.impliedReturnPct ?? null;
  const bullUpside = sm?.bullUpsidePct ?? null;

  const setup = classifySetup(c1m, c6m, baseUpside);
  const horizon = SETUP_HORIZON[setup];

  // ── Transparent factor blend ─────────────────────────────────────────────
  const momPts = momentumScore(c1m, c6m);
  // Base-case room: more remaining room → higher (peaks ~+70%).
  const roomPts =
    baseUpside == null ? 50 : clamp(25 + baseUpside * 0.9, 10, 95);
  // Entry quality reuses the long's derived read.
  const entryPts =
    long.entryQuality === "attractive"
      ? 90
      : long.entryQuality === "fair"
        ? 65
        : long.entryQuality === "wait-for-setup"
          ? 45
          : long.entryQuality === "extended"
            ? 30
            : 50;
  // Reward/risk from the scenario model.
  const rr = sm?.rewardRiskRatio ?? null;
  const rrPts = rr == null ? 45 : clamp(40 + (rr - 1) * 28, 0, 95);
  // Catalyst presence.
  const hasCatalyst = pick.whatMustBeTrue.length > 0;
  const catPts = hasCatalyst
    ? clamp(50 + pick.whatMustBeTrue.length * 12, 50, 90)
    : 35;

  const factors: TacticalFactor[] = [
    {
      key: "momentum",
      label: "Trend / momentum",
      score: round(momPts, 0),
      weight: 0.32,
      note:
        c6m != null
          ? `6m ${c6m >= 0 ? "+" : ""}${Math.round(c6m)}%${c1m != null ? `, 1m ${c1m >= 0 ? "+" : ""}${Math.round(c1m)}%` : ""} — rewards constructive, non-parabolic trend.`
          : "No trailing momentum window available.",
    },
    {
      key: "base-room",
      label: "Base-case room",
      score: round(roomPts, 0),
      weight: 0.26,
      note:
        baseUpside != null
          ? `Scenario base case still implies ~${Math.round(baseUpside)}% room.`
          : "No scenario base case available.",
    },
    {
      key: "entry",
      label: "Entry quality",
      score: round(entryPts, 0),
      weight: 0.18,
      note: `Entry read: ${long.entryLabel}.`,
    },
    {
      key: "reward-risk",
      label: "Scenario reward/risk",
      score: round(rrPts, 0),
      weight: 0.14,
      note:
        rr != null
          ? `Scenario reward/risk ~${rr.toFixed(1)}x.`
          : "Reward/risk unavailable.",
    },
    {
      key: "catalyst",
      label: "Catalyst",
      score: round(catPts, 0),
      weight: 0.1,
      note: hasCatalyst
        ? `${pick.whatMustBeTrue.length} tracked catalyst(s).`
        : "No near-term catalyst tracked.",
    },
  ];

  const tacticalScore = round(
    factors.reduce((a, f) => a + f.score * f.weight, 0),
    0,
  );

  // Signal quality: how much data backed the read. Penalise missing momentum or
  // scenario coverage.
  let quality = 100;
  if (c6m == null) quality -= 30;
  if (c1m == null) quality -= 15;
  if (sm == null) quality -= 35;
  else if (sm.coverageConfidence === "low") quality -= 15;
  else if (sm.coverageConfidence === "medium") quality -= 7;
  if (pick.dataConfidence === "low") quality -= 10;
  quality = clamp(quality, 10, 100);
  const signalQualityLabel =
    quality >= 75 ? "strong" : quality >= 50 ? "moderate" : "thin";

  const range = tacticalUpsideRange(baseUpside, bullUpside, setup);
  const upsideLabel =
    range.low != null && range.high != null
      ? `potential +${range.low}–${range.high}%`
      : "potential upside n/a";

  const price = km?.price ?? null;
  const invalidationLevel = long.invalidationLevel;
  const invalidationPct =
    price != null && invalidationLevel != null && price > 0
      ? round(((invalidationLevel - price) / price) * 100, 0)
      : null;

  // Analyst target gap: a price-target row is surfaced on the scenario analyst
  // block only when a provider returned one. Read it defensively — most names
  // have no wired target today, so this stays null and the UI simply omits it.
  const aeRows = sm?.analystEstimates?.rows ?? null;
  const ptRow = aeRows?.find(
    (r) => r.key === "priceTarget" || /price target/i.test(r.label ?? ""),
  );
  const meanTarget =
    ptRow && typeof ptRow.value === "number" && Number.isFinite(ptRow.value)
      ? ptRow.value
      : null;
  const analystTargetGapPct =
    price != null && meanTarget != null && price > 0
      ? round(((meanTarget - price) / price) * 100, 0)
      : null;

  const whyMispriced: string[] = [];
  switch (setup) {
    case "breakout-watch":
      whyMispriced.push(
        "Recent momentum is accelerating while the scenario model still leaves base-case room — the move may not be fully priced.",
      );
      break;
    case "pullback-in-uptrend":
      whyMispriced.push(
        "A constructive longer-term trend has cooled off recently, offering a potentially lower-risk entry into an intact uptrend.",
      );
      break;
    case "mean-reversion-rebound":
      whyMispriced.push(
        "The name is washed out over 6 months but stabilising lately, with meaningful model-implied upside if the trend turns.",
      );
      break;
    case "value-dislocation":
      whyMispriced.push(
        "Momentum is muted but the scenario base case implies a large gap to fair value — the model sees the market discounting the thesis.",
      );
      break;
    default:
      whyMispriced.push(
        "An established uptrend still has model-implied room to the base case — riding strength rather than fading it.",
      );
  }
  if (analystTargetGapPct != null && analystTargetGapPct > 10)
    whyMispriced.push(
      `Reference analyst mean target sits ~${analystTargetGapPct}% above the current price.`,
    );
  if (hasCatalyst && pick.whatMustBeTrue[0])
    whyMispriced.push(`Catalyst in view: ${pick.whatMustBeTrue[0]}`);

  const invalidationRules: string[] = [];
  if (invalidationLevel != null)
    invalidationRules.push(
      `Sustained close below the invalidation level (~${invalidationLevel}${km?.priceCurrency === "USD" || !km?.priceCurrency ? "" : ` ${km?.priceCurrency}`}) voids the setup.`,
    );
  if (setup === "breakout-watch")
    invalidationRules.push(
      "A failed breakout that falls back below the prior range invalidates the tactical thesis.",
    );
  if (setup === "mean-reversion-rebound")
    invalidationRules.push(
      "A fresh lower low (no stabilisation) means the downtrend is intact — stand aside.",
    );
  invalidationRules.push(
    `Horizon guardrail: re-evaluate if the thesis hasn't progressed within the ${horizon} window.`,
  );

  return {
    ticker: pick.ticker,
    companyName: pick.companyName,
    themes: pick.themes,
    subTheme: pick.subTheme ?? null,
    tacticalScore,
    tier: tierFromScore(tacticalScore),
    setupKind: setup,
    setupLabel: SETUP_LABEL[setup],
    horizon,
    riskLevel: pick.riskLevel,
    signalQuality: round(quality, 0),
    signalQualityLabel,
    price,
    priceCurrency: km?.priceCurrency ?? null,
    upsideLowPct: range.low,
    upsideHighPct: range.high,
    upsideLabel,
    invalidationLevel,
    invalidationPct,
    change1mPct: c1m,
    change6mPct: c6m,
    change12mPct: c12m,
    analystTargetGapPct,
    hasCatalyst,
    catalyst: pick.whatMustBeTrue[0] ?? null,
    whyMispriced,
    factors,
    invalidationRules,
    optionsAvailable: price != null && price > 0,
    dataConfidence: pick.dataConfidence,
  };
}

async function buildResponse(): Promise<TacticalIdeasResponse> {
  const picksResp = await getStockPicks();
  const picks = picksResp.picks;
  const pickByTicker = new Map<string, StockPick>();
  for (const p of picks) pickByTicker.set(p.ticker, p);

  const ideas: TacticalIdea[] = picks
    .map((p) => buildTactical(p, buildLong(p)))
    .sort((a, b) => b.tacticalScore - a.tacticalScore);

  // Tactical options: reuse the proven modeled-fallback structures from the
  // strongest tactical setups, re-tagged with the setup + tactical horizon.
  const options: TacticalOption[] = [];
  for (const idea of ideas.slice(0, 24)) {
    const pick = pickByTicker.get(idea.ticker);
    if (!pick || idea.price == null) continue;
    const long = buildLong(pick);
    const lwv: LongWithVol = { ...long, ivProxyForOptions: ivProxyPct(pick) };
    for (const kind of structuresFor(long)) {
      const opt = buildOption(kind, lwv, pick);
      if (!opt) continue;
      options.push({
        ...opt,
        setupKind: idea.setupKind,
        setupLabel: idea.setupLabel,
        horizon: idea.horizon,
      });
    }
  }
  options.sort((a, b) => b.actionabilityScore - a.actionabilityScore);

  return {
    asOf: Date.now(),
    ideas,
    options,
    setups: SETUPS,
    universeSize: picks.length,
    optionsDataMode: "modeled-fallback",
    metricsStatus: {
      livePricing: picksResp.metricsStatus.livePricing,
      fundamentals: picksResp.metricsStatus.fundamentals,
      optionChain: false,
    },
    methodology: {
      tactical:
        "Each tactical setup is ranked by a transparent 0-100 score blending trailing momentum windows (1m/6m, rewarding constructive non-parabolic trend), remaining scenario base-case room, entry quality, scenario reward/risk and catalyst presence (weights 32/26/18/14/10%). The setup kind (momentum continuation, breakout watch, pullback, mean-reversion rebound, value dislocation) is derived from the same momentum + room thresholds. The expected upside is a model-implied RANGE that compresses scenario base/bull room into a tactical horizon — never a multi-year target and never a promise. Signal quality reflects how much data (momentum + scenario coverage) backed the read. No intraday technicals, no LLM, no price prediction.",
      options:
        "Tactical option structures reuse Trade Ideas' MODELED FALLBACK engine (no live option chain): premiums use an ATM proxy, strikes are placed off current price and the scenario targets, and ideas are ranked by a payoff-adjusted actionability score (not raw upside). They are re-tagged with the tactical setup and horizon. 2x/3x flags describe a modeled bull scenario, not a promise — options can expire worthless.",
    },
    disclaimer: DISCLAIMER,
  };
}

export async function getTacticalIdeas(): Promise<TacticalIdeasResponse> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.data;
  const data = await buildResponse();
  cached = { at: now, data };
  return data;
}
