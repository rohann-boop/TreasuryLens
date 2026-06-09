// Investment Groups (Baskets) v1 — model-driven, explainable research baskets.
//
// HONEST FRAMING: this module assembles research watchlists deterministically
// from the EXISTING conviction universe (getConvictionIdeas). It does NOT call
// an LLM, does NOT fabricate scores, and does NOT backtest the baskets as
// portfolios. Each template is a transparent ranking rule over factors the
// universe already carries — curated conviction score, the scenario model
// (classification / bull-upside / bear-downside / risk level) and live trailing
// performance. Where a template borrows a Model Lab tilt, we attach the Model
// Lab technical-only backtest headline as a clearly-labelled sanity badge that
// validates the momentum/risk slice of the model, not the basket itself.

import type {
  ConvictionIdea,
  InvestmentGroup,
  InvestmentGroupMember,
  InvestmentGroupTemplateId,
  InvestmentGroupTemplateInfo,
  InvestmentGroupValidation,
  InvestmentGroupsRequest,
  InvestmentGroupsResponse,
  RiskLevel,
  ScenarioClassification,
} from "@shared/schema";
import { getConvictionIdeas } from "./convictionIdeas";
import { runModelLabBacktest } from "./modelLab";

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

// Risk levels in ascending order so a "max risk tolerance" control can compare.
const RISK_ORDER: RiskLevel[] = [
  "low",
  "moderate",
  "elevated",
  "high",
  "very high",
];
const riskRank = (r: RiskLevel | null): number =>
  r == null ? RISK_ORDER.length : RISK_ORDER.indexOf(r);

const DISCLAIMER =
  "Investment Groups are model-driven research baskets, not personalized financial advice, not a portfolio, and not a recommendation. They are assembled deterministically from the curated conviction universe (conviction score, scenario model, themes, risk level and trailing price performance). Validation badges come from a technical-only backtest of the momentum/risk slice of the model — they do NOT validate these baskets as portfolios. Investments can lose value.";

// A normalised view of one universe idea with the factor reads the templates
// rank on. Pure data — no I/O.
interface Candidate {
  ticker: string;
  companyName: string;
  themes: string[];
  sectionLabel: string | null;
  convictionScore: number;
  classification: ScenarioClassification | null;
  riskLevel: RiskLevel | null;
  upsidePct: number | null;
  downsidePct: number | null;
  change6mPct: number | null;
  change12mPct: number | null;
}

function toCandidate(idea: ConvictionIdea): Candidate {
  const sm = idea.scenarioModel ?? null;
  const perf = idea.keyMetrics?.performance ?? null;
  return {
    ticker: idea.ticker,
    companyName: idea.companyName,
    themes: idea.themes ?? [],
    sectionLabel: idea.sectionLabel ?? null,
    convictionScore: idea.convictionScore ?? 0,
    classification: sm?.classification ?? null,
    riskLevel: deriveRiskLevel(idea),
    upsidePct: sm?.bullUpsidePct ?? null,
    downsidePct: sm?.bearDownsidePct ?? null,
    change6mPct: perf?.change6mPct ?? null,
    change12mPct: perf?.change12mPct ?? null,
  };
}

// =============================================================================
// Templates. Each declares its thematic intent, a per-candidate fit scorer
// (0-100), a member rationale builder, and the Model Lab preset whose tilt it
// borrows for the validation badge. Risk preference is expressed as a soft tilt
// inside the scorer; the hard "max risk" control is applied separately.
// =============================================================================

type TemplateDef = {
  id: InvestmentGroupTemplateId;
  name: string;
  blurb: string;
  modelLens: string;
  presetId: string; // Model Lab preset id for the validation badge
  // Soft thematic match used for the "themeMatch" flag + a fit bonus.
  themeMatch: (c: Candidate) => boolean;
  // 0-100 fit score; higher ranks first. Candidates below ~1 are dropped.
  fit: (c: Candidate) => number;
  rationale: (c: Candidate) => string;
  whyTheseNames: string[];
  whatWouldChange: string[];
  riskProfile: string;
  upsideProfile: string | null;
};

const lc = (s: string) => s.toLowerCase();
const themeHas = (c: Candidate, needles: string[]): boolean => {
  const hay = [...c.themes.map(lc), lc(c.sectionLabel ?? "")];
  return needles.some((n) => hay.some((h) => h.includes(n)));
};

// Map a 0-100 conviction score to a 0-1 multiplier.
const convNorm = (c: Candidate) => clamp(c.convictionScore, 0, 100) / 100;

// Lower-risk preference: low=1 … very high=0.
const lowRiskPref = (c: Candidate): number => {
  const r = riskRank(c.riskLevel);
  if (r >= RISK_ORDER.length) return 0.5; // unknown → neutral
  return 1 - r / (RISK_ORDER.length - 1);
};

// Momentum read from trailing performance (6m weighted heavier than 12m). Maps
// to 0-1 via a soft cap at +/-60%.
const momentumNorm = (c: Candidate): number => {
  const m6 = c.change6mPct;
  const m12 = c.change12mPct;
  if (m6 == null && m12 == null) return 0.4; // unknown → slightly below neutral
  const blend =
    m6 != null && m12 != null
      ? 0.65 * m6 + 0.35 * m12
      : (m6 ?? m12 ?? 0);
  return clamp(0.5 + blend / 120, 0, 1);
};

// Upside read from the scenario bull case, soft-capped at +400%.
const upsideNorm = (c: Candidate): number => {
  if (c.upsidePct == null) return 0.4;
  return clamp(c.upsidePct / 400, 0, 1);
};

const TEMPLATES: TemplateDef[] = [
  {
    id: "core-compounders",
    name: "Core Compounders",
    blurb:
      "High conviction, durable compounders with a constructive trend and lower relative risk.",
    modelLens:
      "Ranks the universe on curated conviction score and a compounder/defensive scenario classification, tilted toward lower risk and a steady trend.",
    presetId: "risk-control",
    themeMatch: (c) =>
      c.classification === "compounder" || c.classification === "defensive",
    fit: (c) => {
      const compounderBonus =
        c.classification === "compounder"
          ? 1
          : c.classification === "defensive"
            ? 0.85
            : 0.4;
      const score =
        100 *
        (0.45 * convNorm(c) +
          0.25 * lowRiskPref(c) +
          0.15 * momentumNorm(c) +
          0.15 * compounderBonus);
      return score;
    },
    rationale: (c) =>
      `Conviction ${c.convictionScore}/100, ${c.classification ?? "n/a"} profile, ${c.riskLevel ?? "n/a"} risk — a durable-compounder candidate.`,
    whyTheseNames: [
      "Highest curated conviction scores with a compounder or defensive scenario classification.",
      "Risk-tilted: lower-risk names are preferred so the basket leans toward durability over upside.",
      "A constructive (non-negative) trend adds a small fit bonus; momentum is not the primary driver.",
    ],
    whatWouldChange: [
      "Raising the minimum conviction score tightens the basket to only the strongest-conviction names.",
      "Lowering the max risk tolerance drops the more volatile compounders.",
      "A name being re-classified away from compounder/defensive would lower its fit and could remove it.",
    ],
    riskProfile: "Lower relative risk",
    upsideProfile: "Compounder skew (~2x base over the model horizon)",
  },
  {
    id: "high-upside-speculative",
    name: "High-Upside Speculative",
    blurb:
      "Higher-risk names with the widest scenario upside — speculative optionality, sized small.",
    modelLens:
      "Ranks on the scenario bull-case upside and a 3x/5x/speculative classification; higher risk is explicitly allowed.",
    presetId: "momentum-tilt",
    themeMatch: (c) =>
      c.classification === "3x potential" ||
      c.classification === "5x potential" ||
      c.classification === "speculative",
    fit: (c) => {
      const upsideBonus =
        c.classification === "5x potential"
          ? 1
          : c.classification === "3x potential"
            ? 0.8
            : c.classification === "speculative"
              ? 0.7
              : 0.3;
      const score =
        100 *
        (0.45 * upsideNorm(c) +
          0.25 * upsideBonus +
          0.15 * momentumNorm(c) +
          0.15 * convNorm(c));
      return score;
    },
    rationale: (c) =>
      `Bull upside ${c.upsidePct == null ? "n/a" : `+${Math.round(c.upsidePct)}%`}, ${c.classification ?? "n/a"} — speculative optionality at ${c.riskLevel ?? "n/a"} risk.`,
    whyTheseNames: [
      "Widest scenario bull-case upside, with a 3x/5x or speculative classification.",
      "Higher risk is allowed by design — this basket trades durability for asymmetric optionality.",
      "Conviction score is a tiebreaker, not the main driver, so high-variance names can still rank.",
    ],
    whatWouldChange: [
      "Tightening the max risk tolerance removes the most speculative names and shrinks the basket.",
      "A higher minimum conviction score filters out the lowest-conviction lottery tickets.",
      "A name's bull case being revised down would drop its fit score.",
    ],
    riskProfile: "Higher risk by design",
    upsideProfile: "Asymmetric — 3x/5x bull skew on success",
  },
  {
    id: "ai-infrastructure",
    name: "AI Infrastructure",
    blurb:
      "Compute, silicon, networking and data names powering the AI build-out, ranked by conviction and trend.",
    modelLens:
      "Filters to AI-infrastructure themes (compute / semis / networking / data / cloud) from the universe metadata, then ranks on conviction and momentum.",
    presetId: "growth-tilt",
    themeMatch: (c) =>
      themeHas(c, [
        "ai infrastructure",
        "ai infra",
        "semiconductor",
        "silicon",
        "xpu",
        "gpu",
        "networking",
        "compute",
        "data center",
        "datacenter",
        "cloud",
        "ai software",
        "ai hardware",
        "data",
      ]),
    fit: (c) => {
      const base =
        100 *
        (0.5 * convNorm(c) + 0.3 * momentumNorm(c) + 0.2 * upsideNorm(c));
      return base;
    },
    rationale: (c) =>
      `AI-infrastructure theme (${c.themes.slice(0, 2).join(", ") || "thematic"}); conviction ${c.convictionScore}/100, ${c.riskLevel ?? "n/a"} risk.`,
    whyTheseNames: [
      "Selected by AI-infrastructure theme tags (compute, semis, networking, data, cloud) already on each name.",
      "Within the theme, names are ranked by curated conviction and trailing trend.",
      "Scenario upside breaks ties so the higher-optionality infra names rank ahead of equally-rated peers.",
    ],
    whatWouldChange: [
      "A name losing its AI-infrastructure theme tags would drop out of the universe filter.",
      "Raising the minimum conviction score concentrates the basket on the highest-conviction infra names.",
      "Lowering max risk removes the more speculative infra plays.",
    ],
    riskProfile: "Mixed (theme-driven)",
    upsideProfile: "Growth-tilted",
  },
  {
    id: "energy-power",
    name: "Energy & Power",
    blurb:
      "Generation, grid, nuclear/uranium and power names levered to AI-driven electricity demand.",
    modelLens:
      "Filters to energy/power themes (power, grid, nuclear, uranium, utilities, IPP) from the universe, then ranks on conviction and risk-adjusted trend.",
    presetId: "default",
    themeMatch: (c) =>
      themeHas(c, [
        "power",
        "grid",
        "nuclear",
        "uranium",
        "utilit",
        "energy",
        "independent power",
        "ipp",
        "generation",
      ]),
    fit: (c) => {
      const base =
        100 *
        (0.45 * convNorm(c) +
          0.25 * momentumNorm(c) +
          0.15 * lowRiskPref(c) +
          0.15 * upsideNorm(c));
      return base;
    },
    rationale: (c) =>
      `Energy/power theme (${c.themes.slice(0, 2).join(", ") || "thematic"}); conviction ${c.convictionScore}/100, ${c.riskLevel ?? "n/a"} risk.`,
    whyTheseNames: [
      "Selected by energy/power theme tags (power, grid, nuclear, uranium, utilities, IPP) on each name.",
      "Ranked by conviction with a trend read and a mild lower-risk tilt for the regulated/utility names.",
      "Scenario upside breaks ties so the higher-beta power names can still surface.",
    ],
    whatWouldChange: [
      "A name losing its energy/power theme tags would drop out of the universe filter.",
      "Raising the minimum conviction score tightens the basket.",
      "Lowering max risk removes the most volatile uranium/IPP names.",
    ],
    riskProfile: "Mixed (theme-driven)",
    upsideProfile: "Power-demand levered",
  },
  {
    id: "risk-controlled",
    name: "Risk-Controlled Watchlist",
    blurb:
      "Positive-conviction names with the lowest relative risk and downside — a calmer research book.",
    modelLens:
      "Ranks on lower risk level and a shallower scenario downside, gated to names with a constructive conviction score.",
    presetId: "risk-control",
    themeMatch: (c) =>
      c.riskLevel === "low" || c.riskLevel === "moderate",
    fit: (c) => {
      // Downside read: shallower bear case → higher score (downsidePct is
      // typically negative). Soft-cap at -70%.
      const downside =
        c.downsidePct == null
          ? 0.5
          : clamp(1 + c.downsidePct / 70, 0, 1);
      const score =
        100 *
        (0.4 * lowRiskPref(c) +
          0.3 * downside +
          0.3 * convNorm(c));
      return score;
    },
    rationale: (c) =>
      `${c.riskLevel ?? "n/a"} risk, bear case ${c.downsidePct == null ? "n/a" : `${Math.round(c.downsidePct)}%`}, conviction ${c.convictionScore}/100 — a lower-volatility candidate.`,
    whyTheseNames: [
      "Lowest relative risk levels are preferred, with a shallower scenario bear-case downside.",
      "A constructive curated conviction score keeps the basket to names with a real thesis.",
      "Momentum is intentionally not a driver here — the goal is a calmer book, not the hottest trend.",
    ],
    whatWouldChange: [
      "Lowering the max risk tolerance tightens the basket to only the calmest names.",
      "A name's scenario downside deepening would lower its fit and could remove it.",
      "Raising the minimum conviction score filters out lower-conviction defensives.",
    ],
    riskProfile: "Lowest relative risk",
    upsideProfile: "Capital-preservation tilt",
  },
  {
    id: "momentum-breakouts",
    name: "Momentum Breakouts",
    blurb:
      "Names with the strongest trailing trend — momentum/breakout-oriented, ranked on price performance.",
    modelLens:
      "Ranks on trailing 6m/12m price performance (momentum), with conviction as a quality gate.",
    presetId: "momentum-tilt",
    themeMatch: (c) => (c.change6mPct ?? 0) > 0 || (c.change12mPct ?? 0) > 0,
    fit: (c) => {
      const score =
        100 * (0.7 * momentumNorm(c) + 0.2 * convNorm(c) + 0.1 * upsideNorm(c));
      return score;
    },
    rationale: (c) =>
      `Trend 6m ${c.change6mPct == null ? "n/a" : `${c.change6mPct >= 0 ? "+" : ""}${Math.round(c.change6mPct)}%`} / 12m ${c.change12mPct == null ? "n/a" : `${c.change12mPct >= 0 ? "+" : ""}${Math.round(c.change12mPct)}%`} — momentum candidate.`,
    whyTheseNames: [
      "Ranked primarily on trailing 6m/12m price performance — the strongest trends rank first.",
      "Curated conviction acts as a light quality gate so the basket isn't pure chart-chasing.",
      "Names without price history fall toward the bottom and are usually filtered out.",
    ],
    whatWouldChange: [
      "A name's trend rolling over (negative 6m/12m) would drop it down or out of the basket.",
      "Raising the minimum conviction score removes lower-quality momentum names.",
      "Fresh price history arriving for an unscored name could pull it into the basket.",
    ],
    riskProfile: "Trend-dependent",
    upsideProfile: "Momentum-driven",
  },
];

const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

const TEMPLATE_INFOS: InvestmentGroupTemplateInfo[] = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  blurb: t.blurb,
  modelLens: t.modelLens,
  presetId: t.presetId,
}));

// Cache the per-preset Model Lab validation headline (technical-only). Cheap to
// reuse across templates that share a preset and across requests. 30-min TTL.
const VALIDATION_TTL_MS = 30 * 60 * 1000;
const validationCache = new Map<
  string,
  { at: number; data: InvestmentGroupValidation | null }
>();

async function getValidation(
  presetId: string,
): Promise<InvestmentGroupValidation | null> {
  const now = Date.now();
  const hit = validationCache.get(presetId);
  if (hit && now - hit.at < VALIDATION_TTL_MS) return hit.data;
  let data: InvestmentGroupValidation | null = null;
  try {
    const run = await runModelLabBacktest({ presetId });
    const h = run.result.headline;
    data = {
      presetId,
      presetLabel: run.result.strategyLabel,
      windowKey: h?.windowKey ?? null,
      verdict: h?.verdict ?? "insufficient",
      selectedAvgReturnPct: h?.selectedAvgReturnPct ?? null,
      excessVsBenchmarkPct: h?.excessVsBenchmarkPct ?? null,
      hitRatePct: h?.hitRatePct ?? null,
      badge: run.validationBadge,
      note: `Technical-only backtest of the ${run.result.strategyLabel} tilt (momentum/risk slice). Validates the model lens, not this basket as a portfolio.`,
    };
  } catch {
    data = null;
  }
  validationCache.set(presetId, { at: now, data });
  return data;
}

function riskProfileLabel(members: Candidate[]): string {
  const ranks = members
    .map((m) => riskRank(m.riskLevel))
    .filter((r) => r < RISK_ORDER.length);
  if (ranks.length === 0) return "Risk unavailable";
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  if (avg <= 1) return "Lower risk";
  if (avg <= 2.2) return "Moderate risk";
  return "Higher risk";
}

function upsideProfileLabel(members: Candidate[]): string | null {
  const ups = members
    .map((m) => m.upsidePct)
    .filter((u): u is number => u != null);
  if (ups.length === 0) return null;
  const avg = ups.reduce((a, b) => a + b, 0) / ups.length;
  return `Avg bull-case upside ~+${Math.round(avg)}% over the model horizon`;
}

export async function getInvestmentGroups(
  req: InvestmentGroupsRequest,
): Promise<InvestmentGroupsResponse> {
  const universe = await getConvictionIdeas();

  const template =
    (req.templateId && TEMPLATE_BY_ID.get(req.templateId)) ?? TEMPLATES[0];

  const minConvictionScore = clamp(
    Math.round(req.minConvictionScore ?? 40),
    0,
    100,
  );
  const maxHoldings = clamp(Math.round(req.maxHoldings ?? 8), 1, 25);
  const maxRiskLevel: RiskLevel = req.maxRiskLevel ?? "high";
  const maxRiskRank = riskRank(maxRiskLevel);

  const candidates: Candidate[] = universe.ideas.map(toCandidate);

  // Filter: thematic templates require a theme match; all templates apply the
  // conviction floor and the max-risk gate (unknown risk passes the gate).
  const thematic =
    template.id === "ai-infrastructure" || template.id === "energy-power";

  const filtered = candidates.filter((c) => {
    if (c.convictionScore < minConvictionScore) return false;
    const rr = riskRank(c.riskLevel);
    if (rr < RISK_ORDER.length && rr > maxRiskRank) return false;
    if (thematic && !template.themeMatch(c)) return false;
    return true;
  });

  const ranked = filtered
    .map((c) => ({ c, fit: template.fit(c) }))
    .filter((x) => x.fit > 1)
    .sort((a, b) => b.fit - a.fit);

  const selected = ranked.slice(0, maxHoldings);

  const members: InvestmentGroupMember[] = selected.map(({ c, fit }) => ({
    ticker: c.ticker,
    companyName: c.companyName,
    rationale: template.rationale(c),
    fitScore: Math.round(fit),
    themes: c.themes,
    sectionLabel: c.sectionLabel,
    factors: {
      convictionScore: c.convictionScore,
      scenarioClassification: c.classification,
      riskLevel: c.riskLevel,
      upsidePct: c.upsidePct,
      downsidePct: c.downsidePct,
      change6mPct: c.change6mPct,
      change12mPct: c.change12mPct,
      themeMatch: template.themeMatch(c),
    },
  }));

  const selectedCandidates = selected.map((s) => s.c);
  const avgConvictionScore =
    selectedCandidates.length === 0
      ? null
      : Math.round(
          selectedCandidates.reduce((a, c) => a + c.convictionScore, 0) /
            selectedCandidates.length,
        );

  const validation = await getValidation(template.presetId);

  const empty = members.length === 0;
  const emptyNote = empty
    ? `No names in the current universe cleared the filters (min conviction ${minConvictionScore}, max risk "${maxRiskLevel}"${thematic ? `, ${template.name} theme` : ""}). Loosen the controls to see candidates.`
    : null;

  const thesisByTemplate: Record<InvestmentGroupTemplateId, string> = {
    "core-compounders":
      "A research basket of the highest-conviction, durable compounders with a constructive trend and lower relative risk — the kind of names a researcher might treat as long-term anchors.",
    "high-upside-speculative":
      "A research basket of higher-risk names with the widest scenario upside, where the goal is asymmetric optionality. These are speculative by design and would be sized small.",
    "ai-infrastructure":
      "A thematic research basket of names powering the AI build-out — compute, silicon, networking, data and cloud — ranked by conviction and trend.",
    "energy-power":
      "A thematic research basket levered to AI-driven electricity demand — generation, grid, nuclear/uranium, utilities and independent power producers.",
    "risk-controlled":
      "A calmer research book: positive-conviction names with the lowest relative risk and shallowest scenario downside, prioritising capital preservation over upside.",
    "momentum-breakouts":
      "A trend-following research basket ranked on trailing 6m/12m price performance, with conviction acting as a light quality gate so it isn't pure chart-chasing.",
  };

  const group: InvestmentGroup = {
    templateId: template.id,
    name: template.name,
    thesis: thesisByTemplate[template.id],
    modelLens: template.modelLens,
    members,
    whyTheseNames: template.whyTheseNames,
    whatWouldChange: template.whatWouldChange,
    avgConvictionScore,
    riskProfile: empty ? template.riskProfile : riskProfileLabel(selectedCandidates),
    upsideProfile: empty
      ? template.upsideProfile
      : upsideProfileLabel(selectedCandidates) ?? template.upsideProfile,
    appliedControls: { minConvictionScore, maxRiskLevel, maxHoldings },
    validation,
    empty,
    emptyNote,
  };

  return {
    asOf: Date.now(),
    templates: TEMPLATE_INFOS,
    group,
    universeSize: universe.ideas.length,
    metricsStatus: {
      livePricing: universe.metricsStatus.livePricing,
      fundamentals: universe.metricsStatus.fundamentals,
    },
    disclaimer: DISCLAIMER,
  };
}

// The conviction idea's risk level lives on its scenario seed but isn't echoed
// on the public scenarioModel. We infer it from the scenario classification as
// a transparent fallback so the filters/labels have something honest to use.
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
