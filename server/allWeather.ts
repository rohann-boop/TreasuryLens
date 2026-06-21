// All-Weather Portfolios — curated multi-asset portfolio TEMPLATES inside
// Portfolio Lab. Unlike the equity basket builder (getPortfolioLab), these
// allocate across asset SLEEVES — equities, AI/growth, gold, bitcoin, bonds,
// cash, commodities, real assets — using a small, transparent starter set of
// broad proxy ETFs/assets.
//
// HONEST FRAMING: allocations are CURATED model templates for research /
// education only. They are NOT optimised, NOT backtested, NOT personalized
// financial advice, and place NO orders. A risk-profile dial (defensive /
// balanced / growth) tilts a template deterministically: it scales the
// "defensive" sleeves (bonds, cash, gold) against the "growth" sleeves
// (equities, AI/growth, bitcoin) and renormalises to 100%. Regime expectations
// are qualitative author judgements, not forecasts.

import type {
  AllWeatherHolding,
  AllWeatherRegimeNote,
  AllWeatherResolved,
  AllWeatherResponse,
  AllWeatherRisk,
  AllWeatherSleeve,
  AllWeatherSleeveInfo,
  AllWeatherTemplate,
} from "@shared/schema";

const DISCLAIMER =
  "All-Weather Portfolios are CURATED, research-only model templates that allocate across asset sleeves using broad proxy ETFs/assets. They are not optimised, not backtested, not personalized financial advice, and place no orders. The risk dial tilts the template deterministically between defensive and growth sleeves. Regime expectations are qualitative author judgements, not forecasts. Diversification does not guarantee a profit or protect against loss. Crypto and commodity sleeves are volatile; verify every proxy and weight before acting.";

export const ALL_WEATHER_SLEEVES: AllWeatherSleeveInfo[] = [
  {
    key: "equities",
    label: "Equities",
    role: "Broad US/global stock exposure — the long-run growth engine.",
  },
  {
    key: "ai-growth",
    label: "AI / Growth",
    role: "Higher-beta growth & AI tilt — extra upside, extra drawdown.",
  },
  {
    key: "gold",
    label: "Gold / Precious metals",
    role: "Real-asset store of value — hedges inflation and dollar weakness.",
  },
  {
    key: "bitcoin",
    label: "Bitcoin / Crypto",
    role: "Asymmetric, uncorrelated-ish hedge & growth sleeve — high volatility.",
  },
  {
    key: "bonds",
    label: "Bonds / Treasuries",
    role: "Duration ballast — cushions growth shocks when rates fall.",
  },
  {
    key: "cash",
    label: "Cash / T-bills",
    role: "Dry powder & stability — yields short rates with minimal risk.",
  },
  {
    key: "commodities",
    label: "Commodities / Energy",
    role: "Real-asset & energy exposure — inflation and supply-shock hedge.",
  },
  {
    key: "real-assets",
    label: "Real assets",
    role: "Real estate / infrastructure — income and inflation pass-through.",
  },
];

// Broad proxy instruments per sleeve. Deliberately minimal and transparent —
// widely-held, liquid proxies. These are research proxies, not recommendations.
const PROXIES: Record<
  AllWeatherSleeve,
  { ticker: string; name: string; role: string }
> = {
  equities: { ticker: "VTI", name: "Total US stock market", role: "Core equity beta" },
  "ai-growth": { ticker: "QQQ", name: "Nasdaq-100 (growth/AI tilt)", role: "Growth & AI tilt" },
  gold: { ticker: "GLD", name: "Gold bullion", role: "Inflation / dollar hedge" },
  bitcoin: { ticker: "BTC", name: "Bitcoin", role: "Asymmetric crypto hedge" },
  bonds: { ticker: "TLT", name: "Long US Treasuries", role: "Duration ballast" },
  cash: { ticker: "BIL", name: "1-3 month T-bills", role: "Cash / dry powder" },
  commodities: { ticker: "DBC", name: "Broad commodities", role: "Commodity / energy hedge" },
  "real-assets": { ticker: "VNQ", name: "US real estate (REITs)", role: "Real-asset income" },
};

const SLEEVE_LABEL: Record<AllWeatherSleeve, string> = Object.fromEntries(
  ALL_WEATHER_SLEEVES.map((s) => [s.key, s.label]),
) as Record<AllWeatherSleeve, string>;

const SLEEVE_ROLE: Record<AllWeatherSleeve, string> = Object.fromEntries(
  ALL_WEATHER_SLEEVES.map((s) => [s.key, s.role]),
) as Record<AllWeatherSleeve, string>;

type SleeveWeights = Partial<Record<AllWeatherSleeve, number>>;

function regime(
  r: AllWeatherRegimeNote["regime"],
  expectation: AllWeatherRegimeNote["expectation"],
  note: string,
): AllWeatherRegimeNote {
  const label: Record<AllWeatherRegimeNote["regime"], string> = {
    "inflation-rising": "Inflation rising",
    "rates-falling": "Rates falling",
    "growth-accelerating": "Growth accelerating",
    "recession-risk-off": "Recession / risk-off",
    "dollar-weakness": "Dollar weakness",
    "bitcoin-bull": "Bitcoin bull cycle",
    "ai-boom": "AI boom",
  };
  return { regime: r, label: label[r], expectation, note };
}

// Build a template from a sleeve-weight map. Holdings inherit the sleeve weight
// (one proxy per sleeve in V1).
function template(
  id: string,
  name: string,
  blurb: string,
  baseRisk: AllWeatherRisk,
  rebalanceCadence: string,
  weights: SleeveWeights,
  keyRisks: string[],
  regimeNotes: AllWeatherRegimeNote[],
): AllWeatherTemplate {
  const entries = (Object.entries(weights) as [AllWeatherSleeve, number][])
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);
  const baseSleeveWeights = entries.map(([sleeve, weightPct]) => ({
    sleeve,
    weightPct,
  }));
  const holdings: AllWeatherHolding[] = entries.map(([sleeve, weightPct]) => {
    const p = PROXIES[sleeve];
    return {
      ticker: p.ticker,
      name: p.name,
      sleeve,
      weightPct,
      role: p.role,
    };
  });
  return {
    id,
    name,
    blurb,
    baseRisk,
    rebalanceCadence,
    baseSleeveWeights,
    holdings,
    keyRisks,
    regimeNotes,
  };
}

export const ALL_WEATHER_TEMPLATES: AllWeatherTemplate[] = [
  template(
    "all-weather-conservative",
    "All Weather Conservative",
    "A Ray-Dalio-inspired balanced sleeve mix biased toward ballast — designed to stay calm across regimes rather than maximise return.",
    "defensive",
    "Quarterly, or on a >5% sleeve drift",
    {
      equities: 30,
      bonds: 35,
      gold: 12,
      commodities: 8,
      cash: 10,
      bitcoin: 5,
    },
    [
      "Long-duration bonds can fall sharply if rates rise (2022-style).",
      "Low equity weight lags badly in a strong bull market.",
      "Even small crypto exposure adds volatility.",
    ],
    [
      regime("inflation-rising", "ok", "Gold + commodities cushion; long bonds are a headwind."),
      regime("rates-falling", "strong", "Long-duration bonds rally; balanced mix benefits."),
      regime("growth-accelerating", "headwind", "Underweight equities lags the upside."),
      regime("recession-risk-off", "strong", "Bonds + cash + gold dominate; designed for this."),
      regime("dollar-weakness", "ok", "Gold and commodities help offset."),
      regime("bitcoin-bull", "neutral", "Only a 5% sleeve participates."),
      regime("ai-boom", "headwind", "No dedicated growth tilt."),
    ],
  ),
  template(
    "all-weather-growth",
    "All Weather Growth",
    "A diversified all-weather core with a deliberate growth tilt — keeps real-asset and ballast hedges but leans into equities, AI and bitcoin.",
    "growth",
    "Quarterly, or on a >5% sleeve drift",
    {
      equities: 35,
      "ai-growth": 20,
      bitcoin: 12,
      gold: 10,
      bonds: 13,
      commodities: 5,
      cash: 5,
    },
    [
      "Higher equity + AI + crypto weight means deeper drawdowns in risk-off.",
      "Concentrated in growth factors that can de-rate together.",
      "Bitcoin sleeve is highly volatile.",
    ],
    [
      regime("inflation-rising", "ok", "Gold/commodities help; long growth multiples can compress."),
      regime("rates-falling", "strong", "Growth + AI + bonds all benefit."),
      regime("growth-accelerating", "strong", "Equity and AI tilt lead."),
      regime("recession-risk-off", "weak", "Growth-heavy sleeves draw down hardest."),
      regime("dollar-weakness", "ok", "Gold + crypto + global equity help."),
      regime("bitcoin-bull", "strong", "12% sleeve participates meaningfully."),
      regime("ai-boom", "strong", "Dedicated AI/growth tilt leads."),
    ],
  ),
  template(
    "inflation-hedge",
    "Inflation Hedge",
    "Tilts hard toward real assets — gold, commodities/energy and real estate — with a modest equity core and minimal duration.",
    "balanced",
    "Quarterly, or on a >5% sleeve drift",
    {
      gold: 25,
      commodities: 22,
      "real-assets": 15,
      equities: 20,
      bitcoin: 8,
      cash: 10,
    },
    [
      "Real assets can lag sharply when inflation cools.",
      "Commodities are cyclical and volatile.",
      "Minimal bond ballast means less cushion in a growth shock.",
    ],
    [
      regime("inflation-rising", "strong", "Built for this — gold, commodities, real estate lead."),
      regime("rates-falling", "ok", "Real assets fine; little duration to benefit."),
      regime("growth-accelerating", "ok", "Commodities + equities participate."),
      regime("recession-risk-off", "headwind", "Cyclical commodities can fall with demand."),
      regime("dollar-weakness", "strong", "Gold + commodities are classic dollar hedges."),
      regime("bitcoin-bull", "ok", "8% sleeve participates."),
      regime("ai-boom", "headwind", "No dedicated growth/AI tilt."),
    ],
  ),
  template(
    "ai-growth-hedges",
    "AI Growth + Hedges",
    "An aggressive AI/growth core paired with explicit hedges — gold and bitcoin for tail protection, a slug of cash as dry powder.",
    "growth",
    "Monthly review; rebalance on a >5% sleeve drift",
    {
      "ai-growth": 38,
      equities: 22,
      bitcoin: 14,
      gold: 12,
      cash: 9,
      bonds: 5,
    },
    [
      "Very high concentration in growth/AI — large drawdowns likely in a de-rating.",
      "Crypto + AI can sell off together in a liquidity crunch.",
      "Hedges are sized to soften, not eliminate, drawdowns.",
    ],
    [
      regime("inflation-rising", "headwind", "Growth multiples compress; gold helps a little."),
      regime("rates-falling", "strong", "Long-duration growth and AI lead."),
      regime("growth-accelerating", "strong", "Core thesis — AI/growth out front."),
      regime("recession-risk-off", "weak", "Growth-heavy book draws down hardest despite hedges."),
      regime("dollar-weakness", "ok", "Gold + bitcoin offset some."),
      regime("bitcoin-bull", "strong", "14% sleeve participates strongly."),
      regime("ai-boom", "strong", "Designed to lead an AI boom."),
    ],
  ),
  template(
    "risk-off-defense",
    "Risk-Off Defense",
    "A capital-preservation stance for risk-off regimes — heavy cash and bonds, gold for tail-hedging, a small equity stub to stay invested.",
    "defensive",
    "Quarterly, or when the risk regime shifts",
    {
      cash: 30,
      bonds: 30,
      gold: 18,
      equities: 15,
      bitcoin: 4,
      commodities: 3,
    },
    [
      "Designed to lag in bull markets — large opportunity cost if risk-on resumes.",
      "Long bonds still carry rate risk if inflation re-accelerates.",
      "Cash yields fall when the Fed cuts.",
    ],
    [
      regime("inflation-rising", "headwind", "Cash/bonds lose real value; gold helps partly."),
      regime("rates-falling", "strong", "Bonds rally; defensive mix shines."),
      regime("growth-accelerating", "weak", "Heavily underweight the upside."),
      regime("recession-risk-off", "strong", "Built for this — cash, bonds, gold dominate."),
      regime("dollar-weakness", "ok", "Gold offsets some cash drag."),
      regime("bitcoin-bull", "neutral", "Only a 4% sleeve."),
      regime("ai-boom", "weak", "No growth tilt; lags badly."),
    ],
  ),
];

const TEMPLATE_BY_ID = new Map(ALL_WEATHER_TEMPLATES.map((t) => [t.id, t]));

// Which sleeves are "growth" vs "defensive" for the risk-dial tilt.
const GROWTH_SLEEVES: AllWeatherSleeve[] = ["equities", "ai-growth", "bitcoin"];
const DEFENSIVE_SLEEVES: AllWeatherSleeve[] = ["bonds", "cash", "gold"];

const round1 = (n: number) => Math.round(n * 10) / 10;

// Deterministically tilt a template's base weights toward defense or growth.
// "balanced" returns the authored weights; "defensive"/"growth" scale the two
// sleeve groups by a fixed factor and renormalise to 100%.
export function resolveTemplate(
  templateId: string,
  risk: AllWeatherRisk,
): AllWeatherResolved | null {
  const t = TEMPLATE_BY_ID.get(templateId);
  if (!t) return null;

  const factor = (sleeve: AllWeatherSleeve): number => {
    if (risk === "balanced") return 1;
    if (risk === "growth") {
      if (GROWTH_SLEEVES.includes(sleeve)) return 1.3;
      if (DEFENSIVE_SLEEVES.includes(sleeve)) return 0.7;
      return 1;
    }
    // defensive
    if (DEFENSIVE_SLEEVES.includes(sleeve)) return 1.3;
    if (GROWTH_SLEEVES.includes(sleeve)) return 0.7;
    return 1;
  };

  const tilted = t.baseSleeveWeights.map((s) => ({
    sleeve: s.sleeve,
    raw: s.weightPct * factor(s.sleeve),
  }));
  const total = tilted.reduce((a, x) => a + x.raw, 0) || 1;
  const sleeves = tilted
    .map((x) => ({
      sleeve: x.sleeve,
      label: SLEEVE_LABEL[x.sleeve],
      role: SLEEVE_ROLE[x.sleeve],
      weightPct: round1((x.raw / total) * 100),
    }))
    .sort((a, b) => b.weightPct - a.weightPct);

  const weightBySleeve = new Map(sleeves.map((s) => [s.sleeve, s.weightPct]));
  const holdings: AllWeatherHolding[] = t.holdings
    .map((h) => ({ ...h, weightPct: weightBySleeve.get(h.sleeve) ?? h.weightPct }))
    .sort((a, b) => b.weightPct - a.weightPct);

  const howItWorks = [
    `Base template authored at a "${t.baseRisk}" risk profile; you are viewing the "${risk}" tilt.`,
    risk === "balanced"
      ? "Balanced shows the authored sleeve weights unchanged."
      : `The "${risk}" dial scales ${risk === "growth" ? "growth sleeves up and defensive sleeves down" : "defensive sleeves up and growth sleeves down"} by a fixed factor, then renormalises every sleeve to sum to 100%.`,
    "One broad proxy instrument represents each sleeve in V1 — swap in your preferred ETF/asset for the same role.",
    `Rebalance cadence: ${t.rebalanceCadence}. Research only — no orders are placed.`,
  ];

  return {
    templateId: t.id,
    name: t.name,
    risk,
    sleeves,
    holdings,
    rebalanceCadence: t.rebalanceCadence,
    keyRisks: t.keyRisks,
    regimeNotes: t.regimeNotes,
    howItWorks,
  };
}

export function getAllWeather(): AllWeatherResponse {
  return {
    asOf: Date.now(),
    sleeves: ALL_WEATHER_SLEEVES,
    templates: ALL_WEATHER_TEMPLATES,
    disclaimer: DISCLAIMER,
  };
}
