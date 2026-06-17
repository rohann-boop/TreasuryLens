// Portfolio Lab v1 — model/paper portfolio construction.
//
// HONEST FRAMING: this module assembles a *model/paper portfolio* (research
// only) from the EXISTING conviction universe (getConvictionIdeas). It does NOT
// call an LLM, does NOT fabricate scores, places NO orders, and is NOT a
// brokerage or backtested portfolio. The user picks a source (themes / sections
// / manual tickers / full universe), a weighting style, and constraints; the
// engine selects candidates and computes target weights deterministically from
// the universe's curated model score, scenario model (upside / downside / risk)
// and trailing performance, then applies the constraint caps and a cash buffer.

import type {
  ConvictionIdea,
  ModelPortfolio,
  PortfolioConstraints,
  PortfolioHolding,
  PortfolioLabRequest,
  PortfolioLabResponse,
  PortfolioRiskExposure,
  PortfolioStyleId,
  PortfolioStyleInfo,
  PortfolioThemeExposure,
  PortfolioWarning,
  RiskLevel,
  ScenarioClassification,
} from "@shared/schema";
import { getConvictionIdeas } from "./convictionIdeas";

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

const round1 = (n: number) => Math.round(n * 10) / 10;

const RISK_ORDER: RiskLevel[] = [
  "low",
  "moderate",
  "elevated",
  "high",
  "very high",
];
const riskRank = (r: RiskLevel | null): number =>
  r == null ? -1 : RISK_ORDER.indexOf(r);
const isHighRisk = (r: RiskLevel | null): boolean =>
  r === "high" || r === "very high";

const DISCLAIMER =
  "Portfolio Lab builds a MODEL / PAPER portfolio for research only. It is not a brokerage, not trading, not personalized financial advice, and is not backtested as a portfolio. Holdings and weights are assembled deterministically from the curated universe (model score, scenario model, themes, risk level and trailing performance) under the style and constraints you set. No orders are placed. Investments can lose value.";

export const PORTFOLIO_STYLES: PortfolioStyleInfo[] = [
  {
    id: "equal-weight",
    name: "Equal weight",
    blurb:
      "Every holding gets the same target weight. The simplest, most diversified default.",
  },
  {
    id: "model-score-weighted",
    name: "Model-score weighted",
    blurb:
      "Sizes positions by the curated model score — the highest-conviction names carry more weight.",
  },
  {
    id: "risk-weighted",
    name: "Risk-weighted",
    blurb:
      "Inverse-risk sizing — lower-risk names get larger weights so risk is spread more evenly.",
  },
  {
    id: "core-satellite",
    name: "Core / satellite",
    blurb:
      "A lower-risk, high-score core (~70%) anchors the book; higher-upside satellites split the rest.",
  },
  {
    id: "high-upside",
    name: "High-upside / aggressive",
    blurb:
      "Tilts weight toward the widest scenario bull-case upside. Higher risk by design.",
  },
  {
    id: "risk-controlled",
    name: "Risk-controlled",
    blurb:
      "Tilts toward lower risk and a shallower scenario downside for a calmer paper book.",
  },
];

const STYLE_BY_ID = new Map(PORTFOLIO_STYLES.map((s) => [s.id, s]));

const DEFAULT_CONSTRAINTS: PortfolioConstraints = {
  maxHoldings: 12,
  maxPositionPct: 20,
  maxThemePct: 45,
  maxHighRiskPct: 35,
  minModelScore: 40,
  cashBufferPct: 5,
};

// Normalised candidate — the factor reads the styles size on. Pure data.
interface Candidate {
  ticker: string;
  companyName: string;
  themes: string[];
  sectionKey: string | null;
  sectionLabel: string | null;
  modelScore: number;
  classification: ScenarioClassification | null;
  riskLevel: RiskLevel | null;
  upsidePct: number | null;
  downsidePct: number | null;
  change6mPct: number | null;
  change12mPct: number | null;
}

// The conviction idea's risk level lives on its scenario seed but isn't echoed
// on the public scenarioModel. Infer it from the scenario classification — same
// transparent fallback Investment Groups uses.
function deriveRiskLevel(idea: ConvictionIdea): RiskLevel | null {
  const cls = idea.scenarioModel?.classification ?? null;
  switch (cls) {
    case "defensive":
      return "low";
    case "compounder":
      return "moderate";
    case "2x potential":
      return "elevated";
    case "3x potential":
      return "high";
    case "5x potential":
    case "speculative":
      return "very high";
    default:
      return null;
  }
}

function toCandidate(idea: ConvictionIdea): Candidate {
  const sm = idea.scenarioModel ?? null;
  const perf = idea.keyMetrics?.performance ?? null;
  return {
    ticker: idea.ticker,
    companyName: idea.companyName,
    themes: idea.themes ?? [],
    sectionKey: idea.sectionKey ?? null,
    sectionLabel: idea.sectionLabel ?? null,
    modelScore: idea.convictionScore ?? 0,
    classification: sm?.classification ?? null,
    riskLevel: deriveRiskLevel(idea),
    upsidePct: sm?.bullUpsidePct ?? null,
    downsidePct: sm?.bearDownsidePct ?? null,
    change6mPct: perf?.change6mPct ?? null,
    change12mPct: perf?.change12mPct ?? null,
  };
}

const lc = (s: string) => s.toLowerCase();

// Inverse-risk weight: low risk → larger. Unknown risk → neutral middle.
const inverseRiskWeight = (c: Candidate): number => {
  const r = riskRank(c.riskLevel);
  if (r < 0) return 0.5;
  // r 0..4 → weight 1.0..0.2
  return 1 - (r / (RISK_ORDER.length - 1)) * 0.8;
};

// Upside read from the scenario bull case, soft-capped at +400%.
const upsideWeight = (c: Candidate): number => {
  if (c.upsidePct == null) return 0.4;
  return clamp(c.upsidePct / 400, 0.05, 1);
};

// Shallower bear case → higher score (downsidePct is typically negative).
const downsideSafetyWeight = (c: Candidate): number => {
  if (c.downsidePct == null) return 0.5;
  return clamp(1 + c.downsidePct / 70, 0.05, 1);
};

// Per-style raw weight scorer (>0). Higher → larger target weight.
function rawWeight(style: PortfolioStyleId, c: Candidate): number {
  const score = clamp(c.modelScore, 0, 100) / 100;
  switch (style) {
    case "equal-weight":
      return 1;
    case "model-score-weighted":
      // Bias toward score but keep a floor so nothing collapses to ~0.
      return 0.25 + 0.75 * score;
    case "risk-weighted":
      return 0.1 + inverseRiskWeight(c);
    case "high-upside":
      return 0.1 + 0.7 * upsideWeight(c) + 0.2 * score;
    case "risk-controlled":
      return 0.1 + 0.5 * inverseRiskWeight(c) + 0.3 * downsideSafetyWeight(c) +
        0.2 * score;
    case "core-satellite":
      // Handled specially in buildWeights; fall back to score here.
      return 0.25 + 0.75 * score;
    default:
      return 1;
  }
}

// Selection ranking — which candidates make the cut (independent of weighting).
function selectionScore(style: PortfolioStyleId, c: Candidate): number {
  const score = clamp(c.modelScore, 0, 100) / 100;
  switch (style) {
    case "high-upside":
      return 0.6 * upsideWeight(c) + 0.4 * score;
    case "risk-controlled":
      return 0.5 * inverseRiskWeight(c) + 0.2 * downsideSafetyWeight(c) +
        0.3 * score;
    case "risk-weighted":
      return 0.4 * inverseRiskWeight(c) + 0.6 * score;
    default:
      return score;
  }
}

// Apply per-position cap, per-theme cap and high-risk cap by iterative capping
// + renormalisation. Returns final weights (summing to ~100) over the equity
// sleeve. Records which caps actually bound for the warnings panel.
function applyConstraints(
  weighted: { c: Candidate; raw: number }[],
  constraints: PortfolioConstraints,
  bound: Set<string>,
): Map<string, number> {
  const n = weighted.length;
  // Start from normalised raw weights (% of equity sleeve).
  const total = weighted.reduce((a, x) => a + x.raw, 0) || 1;
  const weights = new Map<string, number>(
    weighted.map((x) => [x.c.ticker, (x.raw / total) * 100]),
  );

  // A per-position cap below the equal share is infeasible; clamp the cap up so
  // weights can still sum to 100 (and note it).
  const minFeasibleCap = 100 / n;
  let posCap = constraints.maxPositionPct;
  if (posCap < minFeasibleCap) {
    posCap = minFeasibleCap;
    bound.add("position-infeasible");
  }

  const byTicker = new Map(weighted.map((x) => [x.c.ticker, x.c]));

  // Iteratively enforce caps. Each pass pins the violators at their cap and
  // redistributes the remainder proportionally across the unpinned names.
  for (let iter = 0; iter < 24; iter++) {
    let changed = false;
    const pinned = new Map<string, number>();

    // 1) Per-position cap.
    for (const [t, w] of Array.from(weights.entries())) {
      if (w > posCap + 1e-6) {
        pinned.set(t, posCap);
        bound.add("position");
        changed = true;
      }
    }

    // 2) Per-theme aggregate cap. If a theme's total exceeds the cap, scale all
    // of that theme's (unpinned) members down proportionally.
    const themeTotals = new Map<string, number>();
    for (const [t, w] of Array.from(weights.entries())) {
      const c = byTicker.get(t);
      if (!c) continue;
      for (const th of c.themes) {
        themeTotals.set(th, (themeTotals.get(th) ?? 0) + w);
      }
    }
    for (const [th, tot] of Array.from(themeTotals.entries())) {
      if (tot > constraints.maxThemePct + 1e-6) {
        const scale = constraints.maxThemePct / tot;
        for (const [t, w] of Array.from(weights.entries())) {
          const c = byTicker.get(t);
          if (c && c.themes.includes(th) && !pinned.has(t)) {
            weights.set(t, w * scale);
          }
        }
        bound.add("theme");
        changed = true;
      }
    }

    // 3) High-risk aggregate cap.
    let highRiskTot = 0;
    for (const [t, w] of Array.from(weights.entries())) {
      const c = byTicker.get(t);
      if (c && isHighRisk(c.riskLevel)) highRiskTot += w;
    }
    if (highRiskTot > constraints.maxHighRiskPct + 1e-6 && highRiskTot > 0) {
      const scale = constraints.maxHighRiskPct / highRiskTot;
      for (const [t, w] of Array.from(weights.entries())) {
        const c = byTicker.get(t);
        if (c && isHighRisk(c.riskLevel) && !pinned.has(t)) {
          weights.set(t, w * scale);
        }
      }
      bound.add("high-risk");
      changed = true;
    }

    // Apply pins, then renormalise the unpinned remainder to fill to 100.
    for (const [t, w] of Array.from(pinned.entries())) weights.set(t, w);
    const pinnedSum = Array.from(pinned.values()).reduce((a, b) => a + b, 0);
    const unpinned = Array.from(weights.entries()).filter(
      ([t]) => !pinned.has(t),
    );
    const unpinnedSum = unpinned.reduce((a, [, w]) => a + w, 0);
    const remainder = 100 - pinnedSum;
    if (unpinnedSum > 1e-6 && remainder >= 0) {
      const scale = remainder / unpinnedSum;
      for (const [t, w] of unpinned) weights.set(t, w * scale);
    }

    if (!changed) break;
  }

  return weights;
}

// Core/satellite splits the selected names into a lower-risk, higher-score core
// (~70% of the equity sleeve) and higher-upside satellites (~30%).
function buildCoreSatellite(
  selected: Candidate[],
): { weighted: { c: Candidate; raw: number }[]; roles: Map<string, "core" | "satellite"> } {
  const roles = new Map<string, "core" | "satellite">();
  const n = selected.length;
  // Core = the lower-risk / higher-score half (at least 1, at most n-1 when
  // there's room for a satellite).
  const ranked = [...selected].sort((a, b) => {
    const ra = riskRank(a.riskLevel);
    const rb = riskRank(b.riskLevel);
    const rva = ra < 0 ? 2 : ra; // unknown → middle
    const rvb = rb < 0 ? 2 : rb;
    if (rva !== rvb) return rva - rvb; // lower risk first
    return b.modelScore - a.modelScore; // then higher score
  });
  const coreCount = n <= 2 ? n : Math.max(1, Math.round(n * 0.5));
  const core = ranked.slice(0, coreCount);
  const satellites = ranked.slice(coreCount);
  for (const c of core) roles.set(c.ticker, "core");
  for (const c of satellites) roles.set(c.ticker, "satellite");

  const satPool = satellites.length > 0 ? 30 : 0;
  const corePool = satPool === 0 ? 100 : 70;

  const coreScoreTot =
    core.reduce((a, c) => a + (0.4 + (clamp(c.modelScore, 0, 100) / 100)), 0) || 1;
  const satUpsideTot =
    satellites.reduce((a, c) => a + (0.3 + upsideWeight(c)), 0) || 1;

  const weighted: { c: Candidate; raw: number }[] = [];
  for (const c of core) {
    const share = ((0.4 + clamp(c.modelScore, 0, 100) / 100) / coreScoreTot) * corePool;
    weighted.push({ c, raw: share });
  }
  for (const c of satellites) {
    const share = ((0.3 + upsideWeight(c)) / satUpsideTot) * satPool;
    weighted.push({ c, raw: share });
  }
  return { weighted, roles };
}

function weightedAvg(
  holdings: { weightPct: number; value: number | null }[],
): number | null {
  let wsum = 0;
  let vsum = 0;
  for (const h of holdings) {
    if (h.value == null) continue;
    wsum += h.weightPct;
    vsum += h.weightPct * h.value;
  }
  return wsum > 0 ? vsum / wsum : null;
}

export async function getPortfolioLab(
  req: PortfolioLabRequest,
): Promise<PortfolioLabResponse> {
  const universe = await getConvictionIdeas();
  const allCandidates = universe.ideas.map(toCandidate);

  // Build the source option lists from the live universe (so the UI doesn't
  // hardcode anything).
  const themeCounts = new Map<string, number>();
  for (const c of allCandidates) {
    for (const th of c.themes) themeCounts.set(th, (themeCounts.get(th) ?? 0) + 1);
  }
  const availableThemes = Array.from(themeCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const sectionMap = new Map<string, { label: string; count: number }>();
  for (const c of allCandidates) {
    if (!c.sectionKey) continue;
    const cur = sectionMap.get(c.sectionKey) ?? {
      label: c.sectionLabel ?? c.sectionKey,
      count: 0,
    };
    cur.count += 1;
    sectionMap.set(c.sectionKey, cur);
  }
  const availableSections = Array.from(sectionMap.entries())
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // Resolve style + constraints with clamps.
  const style = (req.styleId && STYLE_BY_ID.get(req.styleId)) ?? PORTFOLIO_STYLES[0];
  const c = req.constraints ?? {};
  const constraints: PortfolioConstraints = {
    maxHoldings: clamp(
      Math.round(c.maxHoldings ?? DEFAULT_CONSTRAINTS.maxHoldings),
      3,
      25,
    ),
    maxPositionPct: clamp(
      c.maxPositionPct ?? DEFAULT_CONSTRAINTS.maxPositionPct,
      5,
      100,
    ),
    maxThemePct: clamp(c.maxThemePct ?? DEFAULT_CONSTRAINTS.maxThemePct, 10, 100),
    maxHighRiskPct: clamp(
      c.maxHighRiskPct ?? DEFAULT_CONSTRAINTS.maxHighRiskPct,
      0,
      100,
    ),
    minModelScore: clamp(
      Math.round(c.minModelScore ?? DEFAULT_CONSTRAINTS.minModelScore),
      0,
      100,
    ),
    cashBufferPct: clamp(
      c.cashBufferPct ?? DEFAULT_CONSTRAINTS.cashBufferPct,
      0,
      50,
    ),
  };

  // Resolve the source pool.
  const src = req.source ?? {};
  const sourceKind = src.kind ?? "universe";
  const themes = (src.themes ?? []).map(lc);
  const sections = src.sections ?? [];
  const tickers = (src.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(
    Boolean,
  );

  let pool: Candidate[];
  switch (sourceKind) {
    case "themes":
      pool = allCandidates.filter((cand) =>
        cand.themes.some((th) => themes.includes(lc(th))),
      );
      break;
    case "sections":
      pool = allCandidates.filter(
        (cand) => cand.sectionKey != null && sections.includes(cand.sectionKey),
      );
      break;
    case "manual":
      pool = allCandidates.filter((cand) =>
        tickers.includes(cand.ticker.toUpperCase()),
      );
      break;
    default:
      pool = allCandidates;
  }

  const warnings: PortfolioWarning[] = [];

  // Manual tickers that didn't resolve to a universe name.
  if (sourceKind === "manual") {
    const have = new Set(pool.map((p) => p.ticker.toUpperCase()));
    const missing = tickers.filter((t) => !have.has(t));
    if (missing.length > 0) {
      warnings.push({
        level: "warn",
        message: `Not in the research universe and skipped: ${missing.join(", ")}. Portfolio Lab can only model names the app already tracks.`,
      });
    }
  }

  // Apply the model-score floor.
  const gated = pool.filter((cand) => cand.modelScore >= constraints.minModelScore);
  if (gated.length < pool.length) {
    warnings.push({
      level: "info",
      message: `${pool.length - gated.length} name(s) below the minimum model score (${constraints.minModelScore}) were excluded.`,
    });
  }

  // Rank + select up to maxHoldings.
  const ranked = [...gated].sort(
    (a, b) => selectionScore(style.id, b) - selectionScore(style.id, a),
  );
  const selected = ranked.slice(0, constraints.maxHoldings);

  const empty = selected.length === 0;
  if (empty) {
    const portfolio: ModelPortfolio = {
      styleId: style.id,
      styleName: style.name,
      name: `${style.name} model portfolio`,
      thesis:
        "No names cleared the current source and constraints. Loosen the source selection or lower the minimum model score to see a constructed model portfolio.",
      holdings: [],
      cashPct: constraints.cashBufferPct,
      themeExposure: [],
      riskExposure: [],
      avgModelScore: null,
      weightedUpsidePct: null,
      weightedDownsidePct: null,
      howItWasBuilt: [],
      warnings: [
        ...warnings,
        {
          level: "warn",
          message: `No eligible names. Source "${sourceKind}" produced ${pool.length} candidate(s); ${gated.length} cleared the model-score floor.`,
        },
      ],
      appliedSource: { kind: sourceKind, themes, sections, tickers },
      appliedConstraints: constraints,
      empty: true,
      emptyNote:
        "Empty portfolio — adjust the source or constraints and rebuild.",
    };
    return {
      asOf: Date.now(),
      styles: PORTFOLIO_STYLES,
      availableThemes,
      availableSections,
      universeSize: universe.ideas.length,
      portfolio,
      metricsStatus: {
        livePricing: universe.metricsStatus.livePricing,
        fundamentals: universe.metricsStatus.fundamentals,
      },
      disclaimer: DISCLAIMER,
    };
  }

  // Build raw weights per style.
  const bound = new Set<string>();
  let weighted: { c: Candidate; raw: number }[];
  let roles: Map<string, "core" | "satellite"> | null = null;
  if (style.id === "core-satellite") {
    const cs = buildCoreSatellite(selected);
    weighted = cs.weighted;
    roles = cs.roles;
  } else {
    weighted = selected.map((cand) => ({ c: cand, raw: rawWeight(style.id, cand) }));
  }

  // Capture pre-constraint (normalised) weights for transparency.
  const rawTotal = weighted.reduce((a, x) => a + x.raw, 0) || 1;
  const rawPctByTicker = new Map<string, number>(
    weighted.map((x) => [x.c.ticker, (x.raw / rawTotal) * 100]),
  );

  const finalWeights = applyConstraints(weighted, constraints, bound);

  const cashPct = constraints.cashBufferPct;
  const equityScale = (100 - cashPct) / 100;

  const holdings: PortfolioHolding[] = selected
    .map((cand) => {
      const w = (finalWeights.get(cand.ticker) ?? 0) * equityScale;
      const raw = (rawPctByTicker.get(cand.ticker) ?? 0) * equityScale;
      const role = roles?.get(cand.ticker) ?? "holding";
      return {
        ticker: cand.ticker,
        companyName: cand.companyName,
        weightPct: round1(w),
        rawWeightPct: round1(raw),
        modelScore: cand.modelScore,
        riskLevel: cand.riskLevel,
        scenarioClassification: cand.classification,
        upsidePct: cand.upsidePct,
        downsidePct: cand.downsidePct,
        change6mPct: cand.change6mPct,
        change12mPct: cand.change12mPct,
        themes: cand.themes,
        sectionLabel: cand.sectionLabel,
        role,
        note: holdingNote(style.id, cand, role),
      } satisfies PortfolioHolding;
    })
    .sort((a, b) => b.weightPct - a.weightPct);

  // Theme exposure (equity sleeve).
  const themeExpMap = new Map<string, { weight: number; count: number }>();
  for (const h of holdings) {
    for (const th of h.themes) {
      const cur = themeExpMap.get(th) ?? { weight: 0, count: 0 };
      cur.weight += h.weightPct;
      cur.count += 1;
      themeExpMap.set(th, cur);
    }
  }
  const themeExposure: PortfolioThemeExposure[] = Array.from(themeExpMap.entries())
    .map(([theme, v]) => ({
      theme,
      weightPct: round1(v.weight),
      holdings: v.count,
    }))
    .sort((a, b) => b.weightPct - a.weightPct);

  // Risk exposure (equity sleeve).
  const riskExpMap = new Map<RiskLevel | "unknown", { weight: number; count: number }>();
  for (const h of holdings) {
    const key: RiskLevel | "unknown" = h.riskLevel ?? "unknown";
    const cur = riskExpMap.get(key) ?? { weight: 0, count: 0 };
    cur.weight += h.weightPct;
    cur.count += 1;
    riskExpMap.set(key, cur);
  }
  const riskOrderIdx = (k: RiskLevel | "unknown") =>
    k === "unknown" ? 99 : RISK_ORDER.indexOf(k);
  const riskExposure: PortfolioRiskExposure[] = Array.from(riskExpMap.entries())
    .map(([riskLevel, v]) => ({
      riskLevel,
      weightPct: round1(v.weight),
      holdings: v.count,
    }))
    .sort((a, b) => riskOrderIdx(a.riskLevel) - riskOrderIdx(b.riskLevel));

  const avgModelScore =
    holdings.length === 0
      ? null
      : Math.round(
          holdings.reduce((a, h) => a + h.modelScore, 0) / holdings.length,
        );
  const weightedUpsidePct = weightedAvg(
    holdings.map((h) => ({ weightPct: h.weightPct, value: h.upsidePct })),
  );
  const weightedDownsidePct = weightedAvg(
    holdings.map((h) => ({ weightPct: h.weightPct, value: h.downsidePct })),
  );

  // Constraint-bound warnings.
  if (bound.has("position-infeasible")) {
    warnings.push({
      level: "warn",
      message: `Max position size (${constraints.maxPositionPct}%) was below the equal share for ${holdings.length} holdings and was relaxed so weights still sum to 100%.`,
    });
  }
  if (bound.has("position")) {
    warnings.push({
      level: "info",
      message: `The ${constraints.maxPositionPct}% max-position-size cap bound at least one holding; weight was redistributed across the others.`,
    });
  }
  if (bound.has("theme")) {
    warnings.push({
      level: "info",
      message: `The ${constraints.maxThemePct}% max-theme-exposure cap bound at least one theme; over-concentrated themes were scaled back.`,
    });
  }
  if (bound.has("high-risk")) {
    warnings.push({
      level: "info",
      message: `The ${constraints.maxHighRiskPct}% max-high-risk-exposure cap bound; high / very-high risk names were scaled back.`,
    });
  }
  if (holdings.length < constraints.maxHoldings) {
    warnings.push({
      level: "info",
      message: `Only ${holdings.length} eligible name(s) — fewer than the ${constraints.maxHoldings} max holdings. The model portfolio is more concentrated than the cap allows.`,
    });
  }

  const portfolio: ModelPortfolio = {
    styleId: style.id,
    styleName: style.name,
    name: `${style.name} model portfolio`,
    thesis: thesisFor(style.id, holdings.length, sourceKind),
    holdings,
    cashPct,
    themeExposure,
    riskExposure,
    avgModelScore,
    weightedUpsidePct: weightedUpsidePct == null ? null : round1(weightedUpsidePct),
    weightedDownsidePct:
      weightedDownsidePct == null ? null : round1(weightedDownsidePct),
    howItWasBuilt: howItWasBuilt(style.id, constraints, sourceKind),
    warnings,
    appliedSource: { kind: sourceKind, themes, sections, tickers },
    appliedConstraints: constraints,
    empty: false,
    emptyNote: null,
  };

  return {
    asOf: Date.now(),
    styles: PORTFOLIO_STYLES,
    availableThemes,
    availableSections,
    universeSize: universe.ideas.length,
    portfolio,
    metricsStatus: {
      livePricing: universe.metricsStatus.livePricing,
      fundamentals: universe.metricsStatus.fundamentals,
    },
    disclaimer: DISCLAIMER,
  };
}

function holdingNote(
  style: PortfolioStyleId,
  c: Candidate,
  role: "core" | "satellite" | "holding",
): string {
  const risk = c.riskLevel ?? "n/a";
  const up = c.upsidePct == null ? "n/a" : `+${Math.round(c.upsidePct)}%`;
  if (role === "core")
    return `Core sleeve — model score ${c.modelScore}/100, ${risk} risk. Anchors the book.`;
  if (role === "satellite")
    return `Satellite — bull upside ${up}, ${risk} risk. Sized smaller for optionality.`;
  switch (style) {
    case "model-score-weighted":
      return `Sized by model score ${c.modelScore}/100 (${risk} risk).`;
    case "risk-weighted":
      return `Inverse-risk sized — ${risk} risk, model score ${c.modelScore}/100.`;
    case "high-upside":
      return `Sized toward scenario upside ${up} (${risk} risk).`;
    case "risk-controlled":
      return `Lower-risk tilt — ${risk} risk, bull upside ${up}.`;
    default:
      return `Equal-weighted — model score ${c.modelScore}/100, ${risk} risk.`;
  }
}

function thesisFor(
  style: PortfolioStyleId,
  n: number,
  source: string,
): string {
  const base = `A ${n}-name model / paper portfolio built from the ${source === "universe" ? "full research universe" : `selected ${source}`}. Research only — no orders, not a brokerage.`;
  const tilt: Record<PortfolioStyleId, string> = {
    "equal-weight":
      " Every holding carries the same target weight for maximum diversification.",
    "model-score-weighted":
      " Positions are sized by the curated model score so the highest-conviction names dominate.",
    "risk-weighted":
      " Inverse-risk sizing spreads risk more evenly across the book.",
    "core-satellite":
      " A lower-risk, high-score core anchors the book while higher-upside satellites take the remainder.",
    "high-upside":
      " Weight tilts toward the widest scenario bull-case upside — aggressive by design.",
    "risk-controlled":
      " Weight tilts toward lower risk and a shallower scenario downside for a calmer book.",
  };
  return base + (tilt[style] ?? "");
}

function howItWasBuilt(
  style: PortfolioStyleId,
  constraints: PortfolioConstraints,
  source: string,
): string[] {
  const lines: string[] = [];
  lines.push(
    `Candidate pool: ${source === "universe" ? "the full conviction universe" : `names from the selected ${source}`}, gated to a minimum model score of ${constraints.minModelScore}.`,
  );
  const styleLine: Record<PortfolioStyleId, string> = {
    "equal-weight": "Each selected name receives an equal target weight.",
    "model-score-weighted":
      "Target weights scale with the curated model score (with a floor so no name collapses to zero).",
    "risk-weighted":
      "Target weights scale inversely with risk level so lower-risk names carry more.",
    "core-satellite":
      "Names split into a ~70% lower-risk / high-score core and ~30% higher-upside satellites.",
    "high-upside":
      "Target weights tilt toward the scenario bull-case upside, with model score as a secondary input.",
    "risk-controlled":
      "Target weights tilt toward lower risk and a shallower scenario downside.",
  };
  lines.push(styleLine[style] ?? "Target weights computed from the chosen style.");
  lines.push(
    `Constraints applied: max position ${constraints.maxPositionPct}%, max theme exposure ${constraints.maxThemePct}%, max high-risk exposure ${constraints.maxHighRiskPct}%, ${constraints.cashBufferPct}% cash buffer.`,
  );
  lines.push(
    "Weights are capped and renormalised so the equity sleeve sums to 100% net of cash. No backtest, no orders — this is a research model only.",
  );
  return lines;
}
