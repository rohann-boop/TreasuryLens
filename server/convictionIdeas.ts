// Conviction Ideas — a small, deliberate idea-tracking workflow for a handful
// of high-conviction research candidates. This is intentionally NOT another
// large stock list: it is a focused book with explicit "what must be true",
// kill criteria, and review guardrails per idea.
//
// Data strategy: each idea carries a curated body PLUS a StockPick-shaped base
// used only to drive the SHARED enrichment + scenario-model code paths
// (server/stockPicks.ts:enrichOne, server/scenarioModel.ts:buildScenarioModel).
// We do not duplicate the fragile quote/fundamentals logic here — we reuse it,
// and degrade with warnings when providers are unavailable.

import type {
  ConvictionIdea,
  ConvictionIdeasResponse,
  ConvictionRole,
  ConvictionRoleInfo,
  ConvictionSectionInfo,
  ConvictionSectionKey,
  MarketCapBucket,
  RiskLevel,
  ScenarioPotential,
  StockPick,
} from "@shared/schema";
import type { AddConvictionIdeaInput } from "@shared/schema";
import { enrichOne } from "./stockPicks";
import { buildScenarioModel } from "./scenarioModel";
import { convictionStore, type CustomConvictionRow } from "./storage";

const CURATED_SOURCE =
  "Curated by TreasuryLens research — qualitative scores and bands are opinion, not advice.";

const ROLES: ConvictionRoleInfo[] = [
  {
    key: "core-compounder",
    label: "Core compounders",
    blurb:
      "Durable franchises expected to compound over many years. Lower variance, base-rate growth — the anchor of a research book.",
  },
  {
    key: "asymmetric-candidate",
    label: "Asymmetric 2x/3x",
    blurb:
      "Names where the research case sees a credible path to 2x–3x if execution lands, balanced against meaningful downside.",
  },
  {
    key: "high-variance-optionality",
    label: "High-variance optionality",
    blurb:
      "Wide outcome distribution. The bull case is a stack of optionality (multiple bets); treat the upside as a long tail, not a base case.",
  },
];

const ROLE_LABEL: Record<ConvictionRole, string> = {
  "core-compounder": "Core compounder",
  "asymmetric-candidate": "Asymmetric 2x/3x candidate",
  "high-variance-optionality": "High-variance optionality",
};

// Thematic sections — the primary grouping in the UI selector. Order here is
// the display order. "Bravos" is the user's curated high-conviction basket;
// the rest form the broader recommended universe.
const SECTIONS: ConvictionSectionInfo[] = [
  {
    key: "bravos",
    label: "Bravos",
    blurb:
      "A curated high-conviction basket across uranium/nuclear, AI power/grid, and copper/electrification — the structural-demand 'picks and shovels' for the AI build-out.",
  },
  {
    key: "core-ai-compounders",
    label: "Core AI compounders",
    blurb:
      "Durable mega-cap franchises with full-stack AI exposure — the anchor of the broader universe.",
  },
  {
    key: "speculative-ai-infra",
    label: "Speculative AI infrastructure",
    blurb:
      "Higher-beta infrastructure and compute names levered to the AI build-out, with wider outcome distributions.",
  },
  {
    key: "ai-power-grid",
    label: "AI power / grid",
    blurb:
      "Generation, grid, and electrification names positioned for surging data-center power demand.",
  },
  {
    key: "ai-software-data",
    label: "AI software / data",
    blurb:
      "Software, data-platform, and security names monetizing enterprise AI adoption.",
  },
  {
    key: "frontier-high-upside",
    label: "Frontier / high-upside",
    blurb:
      "Frontier bets with long-tail optionality — space, AI-bio, and voice AI. Treat upside as a long tail, not a base case.",
  },
  {
    key: "other",
    label: "Other ideas",
    blurb: "Ideas not assigned to a thematic section, including user-added ideas.",
  },
];

const SECTION_LABEL: Record<ConvictionSectionKey, string> = SECTIONS.reduce(
  (acc, s) => {
    acc[s.key] = s.label;
    return acc;
  },
  {} as Record<ConvictionSectionKey, string>,
);

// Each entry pairs the curated conviction body with the StockPick-shaped base
// fields required by the shared enrichment + scenario model. The base fields
// (marketCapBucket, scenarioPotential, riskLevel, convictionScore) drive the
// deterministic bull/base/bear math.
interface IdeaSeed {
  idea: Omit<
    ConvictionIdea,
    "roleLabel" | "keyMetrics" | "scenarioModel"
  >;
  scenario: {
    marketCapBucket: MarketCapBucket;
    scenarioPotential: ScenarioPotential;
    riskLevel: RiskLevel;
    issuerCountry?: string;
  };
}

// Compact builder for the newly added thematic ideas. These share a common
// shape (curated thesis bullets + a coarse checklist) so we fill sensible
// defaults and let each entry override the parts that matter. This keeps the
// new universe readable without duplicating the full ConvictionIdea body.
interface ThemeIdeaInput {
  id: string;
  ticker: string;
  companyName: string;
  role: ConvictionRole;
  sectionKey: ConvictionSectionKey;
  themes: string[];
  targetOutcome: string;
  convictionScore: number;
  thesis: string[];
  whatMustBeTrue: string[];
  catalysts: string[];
  risks: string[];
  killCriteria: string[];
  downsideGuardrail: string;
  positionSizingBand: ConvictionIdea["positionSizingBand"];
  positionSizingNote: string;
  reviewFrequency: string;
  reviewStatus: ConvictionIdea["reviewStatus"];
  issuerCountry?: string;
  checklist: { thesis: number; valuation: number; momentum: number; management: number; balanceSheet: number; catalyst: number; data: number };
  scenario: { marketCapBucket: MarketCapBucket; scenarioPotential: ScenarioPotential; riskLevel: RiskLevel };
}

function themeSeed(input: ThemeIdeaInput): IdeaSeed {
  const c = input.checklist;
  return {
    idea: {
      id: input.id,
      ticker: input.ticker,
      companyName: input.companyName,
      role: input.role,
      sectionKey: input.sectionKey,
      sectionLabel: SECTION_LABEL[input.sectionKey],
      themes: input.themes,
      timeHorizon: "Long-term (3–5y+)",
      targetOutcome: input.targetOutcome,
      convictionScore: input.convictionScore,
      dataConfidence: "curated",
      thesis: input.thesis,
      whatMustBeTrue: input.whatMustBeTrue,
      catalysts: input.catalysts,
      risks: input.risks,
      killCriteria: input.killCriteria,
      downsideGuardrail: input.downsideGuardrail,
      positionSizingBand: input.positionSizingBand,
      positionSizingNote: input.positionSizingNote,
      reviewFrequency: input.reviewFrequency,
      reviewStatus: input.reviewStatus,
      sourceNote: CURATED_SOURCE,
      checklist: [
        { key: "thesis-strength", label: "Thesis strength", score: c.thesis, note: "Curated qualitative self-assessment." },
        { key: "valuation", label: "Valuation", score: c.valuation, note: "Curated qualitative self-assessment." },
        { key: "momentum", label: "Momentum", score: c.momentum, note: "Curated qualitative self-assessment." },
        { key: "management", label: "Management", score: c.management, note: "Curated qualitative self-assessment." },
        { key: "balance-sheet", label: "Balance sheet", score: c.balanceSheet, note: "Curated qualitative self-assessment." },
        { key: "catalyst-clarity", label: "Catalyst clarity", score: c.catalyst, note: "Curated qualitative self-assessment." },
        { key: "data-confidence", label: "Data confidence", score: c.data, note: "Best-effort pricing/fundamentals where the issuer files publicly." },
      ],
    },
    scenario: { ...input.scenario, issuerCountry: input.issuerCountry },
  };
}

const THEME_SEEDS: IdeaSeed[] = [
  themeSeed({
    id: "snow",
    ticker: "SNOW",
    companyName: "Snowflake Inc.",
    role: "asymmetric-candidate",
    sectionKey: "ai-software-data",
    themes: ["AI Software", "Enterprise Data Infrastructure", "Data cloud", "Consumption model"],
    targetOutcome: "Asymmetric — 2x/3x if AI workloads reaccelerate consumption",
    convictionScore: 60,
    thesis: [
      "Cloud-agnostic data platform positioned as the system of record for enterprise analytics and AI feature data.",
      "Consumption-based model captures upside as AI/agent workloads drive query volume.",
      "Expanding into apps, ML, and Cortex AI to widen the platform beyond the data warehouse.",
    ],
    whatMustBeTrue: [
      "Net revenue retention stabilizes and reaccelerates with AI workloads.",
      "Cortex/AI features convert into incremental consumption, not just demos.",
      "Margins improve as the consumption base scales.",
    ],
    catalysts: ["AI-driven consumption growth", "New product attach (Cortex, apps)", "Large enterprise expansions"],
    risks: ["Rich valuation versus growth", "Competition from hyperscaler-native data stacks", "Consumption model adds revenue variability"],
    killCriteria: ["Sustained NRR decline below stabilization", "AI features fail to lift consumption", "Persistent margin erosion"],
    downsideGuardrail: "Large installed enterprise base and net-cash balance sheet anchor the floor, though the multiple stays demanding.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: asymmetric but expensive — a starter-sized research stake reflects the wide range of outcomes.",
    reviewFrequency: "Quarterly (earnings-driven)",
    reviewStatus: "monitoring",
    checklist: { thesis: 68, valuation: 35, momentum: 55, management: 65, balanceSheet: 80, catalyst: 60, data: 78 },
    scenario: { marketCapBucket: "large", scenarioPotential: "2x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "iren",
    ticker: "IREN",
    companyName: "IREN Limited (Iris Energy)",
    role: "high-variance-optionality",
    sectionKey: "speculative-ai-infra",
    themes: ["Speculative AI Infrastructure", "Bitcoin beta", "Data centers", "Power"],
    targetOutcome: "Optionality — 3x+ if AI compute pivot lands, wide distribution",
    convictionScore: 45,
    issuerCountry: "AU",
    thesis: [
      "Owned power and data-center sites give optionality to pivot from Bitcoin mining toward AI/HPC compute hosting.",
      "Low-cost renewable power footprint is a scarce input for AI infrastructure.",
      "Bitcoin mining base provides cash flow while the AI compute build-out is funded.",
    ],
    whatMustBeTrue: [
      "AI/HPC hosting contracts materialize at attractive economics.",
      "Power and GPU capacity get delivered on schedule and within budget.",
      "Bitcoin economics stay viable enough to fund the transition.",
    ],
    catalysts: ["AI/HPC hosting contract wins", "New site/power energization", "Bitcoin price strength"],
    risks: ["Highly speculative AI pivot with execution risk", "Bitcoin price beta drives large swings", "Capital intensity and potential dilution"],
    killCriteria: ["AI compute strategy fails to win contracts", "Funding stress forces heavily dilutive raises", "Bitcoin downturn undermines the cash base"],
    downsideGuardrail: "Owned power/land has standalone value, but equity is a high-beta bet on both Bitcoin and an unproven AI pivot.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: very wide outcome distribution suits a small watchlist-sized research stake.",
    reviewFrequency: "Quarterly + on contract/Bitcoin catalysts",
    reviewStatus: "monitoring",
    checklist: { thesis: 55, valuation: 45, momentum: 60, management: 55, balanceSheet: 45, catalyst: 55, data: 60 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "ccj",
    ticker: "CCJ",
    companyName: "Cameco Corporation",
    role: "core-compounder",
    sectionKey: "bravos",
    themes: ["Uranium", "Nuclear power", "Fuel cycle", "AI power demand"],
    targetOutcome: "Compounder — ~2x on a multi-year uranium up-cycle",
    convictionScore: 68,
    issuerCountry: "CA",
    thesis: [
      "Tier-one, low-cost uranium producer leveraged to a structural supply deficit.",
      "Westinghouse stake adds downstream fuel-cycle and services exposure.",
      "Nuclear demand tailwind from AI/data-center power and decarbonization.",
    ],
    whatMustBeTrue: [
      "Uranium term prices stay elevated enough to reward new production.",
      "Reactor restarts/builds and life extensions sustain demand.",
      "Cameco executes production ramp without major operational issues.",
    ],
    catalysts: ["Uranium contracting cycle", "Reactor restart/new-build announcements", "Westinghouse earnings contribution"],
    risks: ["Uranium price cyclicality", "Operational/mine-supply disruptions", "Policy/sentiment swings on nuclear"],
    killCriteria: ["Uranium prices collapse structurally", "Major operational failure", "Demand thesis (reactor builds) stalls"],
    downsideGuardrail: "Long-life, low-cost assets and contracted volumes anchor the franchise through cycles.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: the highest-quality liquid uranium name fits a core-anchor research role within a cyclical sleeve.",
    reviewFrequency: "Quarterly + on uranium price/contracting moves",
    reviewStatus: "fresh",
    checklist: { thesis: 78, valuation: 55, momentum: 65, management: 75, balanceSheet: 72, catalyst: 68, data: 75 },
    scenario: { marketCapBucket: "large", scenarioPotential: "compounder", riskLevel: "moderate" },
  }),
  themeSeed({
    id: "nxe",
    ticker: "NXE",
    companyName: "NexGen Energy Ltd.",
    role: "asymmetric-candidate",
    sectionKey: "bravos",
    themes: ["Uranium", "Nuclear power", "Development-stage mining"],
    targetOutcome: "Asymmetric — 2x/3x if Rook I reaches production into a tight market",
    convictionScore: 52,
    issuerCountry: "CA",
    thesis: [
      "Rook I / Arrow is one of the largest, highest-grade undeveloped uranium deposits in a tier-one jurisdiction.",
      "Pre-production optionality on a structural uranium supply deficit.",
      "Permitting progress de-risks a path to large-scale, low-cost output.",
    ],
    whatMustBeTrue: [
      "Final permitting and financing close on acceptable terms.",
      "Construction and ramp execute near plan.",
      "Uranium prices stay strong through first production.",
    ],
    catalysts: ["Permit approvals", "Offtake contracting", "Construction milestones"],
    risks: ["Pre-revenue: financing and dilution risk", "Permitting/construction delays", "Uranium price exposure with no current cash flow"],
    killCriteria: ["Permitting denied or indefinitely stalled", "Financing only available on heavily dilutive terms", "Uranium price collapse before production"],
    downsideGuardrail: "World-class resource has takeover/strategic value, but pre-production status means meaningful downside if the cycle turns.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: development-stage asymmetry suits a starter-sized research stake.",
    reviewFrequency: "Quarterly + on permit/financing milestones",
    reviewStatus: "monitoring",
    checklist: { thesis: 70, valuation: 45, momentum: 55, management: 65, balanceSheet: 55, catalyst: 60, data: 65 },
    scenario: { marketCapBucket: "mid", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "dnn",
    ticker: "DNN",
    companyName: "Denison Mines Corp.",
    role: "high-variance-optionality",
    sectionKey: "bravos",
    themes: ["Uranium", "Nuclear power", "ISR development", "Physical uranium"],
    targetOutcome: "Optionality — multi-bagger if Wheeler River + held uranium compound in an up-cycle",
    convictionScore: 48,
    issuerCountry: "CA",
    thesis: [
      "Wheeler River (Phoenix) ISR project offers low-cost development optionality.",
      "Holdings of physical uranium provide direct leverage to spot prices.",
      "Athabasca Basin asset base with multiple exploration/development bets.",
    ],
    whatMustBeTrue: [
      "ISR development advances and proves economic at scale.",
      "Uranium prices remain in an up-cycle.",
      "Financing supports development without crippling dilution.",
    ],
    catalysts: ["Wheeler River permitting/FID", "Uranium price strength", "Physical uranium revaluation"],
    risks: ["Development and technical (ISR) execution risk", "Dilution risk pre-cash-flow", "High uranium-price sensitivity"],
    killCriteria: ["Wheeler River economics fail to materialize", "Sustained uranium downturn", "Repeated dilutive financings"],
    downsideGuardrail: "Physical uranium holdings provide a partial floor, but the equity is a high-variance development bet.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: wide outcome range suits a small watchlist-sized research stake.",
    reviewFrequency: "Quarterly + on development/uranium catalysts",
    reviewStatus: "monitoring",
    checklist: { thesis: 62, valuation: 45, momentum: 55, management: 60, balanceSheet: 58, catalyst: 58, data: 62 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "sruuf",
    ticker: "SRUUF",
    companyName: "Sprott Physical Uranium Trust (US OTC)",
    role: "high-variance-optionality",
    sectionKey: "bravos",
    themes: ["Uranium", "Nuclear power", "Physical commodity", "Spot exposure"],
    targetOutcome: "Direct uranium-price optionality — tracks physical U3O8",
    convictionScore: 50,
    issuerCountry: "CA",
    thesis: [
      "Closed-end trust holding physical uranium — clean, direct exposure to spot U3O8.",
      "Acts as a supply sink that can tighten the physical market when it buys.",
      "Pure-play on the structural uranium supply-deficit thesis without operating risk.",
    ],
    whatMustBeTrue: [
      "Uranium spot prices appreciate over the horizon.",
      "Trust trades near (not at a deep discount to) NAV.",
      "Physical market stays in structural deficit.",
    ],
    catalysts: ["Uranium spot price moves", "Trust purchases tightening supply", "Reactor demand growth"],
    risks: ["Direct commodity-price risk with no cash flow", "Premium/discount to NAV swings", "OTC liquidity for US holders"],
    killCriteria: ["Structural uranium oversupply re-emerges", "Persistent deep discount to NAV", "Demand thesis breaks"],
    downsideGuardrail: "Backed by physical uranium (NAV floor), but tracks a volatile commodity with no income.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: a direct commodity proxy suits a small watchlist-sized research stake.",
    reviewFrequency: "Monthly NAV / on uranium price moves",
    reviewStatus: "monitoring",
    checklist: { thesis: 65, valuation: 50, momentum: 60, management: 60, balanceSheet: 70, catalyst: 60, data: 55 },
    scenario: { marketCapBucket: "mid", scenarioPotential: "2x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "ceg",
    ticker: "CEG",
    companyName: "Constellation Energy Corporation",
    role: "core-compounder",
    sectionKey: "bravos",
    themes: ["AI power", "Grid", "Utilities", "Nuclear generation"],
    targetOutcome: "Compounder — ~2x as carbon-free baseload re-rates on AI demand",
    convictionScore: 70,
    thesis: [
      "Largest US fleet of carbon-free nuclear generation — scarce, dispatchable baseload power.",
      "Direct beneficiary of AI/data-center power demand and behind-the-meter deals.",
      "Policy support (production credits) underpins cash flows.",
    ],
    whatMustBeTrue: [
      "Data-center/AI power demand keeps tightening the market for clean baseload.",
      "Power-purchase deals and pricing stay favorable.",
      "Fleet runs reliably with strong capacity factors.",
    ],
    catalysts: ["Data-center PPAs/co-location deals", "Power-price strength", "Nuclear uprates/license extensions"],
    risks: ["Power-price and policy sensitivity", "Operational/nuclear risk", "Valuation re-rated on the AI-power narrative"],
    killCriteria: ["AI-power demand thesis fades", "Adverse policy/regulatory shift on nuclear", "Major operational outage"],
    downsideGuardrail: "Irreplaceable carbon-free baseload fleet plus policy credits underpin durable cash generation.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: a scarce clean-baseload franchise fits a core-anchor research role.",
    reviewFrequency: "Quarterly + on power-deal/policy news",
    reviewStatus: "fresh",
    checklist: { thesis: 80, valuation: 50, momentum: 72, management: 75, balanceSheet: 72, catalyst: 72, data: 80 },
    scenario: { marketCapBucket: "large", scenarioPotential: "compounder", riskLevel: "moderate" },
  }),
  themeSeed({
    id: "vst",
    ticker: "VST",
    companyName: "Vistra Corp.",
    role: "asymmetric-candidate",
    sectionKey: "bravos",
    themes: ["AI power", "Grid", "Utilities", "Independent power producer"],
    targetOutcome: "Asymmetric — 2x if power demand + nuclear/retail mix re-rate",
    convictionScore: 64,
    thesis: [
      "Integrated independent power producer with generation + retail, leveraged to tightening power markets.",
      "Nuclear and dispatchable fleet positioned for AI/data-center demand.",
      "Aggressive capital return (buybacks) compounds per-share value.",
    ],
    whatMustBeTrue: [
      "Power demand growth keeps spark/clean spreads favorable.",
      "Capital-return discipline continues.",
      "Fleet operates reliably through demand peaks.",
    ],
    catalysts: ["Data-center demand/PPAs", "Power-price strength", "Buyback execution"],
    risks: ["Commodity/power-price volatility", "Leverage and capital-intensity", "Weather/operational risk"],
    killCriteria: ["Power-price collapse", "Capital-return reversal due to balance-sheet stress", "Demand thesis breaks"],
    downsideGuardrail: "Cash-generative integrated model and hedged retail book buffer commodity swings, though leverage adds risk.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: cyclical power leverage suits a starter-sized research stake.",
    reviewFrequency: "Quarterly + on power-market moves",
    reviewStatus: "monitoring",
    checklist: { thesis: 72, valuation: 58, momentum: 70, management: 70, balanceSheet: 60, catalyst: 68, data: 78 },
    scenario: { marketCapBucket: "large", scenarioPotential: "2x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "nrg",
    ticker: "NRG",
    companyName: "NRG Energy, Inc.",
    role: "asymmetric-candidate",
    sectionKey: "bravos",
    themes: ["AI power", "Grid", "Utilities", "Retail energy"],
    targetOutcome: "Asymmetric — 2x on power demand + capital return",
    convictionScore: 58,
    thesis: [
      "Integrated power + retail platform with leverage to rising electricity demand.",
      "Generation assets positioned to monetize AI/data-center load growth.",
      "Strong free-cash-flow conversion funds buybacks and de-leveraging.",
    ],
    whatMustBeTrue: [
      "Electricity demand growth sustains favorable margins.",
      "Capital-return and de-leveraging plan executes.",
      "Retail book stays profitable through volatility.",
    ],
    catalysts: ["Demand/PPA growth", "Buyback execution", "Margin expansion"],
    risks: ["Commodity/power-price exposure", "Leverage", "Regulatory/weather risk"],
    killCriteria: ["Power-price collapse", "FCF/buyback plan stalls", "Demand thesis breaks"],
    downsideGuardrail: "Retail cash flows and hedges provide ballast, though the equity carries leverage and commodity risk.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: cyclical power exposure suits a starter-sized research stake.",
    reviewFrequency: "Quarterly + on power-market moves",
    reviewStatus: "monitoring",
    checklist: { thesis: 68, valuation: 60, momentum: 65, management: 68, balanceSheet: 58, catalyst: 65, data: 78 },
    scenario: { marketCapBucket: "large", scenarioPotential: "2x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "xel",
    ticker: "XEL",
    companyName: "Xcel Energy Inc.",
    role: "core-compounder",
    sectionKey: "bravos",
    themes: ["AI power", "Grid", "Utilities", "Regulated utility"],
    targetOutcome: "Compounder — steady rate-base growth with grid/AI demand tailwind",
    convictionScore: 62,
    thesis: [
      "Regulated utility with a long runway of rate-base growth tied to grid investment.",
      "Load growth from electrification and data centers supports capex recovery.",
      "Lower-variance, dividend-supported compounder profile.",
    ],
    whatMustBeTrue: [
      "Constructive regulatory outcomes on rate cases and capex recovery.",
      "Load growth materializes as data centers and electrification ramp.",
      "Balance sheet supports the capex plan at reasonable cost.",
    ],
    catalysts: ["Rate-case approvals", "Data-center/load-growth announcements", "Capex plan upgrades"],
    risks: ["Regulatory/rate-case risk", "Interest-rate sensitivity", "Wildfire/operational liabilities"],
    killCriteria: ["Adverse regulatory shift", "Load-growth thesis fails to materialize", "Material liability event"],
    downsideGuardrail: "Regulated, rate-based earnings and a steady dividend anchor a low-variance return profile.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: a regulated rate-base compounder fits a lower-variance core-anchor role.",
    reviewFrequency: "Quarterly + on rate-case outcomes",
    reviewStatus: "fresh",
    checklist: { thesis: 70, valuation: 60, momentum: 58, management: 70, balanceSheet: 62, catalyst: 60, data: 80 },
    scenario: { marketCapBucket: "large", scenarioPotential: "compounder", riskLevel: "low" },
  }),
  themeSeed({
    id: "fcx",
    ticker: "FCX",
    companyName: "Freeport-McMoRan Inc.",
    role: "core-compounder",
    sectionKey: "bravos",
    themes: ["Copper", "Electrification", "Commodities", "Mining"],
    targetOutcome: "Compounder — ~2x on a structural copper up-cycle",
    convictionScore: 65,
    thesis: [
      "One of the largest publicly traded copper producers, leveraged to electrification demand.",
      "Long-life, tier-one assets with expansion and leaching upside.",
      "Copper supply struggles to keep pace with grid/EV/AI-power demand.",
    ],
    whatMustBeTrue: [
      "Copper prices stay strong on a structural deficit.",
      "Production and cost guidance hold.",
      "Capital discipline continues with shareholder returns.",
    ],
    catalysts: ["Copper price strength", "Leaching/production upside", "Demand from electrification/grid"],
    risks: ["Copper-price cyclicality", "Operational/jurisdiction risk (e.g., Indonesia)", "Capital-intensity of growth"],
    killCriteria: ["Copper price collapse", "Major operational/jurisdiction disruption", "Demand thesis breaks"],
    downsideGuardrail: "World-class, long-life copper assets anchor the franchise through commodity cycles.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: a tier-one copper major fits a core-anchor role within a cyclical sleeve.",
    reviewFrequency: "Quarterly + on copper price moves",
    reviewStatus: "fresh",
    checklist: { thesis: 75, valuation: 58, momentum: 65, management: 72, balanceSheet: 70, catalyst: 65, data: 78 },
    scenario: { marketCapBucket: "large", scenarioPotential: "compounder", riskLevel: "moderate" },
  }),
  themeSeed({
    id: "ero",
    ticker: "ERO",
    companyName: "Ero Copper Corp.",
    role: "asymmetric-candidate",
    sectionKey: "bravos",
    themes: ["Copper", "Electrification", "Commodities", "Growth miner"],
    targetOutcome: "Asymmetric — 2x/3x as new production ramps into a copper up-cycle",
    convictionScore: 54,
    issuerCountry: "CA",
    thesis: [
      "Lower-cost copper growth story with new mine (Tucumã) ramping production.",
      "Leverage to copper prices with a meaningful production-growth profile.",
      "Exploration upside across a focused Brazilian asset base.",
    ],
    whatMustBeTrue: [
      "Tucumã ramp reaches nameplate on cost/schedule.",
      "Copper prices stay supportive.",
      "Operations execute without major disruption.",
    ],
    catalysts: ["Production ramp milestones", "Copper price strength", "Exploration results"],
    risks: ["Single-region (Brazil) concentration", "Ramp/operational execution risk", "Copper-price and FX volatility"],
    killCriteria: ["Production ramp materially fails", "Copper price collapse", "Major operational disruption"],
    downsideGuardrail: "Producing low-cost assets provide a base, but smaller scale and a single jurisdiction add risk.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: a higher-beta copper growth name suits a starter-sized research stake.",
    reviewFrequency: "Quarterly + on ramp/copper catalysts",
    reviewStatus: "monitoring",
    checklist: { thesis: 66, valuation: 55, momentum: 60, management: 65, balanceSheet: 58, catalyst: 62, data: 70 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "cper",
    ticker: "CPER",
    companyName: "United States Copper Index Fund (CPER)",
    role: "high-variance-optionality",
    sectionKey: "bravos",
    themes: ["Copper", "Electrification", "Commodities", "Futures-based ETF"],
    targetOutcome: "Direct copper-price optionality — tracks copper futures",
    convictionScore: 50,
    thesis: [
      "Provides direct exposure to copper-futures prices without single-company operating risk.",
      "Clean way to express the electrification/grid copper-demand thesis.",
      "Diversifies a copper sleeve away from miner-specific execution risk.",
    ],
    whatMustBeTrue: [
      "Copper prices appreciate over the horizon.",
      "Futures roll cost (contango) stays manageable.",
      "Structural copper deficit thesis holds.",
    ],
    catalysts: ["Copper spot/futures moves", "Demand from electrification", "Supply disruptions"],
    risks: ["Direct commodity-price risk with no income", "Roll/contango drag on returns", "Leverage to a single commodity"],
    killCriteria: ["Copper price collapse", "Persistent severe contango drag", "Demand thesis breaks"],
    downsideGuardrail: "Tracks a real commodity (no bankruptcy risk), but carries direct price and roll-cost exposure with no yield.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: a direct commodity proxy suits a small watchlist-sized research stake.",
    reviewFrequency: "On copper price moves",
    reviewStatus: "monitoring",
    checklist: { thesis: 60, valuation: 50, momentum: 58, management: 55, balanceSheet: 65, catalyst: 58, data: 60 },
    scenario: { marketCapBucket: "mid", scenarioPotential: "2x potential", riskLevel: "high" },
  }),

  // ── Core AI compounders ──────────────────────────────────────────────
  themeSeed({
    id: "avgo",
    ticker: "AVGO",
    companyName: "Broadcom Inc.",
    role: "core-compounder",
    sectionKey: "core-ai-compounders",
    themes: ["AI infrastructure", "Custom silicon (XPU)", "Networking", "Software"],
    targetOutcome: "Compounder — ~2x as custom AI silicon + networking scale",
    convictionScore: 75,
    thesis: [
      "Leading custom AI accelerator (XPU) partner for hyperscalers plus dominant AI networking franchise.",
      "Diversified semiconductor + infrastructure-software (VMware) cash engine funds AI investment.",
      "Sticky, high-margin businesses with strong free-cash-flow conversion.",
    ],
    whatMustBeTrue: [
      "Custom-silicon program wins scale with multiple hyperscaler customers.",
      "AI networking attach keeps growing with cluster build-outs.",
      "VMware integration delivers durable software margins.",
    ],
    catalysts: ["New XPU customer ramps", "AI networking growth", "Software margin expansion"],
    risks: ["Customer concentration in custom silicon", "Cyclicality of semis", "Integration/debt from large M&A"],
    killCriteria: ["Loss of a major custom-silicon customer", "AI networking share erosion", "Software margins disappoint"],
    downsideGuardrail: "Diversified cash engines and high-margin software anchor the floor through semi cycles.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: a diversified AI-infrastructure compounder fits a core-anchor role.",
    reviewFrequency: "Quarterly (earnings-driven)",
    reviewStatus: "fresh",
    checklist: { thesis: 82, valuation: 50, momentum: 75, management: 80, balanceSheet: 70, catalyst: 72, data: 80 },
    scenario: { marketCapBucket: "mega", scenarioPotential: "compounder", riskLevel: "moderate" },
  }),
  themeSeed({
    id: "msft",
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    role: "core-compounder",
    sectionKey: "core-ai-compounders",
    themes: ["AI infrastructure", "Azure cloud", "Copilot / productivity", "Enterprise software"],
    targetOutcome: "Compounder — ~2x as AI monetizes across cloud + software",
    convictionScore: 80,
    thesis: [
      "Azure is a top-two AI cloud with first-mover enterprise AI distribution via OpenAI partnership.",
      "Copilot embeds AI across the highest-margin productivity franchise in software.",
      "Diversified, durable cash engines fund massive AI capex internally.",
    ],
    whatMustBeTrue: [
      "Azure sustains AI-driven growth and improves capacity economics.",
      "Copilot attach and pricing convert into incremental revenue.",
      "Capex intensity delivers ROI rather than margin drag.",
    ],
    catalysts: ["Azure AI growth", "Copilot seat expansion", "Enterprise AI deployments"],
    risks: ["AI capex digestion if ROI lags", "Cloud competition", "Regulatory scrutiny"],
    killCriteria: ["Azure growth decelerates persistently", "Copilot monetization stalls", "Capex outruns returns for multiple years"],
    downsideGuardrail: "Entrenched enterprise franchises and net-cash balance sheet anchor a low-variance floor.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: a diversified AI compounder fits a core-anchor role.",
    reviewFrequency: "Quarterly (earnings-driven)",
    reviewStatus: "fresh",
    checklist: { thesis: 85, valuation: 60, momentum: 72, management: 82, balanceSheet: 90, catalyst: 75, data: 82 },
    scenario: { marketCapBucket: "mega", scenarioPotential: "compounder", riskLevel: "moderate" },
  }),

  // ── Speculative AI infrastructure ────────────────────────────────────
  themeSeed({
    id: "nbis",
    ticker: "NBIS",
    companyName: "Nebius Group N.V.",
    role: "high-variance-optionality",
    sectionKey: "speculative-ai-infra",
    themes: ["Speculative AI Infrastructure", "GPU cloud", "Data centers"],
    targetOutcome: "Optionality — 3x+ if GPU-cloud scale and contracts land",
    convictionScore: 46,
    thesis: [
      "Pure-play AI/GPU cloud build-out with European data-center footprint.",
      "Leverage to surging demand for rentable AI compute.",
      "Optionality from stakes in adjacent AI businesses.",
    ],
    whatMustBeTrue: [
      "GPU-cloud capacity fills with creditworthy customers at good economics.",
      "Capacity is delivered on schedule and funded without crippling dilution.",
      "AI-compute demand stays strong through the build-out.",
    ],
    catalysts: ["Capacity energization", "Large hosting contracts", "AI-compute demand strength"],
    risks: ["Capital intensity and dilution risk", "GPU oversupply risk", "Execution on a fast build-out"],
    killCriteria: ["Demand/contracts fail to materialize", "Funding stress forces heavy dilution", "AI-compute pricing collapses"],
    downsideGuardrail: "Owned compute/data-center assets carry value, but equity is a high-beta build-out bet.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: wide outcome range suits a small watchlist-sized research stake.",
    reviewFrequency: "Quarterly + on capacity/contract catalysts",
    reviewStatus: "monitoring",
    checklist: { thesis: 55, valuation: 45, momentum: 58, management: 55, balanceSheet: 48, catalyst: 55, data: 58 },
    scenario: { marketCapBucket: "mid", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "crdo",
    ticker: "CRDO",
    companyName: "Credo Technology Group Holding Ltd.",
    role: "asymmetric-candidate",
    sectionKey: "speculative-ai-infra",
    themes: ["Speculative AI Infrastructure", "Connectivity (AECs)", "Data centers"],
    targetOutcome: "Asymmetric — 2x/3x as AI connectivity content scales",
    convictionScore: 52,
    thesis: [
      "Active electrical cable (AEC) connectivity is a fast-growing pick-and-shovel for AI data centers.",
      "Content gains as cluster bandwidth and reliability needs rise.",
      "Expanding customer base beyond initial hyperscaler anchor.",
    ],
    whatMustBeTrue: [
      "AEC adoption broadens across hyperscalers.",
      "Margins hold as the product mix scales.",
      "Customer concentration diversifies over time.",
    ],
    catalysts: ["New hyperscaler design wins", "AI cluster build-out", "Margin expansion"],
    risks: ["Heavy customer concentration", "Competitive connectivity alternatives", "Valuation embeds fast growth"],
    killCriteria: ["Loss of anchor customer", "Connectivity share loss", "Growth decelerates sharply"],
    downsideGuardrail: "Differentiated connectivity IP has value, but concentration and valuation add risk.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: a higher-beta connectivity name suits a starter-sized research stake.",
    reviewFrequency: "Quarterly + on design-win news",
    reviewStatus: "monitoring",
    checklist: { thesis: 64, valuation: 45, momentum: 65, management: 62, balanceSheet: 65, catalyst: 60, data: 68 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "alab",
    ticker: "ALAB",
    companyName: "Astera Labs, Inc.",
    role: "asymmetric-candidate",
    sectionKey: "speculative-ai-infra",
    themes: ["Speculative AI Infrastructure", "Connectivity / interconnect", "Data centers"],
    targetOutcome: "Asymmetric — 2x/3x as AI interconnect content compounds",
    convictionScore: 50,
    thesis: [
      "Connectivity/interconnect silicon (retimers, fabric) for AI servers and clusters.",
      "Content-per-server tailwind as AI architectures scale out.",
      "Early leadership in a fast-growing interconnect niche.",
    ],
    whatMustBeTrue: [
      "Interconnect content keeps rising with AI cluster complexity.",
      "Design wins broaden across platforms.",
      "Margins scale with volume.",
    ],
    catalysts: ["New platform design wins", "AI server growth", "Product line expansion"],
    risks: ["Customer concentration", "Competition from incumbents", "Rich valuation"],
    killCriteria: ["Share loss to incumbents", "Design-win pipeline stalls", "Growth decelerates"],
    downsideGuardrail: "Differentiated IP in a structural niche, but early-stage and richly valued.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: a higher-beta interconnect name suits a starter-sized research stake.",
    reviewFrequency: "Quarterly + on design-win news",
    reviewStatus: "monitoring",
    checklist: { thesis: 62, valuation: 42, momentum: 64, management: 62, balanceSheet: 68, catalyst: 60, data: 66 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "arm",
    ticker: "ARM",
    companyName: "Arm Holdings plc",
    role: "asymmetric-candidate",
    sectionKey: "speculative-ai-infra",
    themes: ["Speculative AI Infrastructure", "CPU IP / royalties", "Edge + data center"],
    targetOutcome: "Asymmetric — 2x/3x if royalty mix shifts to higher-value AI compute",
    convictionScore: 54,
    thesis: [
      "Ubiquitous CPU architecture with a royalty model levered to compute everywhere.",
      "Higher-value v9 and data-center/AI penetration lift royalty per chip.",
      "Asset-light, high-margin licensing economics.",
    ],
    whatMustBeTrue: [
      "Royalty rate mix shifts toward higher-value cores.",
      "Data-center/AI Arm adoption accelerates.",
      "Licensing pipeline stays healthy.",
    ],
    catalysts: ["v9 royalty mix shift", "Data-center design wins", "AI edge adoption"],
    risks: ["Premium valuation", "Customer/end-market cyclicality", "Competition from RISC-V"],
    killCriteria: ["Royalty mix shift stalls", "Data-center traction disappoints", "Licensing slows materially"],
    downsideGuardrail: "Entrenched architecture and royalty annuity anchor value, but the multiple is demanding.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: an expensive royalty compounder suits a starter-sized research stake.",
    reviewFrequency: "Quarterly (earnings-driven)",
    reviewStatus: "monitoring",
    checklist: { thesis: 66, valuation: 38, momentum: 62, management: 70, balanceSheet: 78, catalyst: 60, data: 78 },
    scenario: { marketCapBucket: "large", scenarioPotential: "2x potential", riskLevel: "high" },
  }),

  // ── AI power / grid (universe) ───────────────────────────────────────
  themeSeed({
    id: "gev",
    ticker: "GEV",
    companyName: "GE Vernova Inc.",
    role: "core-compounder",
    sectionKey: "ai-power-grid",
    themes: ["AI power", "Grid equipment", "Gas turbines", "Electrification"],
    targetOutcome: "Compounder — ~2x on a multi-year power/grid capex cycle",
    convictionScore: 66,
    thesis: [
      "Leading provider of gas turbines and grid equipment into a structural electrification capex cycle.",
      "Direct beneficiary of data-center power demand and grid modernization.",
      "Backlog visibility plus margin-improvement runway.",
    ],
    whatMustBeTrue: [
      "Power/grid capex stays strong on electrification + AI load.",
      "Margin improvement plan executes.",
      "Backlog converts into profitable revenue.",
    ],
    catalysts: ["Turbine/grid orders", "Margin expansion", "Data-center power demand"],
    risks: ["Project execution risk", "Cyclicality of capex", "Supply-chain/cost inflation"],
    killCriteria: ["Power capex cycle rolls over", "Margin plan stalls", "Major project losses"],
    downsideGuardrail: "Large installed base and backlog anchor the franchise through cycles.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: a power/grid capex compounder fits a core-anchor role.",
    reviewFrequency: "Quarterly + on order/backlog news",
    reviewStatus: "fresh",
    checklist: { thesis: 74, valuation: 52, momentum: 70, management: 70, balanceSheet: 68, catalyst: 70, data: 78 },
    scenario: { marketCapBucket: "large", scenarioPotential: "compounder", riskLevel: "moderate" },
  }),
  themeSeed({
    id: "etn",
    ticker: "ETN",
    companyName: "Eaton Corporation plc",
    role: "core-compounder",
    sectionKey: "ai-power-grid",
    themes: ["AI power", "Electrical equipment", "Data-center power", "Electrification"],
    targetOutcome: "Compounder — steady growth on data-center + electrification demand",
    convictionScore: 70,
    issuerCountry: "IE",
    thesis: [
      "Diversified electrical-equipment leader with strong data-center power exposure.",
      "Structural tailwinds from electrification, grid investment, and reshoring.",
      "Consistent margin expansion and capital returns.",
    ],
    whatMustBeTrue: [
      "Data-center and electrification demand sustains organic growth.",
      "Margin expansion continues.",
      "Backlog converts steadily.",
    ],
    catalysts: ["Data-center power orders", "Margin expansion", "Electrification capex"],
    risks: ["Industrial cyclicality", "Valuation re-rated on the data-center narrative", "Supply-chain costs"],
    killCriteria: ["Organic growth decelerates persistently", "Margin reversal", "Data-center demand thesis fades"],
    downsideGuardrail: "Diversified electrical franchise and backlog provide durable, lower-variance cash flows.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: a diversified electrification compounder fits a core-anchor role.",
    reviewFrequency: "Quarterly (earnings-driven)",
    reviewStatus: "fresh",
    checklist: { thesis: 76, valuation: 55, momentum: 70, management: 76, balanceSheet: 74, catalyst: 68, data: 80 },
    scenario: { marketCapBucket: "large", scenarioPotential: "compounder", riskLevel: "moderate" },
  }),
  themeSeed({
    id: "pwr",
    ticker: "PWR",
    companyName: "Quanta Services, Inc.",
    role: "core-compounder",
    sectionKey: "ai-power-grid",
    themes: ["AI power", "Grid construction", "Electrification", "Infrastructure services"],
    targetOutcome: "Compounder — ~2x on grid build-out and electrification services",
    convictionScore: 64,
    thesis: [
      "Leading infrastructure-services provider building and upgrading the electric grid.",
      "Direct beneficiary of grid modernization, renewables interconnection, and data-center hookups.",
      "Large multi-year backlog with execution track record.",
    ],
    whatMustBeTrue: [
      "Grid/electrification spend stays elevated for years.",
      "Backlog converts at healthy margins.",
      "Skilled-labor capacity scales with demand.",
    ],
    catalysts: ["Grid capex programs", "Backlog growth", "Data-center interconnection work"],
    risks: ["Labor availability", "Project execution risk", "Cyclicality of utility capex"],
    killCriteria: ["Grid capex slows materially", "Margin erosion on projects", "Backlog shrinks"],
    downsideGuardrail: "Essential grid-services franchise with deep backlog anchors the business through cycles.",
    positionSizingBand: "core",
    positionSizingNote: "Educational label only: a grid-build-out compounder fits a core-anchor role.",
    reviewFrequency: "Quarterly + on backlog news",
    reviewStatus: "fresh",
    checklist: { thesis: 72, valuation: 52, momentum: 68, management: 72, balanceSheet: 66, catalyst: 68, data: 78 },
    scenario: { marketCapBucket: "large", scenarioPotential: "compounder", riskLevel: "moderate" },
  }),
  themeSeed({
    id: "oklo",
    ticker: "OKLO",
    companyName: "Oklo Inc.",
    role: "high-variance-optionality",
    sectionKey: "ai-power-grid",
    themes: ["AI power", "Advanced nuclear (SMR)", "Pre-revenue"],
    targetOutcome: "Optionality — multi-bagger if SMR deployment lands, wide distribution",
    convictionScore: 40,
    thesis: [
      "Advanced fission (fast reactor) developer targeting clean baseload for data centers.",
      "Optionality on AI-driven demand for dedicated, dispatchable clean power.",
      "Early customer interest and a build-own-operate model.",
    ],
    whatMustBeTrue: [
      "NRC licensing and first deployments progress on a credible timeline.",
      "Customer agreements convert into funded projects.",
      "Financing supports the build without crippling dilution.",
    ],
    catalysts: ["Licensing milestones", "Customer/offtake agreements", "First-plant construction"],
    risks: ["Pre-revenue with significant execution + regulatory risk", "Dilution risk", "Long, uncertain timelines"],
    killCriteria: ["Licensing stalls indefinitely", "Funding only on heavily dilutive terms", "Deployment timeline slips materially"],
    downsideGuardrail: "Pre-revenue optionality — meaningful downside if milestones slip; not anchored by current cash flow.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: very wide outcome distribution suits a small watchlist-sized research stake.",
    reviewFrequency: "On licensing/customer milestones",
    reviewStatus: "monitoring",
    checklist: { thesis: 50, valuation: 35, momentum: 55, management: 55, balanceSheet: 45, catalyst: 50, data: 50 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),

  // ── AI software / data (universe) ────────────────────────────────────
  themeSeed({
    id: "ddog",
    ticker: "DDOG",
    companyName: "Datadog, Inc.",
    role: "asymmetric-candidate",
    sectionKey: "ai-software-data",
    themes: ["AI Software", "Observability", "Cloud monitoring", "Consumption model"],
    targetOutcome: "Asymmetric — 2x/3x if AI workloads expand observability spend",
    convictionScore: 58,
    thesis: [
      "Leading cloud observability platform with strong land-and-expand economics.",
      "AI/agent workloads add new monitoring surfaces and consumption.",
      "Broad product attach across the cloud-ops stack.",
    ],
    whatMustBeTrue: [
      "Net revenue retention stays high as cloud spend grows.",
      "AI-related products convert into incremental consumption.",
      "Margins expand as the platform scales.",
    ],
    catalysts: ["New product attach", "AI-driven usage growth", "Large enterprise expansions"],
    risks: ["Rich valuation", "Consumption variability", "Hyperscaler-native competition"],
    killCriteria: ["NRR declines persistently", "AI products fail to lift usage", "Margin erosion"],
    downsideGuardrail: "Sticky, mission-critical platform and net-cash balance sheet anchor the floor, though the multiple is demanding.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: asymmetric but expensive — a starter-sized research stake fits.",
    reviewFrequency: "Quarterly (earnings-driven)",
    reviewStatus: "monitoring",
    checklist: { thesis: 70, valuation: 38, momentum: 62, management: 70, balanceSheet: 80, catalyst: 62, data: 78 },
    scenario: { marketCapBucket: "large", scenarioPotential: "2x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "net",
    ticker: "NET",
    companyName: "Cloudflare, Inc.",
    role: "asymmetric-candidate",
    sectionKey: "ai-software-data",
    themes: ["AI Software", "Edge network", "Security", "Inference at edge"],
    targetOutcome: "Asymmetric — 2x/3x if edge + AI-inference adoption scales",
    convictionScore: 56,
    thesis: [
      "Global edge network positioned for security, performance, and edge AI inference.",
      "Developer-led adoption with a broad and expanding product surface.",
      "Optionality from running AI workloads close to users.",
    ],
    whatMustBeTrue: [
      "Enterprise traction and large-customer growth continue.",
      "Edge AI/inference products gain real adoption.",
      "Margins improve as scale builds.",
    ],
    catalysts: ["Large enterprise wins", "Edge AI product adoption", "Net retention strength"],
    risks: ["Premium valuation", "Competition across many product lines", "Profitability still maturing"],
    killCriteria: ["Enterprise growth decelerates", "Edge AI adoption disappoints", "Margins fail to improve"],
    downsideGuardrail: "Scarce global edge network has strategic value, but the multiple embeds strong growth.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: asymmetric but expensive — a starter-sized research stake fits.",
    reviewFrequency: "Quarterly (earnings-driven)",
    reviewStatus: "monitoring",
    checklist: { thesis: 68, valuation: 36, momentum: 62, management: 70, balanceSheet: 70, catalyst: 60, data: 76 },
    scenario: { marketCapBucket: "large", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "crwd",
    ticker: "CRWD",
    companyName: "CrowdStrike Holdings, Inc.",
    role: "asymmetric-candidate",
    sectionKey: "ai-software-data",
    themes: ["AI Software", "Cybersecurity", "Platform / modules", "Data + AI"],
    targetOutcome: "Asymmetric — 2x if platform consolidation + AI security scale",
    convictionScore: 60,
    thesis: [
      "Leading endpoint/security platform with strong module cross-sell.",
      "AI-driven detection and a large security-data moat.",
      "Durable subscription economics with high retention.",
    ],
    whatMustBeTrue: [
      "Module attach and platform consolidation continue.",
      "AI security features sustain differentiation.",
      "Net retention and margins stay strong.",
    ],
    catalysts: ["Module attach growth", "Large platform deals", "AI-security adoption"],
    risks: ["Rich valuation", "Competitive security market", "Reputational/operational incident risk"],
    killCriteria: ["Net retention declines", "Platform consolidation stalls", "Major security/operational incident"],
    downsideGuardrail: "Mission-critical platform with sticky subscriptions and strong FCF anchors the floor, though valuation is demanding.",
    positionSizingBand: "starter",
    positionSizingNote: "Educational label only: asymmetric but expensive — a starter-sized research stake fits.",
    reviewFrequency: "Quarterly (earnings-driven)",
    reviewStatus: "monitoring",
    checklist: { thesis: 72, valuation: 38, momentum: 64, management: 72, balanceSheet: 80, catalyst: 64, data: 80 },
    scenario: { marketCapBucket: "large", scenarioPotential: "2x potential", riskLevel: "high" },
  }),

  // ── Frontier / high-upside ───────────────────────────────────────────
  themeSeed({
    id: "rklb",
    ticker: "RKLB",
    companyName: "Rocket Lab USA, Inc.",
    role: "high-variance-optionality",
    sectionKey: "frontier-high-upside",
    themes: ["Frontier", "Space launch", "Space systems"],
    targetOutcome: "Optionality — multi-bagger if Neutron + space systems scale",
    convictionScore: 48,
    thesis: [
      "Established small-launch provider scaling into the larger Neutron rocket and space systems.",
      "Vertically integrated space company with a growing systems/components business.",
      "Optionality on becoming an end-to-end space platform.",
    ],
    whatMustBeTrue: [
      "Neutron development and first launches succeed roughly on plan.",
      "Space-systems revenue keeps growing and improving margins.",
      "Launch cadence and backlog scale.",
    ],
    catalysts: ["Neutron milestones/first launch", "Space-systems contract wins", "Launch cadence growth"],
    risks: ["Launch/development execution risk", "Capital intensity and dilution", "Lumpy, competitive end markets"],
    killCriteria: ["Neutron program stalls or fails", "Funding stress forces heavy dilution", "Systems growth disappoints"],
    downsideGuardrail: "Operating launch + systems business has value, but Neutron optionality drives a wide outcome range.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: very wide outcome distribution suits a small watchlist-sized research stake.",
    reviewFrequency: "Quarterly + on Neutron/launch milestones",
    reviewStatus: "monitoring",
    checklist: { thesis: 58, valuation: 42, momentum: 60, management: 62, balanceSheet: 50, catalyst: 58, data: 62 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "asts",
    ticker: "ASTS",
    companyName: "AST SpaceMobile, Inc.",
    role: "high-variance-optionality",
    sectionKey: "frontier-high-upside",
    themes: ["Frontier", "Direct-to-cell satellite", "Pre-revenue"],
    targetOutcome: "Optionality — multi-bagger if direct-to-cell constellation deploys",
    convictionScore: 38,
    thesis: [
      "Building a satellite constellation for direct-to-smartphone broadband connectivity.",
      "Carrier partnerships provide validation and potential distribution.",
      "Massive TAM if the technology and deployment work.",
    ],
    whatMustBeTrue: [
      "Satellites launch and the network proves out at scale.",
      "Carrier agreements convert into revenue.",
      "Financing supports the constellation build.",
    ],
    catalysts: ["Satellite launches", "Carrier commercial agreements", "Network milestones"],
    risks: ["Pre-revenue with major technical + capital risk", "Heavy dilution risk", "Long, uncertain deployment timeline"],
    killCriteria: ["Network/technology fails to prove out", "Funding only on heavily dilutive terms", "Carrier deals fall through"],
    downsideGuardrail: "Pre-revenue moonshot — substantial downside if the constellation stalls; not anchored by current cash flow.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: extreme outcome variance suits a very small watchlist-sized research stake.",
    reviewFrequency: "On launch/financing milestones",
    reviewStatus: "monitoring",
    checklist: { thesis: 48, valuation: 35, momentum: 55, management: 55, balanceSheet: 42, catalyst: 50, data: 48 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "rxrx",
    ticker: "RXRX",
    companyName: "Recursion Pharmaceuticals, Inc.",
    role: "high-variance-optionality",
    sectionKey: "frontier-high-upside",
    themes: ["Frontier", "AI drug discovery", "Biotech", "Pre-revenue"],
    targetOutcome: "Optionality — multi-bagger if AI-discovered pipeline delivers",
    convictionScore: 40,
    thesis: [
      "AI/ML-driven drug-discovery platform aiming to industrialize biology.",
      "Large proprietary datasets and compute partnerships as a moat.",
      "Optionality across a broad, partnered pipeline.",
    ],
    whatMustBeTrue: [
      "Pipeline programs produce clinical validation.",
      "Platform partnerships expand and generate milestones.",
      "Cash runway supports multiple shots on goal.",
    ],
    catalysts: ["Clinical readouts", "Pharma partnership milestones", "Platform validation"],
    risks: ["Clinical/biotech binary risk", "Cash burn and dilution", "AI-discovery thesis still unproven at outcomes"],
    killCriteria: ["Key clinical programs fail", "Partnerships lapse", "Funding stress forces heavy dilution"],
    downsideGuardrail: "Platform, data, and partnerships have option value, but clinical risk drives a very wide distribution.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: binary clinical outcomes suit a very small watchlist-sized research stake.",
    reviewFrequency: "On clinical/partnership milestones",
    reviewStatus: "monitoring",
    checklist: { thesis: 48, valuation: 40, momentum: 50, management: 55, balanceSheet: 50, catalyst: 48, data: 52 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
  themeSeed({
    id: "soun",
    ticker: "SOUN",
    companyName: "SoundHound AI, Inc.",
    role: "high-variance-optionality",
    sectionKey: "frontier-high-upside",
    themes: ["Frontier", "Voice AI", "Conversational AI"],
    targetOutcome: "Optionality — multi-bagger if voice-AI adoption scales",
    convictionScore: 38,
    thesis: [
      "Independent voice/conversational-AI platform across autos, restaurants, and devices.",
      "Optionality on broad enterprise adoption of voice interfaces.",
      "Growing bookings backlog as a forward indicator.",
    ],
    whatMustBeTrue: [
      "Bookings convert into durable, profitable revenue.",
      "Voice-AI adoption broadens across verticals.",
      "Cash runway supports the growth investment.",
    ],
    catalysts: ["Large enterprise/auto deals", "Bookings/backlog growth", "Voice-AI adoption"],
    risks: ["Competition from Big Tech voice assistants", "Cash burn and dilution", "Customer concentration"],
    killCriteria: ["Bookings fail to convert", "Adoption stalls", "Funding stress forces heavy dilution"],
    downsideGuardrail: "Differentiated independent voice stack has value, but scale is unproven and the range is very wide.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: very wide outcome distribution suits a very small watchlist-sized research stake.",
    reviewFrequency: "Quarterly + on major deal news",
    reviewStatus: "monitoring",
    checklist: { thesis: 48, valuation: 38, momentum: 55, management: 55, balanceSheet: 48, catalyst: 50, data: 55 },
    scenario: { marketCapBucket: "small", scenarioPotential: "3x potential", riskLevel: "high" },
  }),
];

const SEEDS: IdeaSeed[] = [
  {
    idea: {
      id: "tsla",
      ticker: "TSLA",
      companyName: "Tesla, Inc.",
      role: "high-variance-optionality",
      sectionKey: "frontier-high-upside",
      sectionLabel: SECTION_LABEL["frontier-high-upside"],
      themes: ["Autonomy", "Robotics", "Energy storage", "AI edge/inference"],
      timeHorizon: "Long-term (5y+)",
      targetOutcome: "Optionality — 3x/5x on success, wide distribution",
      convictionScore: 60,
      dataConfidence: "curated",
      thesis: [
        "Multiple uncorrelated option bets: autonomy/robotaxi, Optimus robotics, and energy storage on top of the auto base.",
        "Vertical integration in batteries, software, and in-house AI inference compute.",
        "Brand and manufacturing scale give a real distribution edge if any one bet lands.",
      ],
      whatMustBeTrue: [
        "At least one optionality bet (FSD/robotaxi, Optimus, or energy) reaches commercial scale.",
        "Auto gross margins stabilize while the optionality bets are funded.",
        "Execution on autonomy stays roughly on the curated timeline, not indefinitely delayed.",
      ],
      catalysts: [
        "Robotaxi / unsupervised FSD milestones and regulatory approvals.",
        "Optimus production and external-customer pilots.",
        "Energy storage deployment growth and margin inflection.",
      ],
      risks: [
        "Valuation already embeds large optionality — disappointment compresses the multiple hard.",
        "Autonomy timelines have repeatedly slipped; regulatory path is uncertain.",
        "Auto demand cyclicality and price competition pressure the funding base.",
      ],
      killCriteria: [
        "Autonomy program materially stalls AND auto margins deteriorate together.",
        "Capital structure stress forces dilutive raises to fund the optionality bets.",
        "A core optionality bet (robotaxi or Optimus) is formally shelved.",
      ],
      downsideGuardrail:
        "Profitable auto + energy base means it isn't a zero, but the base does not justify the full optionality price on its own.",
      positionSizingBand: "watchlist",
      positionSizingNote:
        "Educational label only: high outcome variance suits a small watchlist-sized research stake, not a core anchor.",
      reviewFrequency: "Quarterly + on each autonomy/Optimus catalyst",
      reviewStatus: "monitoring",
      sourceNote: CURATED_SOURCE,
      checklist: [
        { key: "thesis-strength", label: "Thesis strength", score: 70, note: "Multiple credible option bets, but each is unproven at scale." },
        { key: "valuation", label: "Valuation", score: 35, note: "Rich — embeds significant optionality already." },
        { key: "momentum", label: "Momentum", score: 55, note: "Volatile; sentiment-driven swings are large." },
        { key: "management", label: "Management", score: 65, note: "Visionary and execution-capable, with key-person and focus risk." },
        { key: "balance-sheet", label: "Balance sheet", score: 75, note: "Solid net cash supports the optionality runway." },
        { key: "catalyst-clarity", label: "Catalyst clarity", score: 45, note: "Catalysts real but timelines historically slip." },
        { key: "data-confidence", label: "Data confidence", score: 70, note: "US filer — live pricing and SEC fundamentals available." },
      ],
    },
    scenario: { marketCapBucket: "mega", scenarioPotential: "3x potential", riskLevel: "high" },
  },
  {
    idea: {
      id: "googl",
      ticker: "GOOGL",
      companyName: "Alphabet Inc. (Class A — GOOGL; also trades as GOOG)",
      role: "core-compounder",
      sectionKey: "core-ai-compounders",
      sectionLabel: SECTION_LABEL["core-ai-compounders"],
      themes: ["AI infrastructure", "Cloud", "Search", "YouTube"],
      timeHorizon: "Long-term (5y+)",
      targetOutcome: "Compounder — ~2x over the horizon if AI lead converts",
      convictionScore: 80,
      dataConfidence: "curated",
      thesis: [
        "Full-stack AI compounder: TPU silicon → Gemini models → distribution across Search, YouTube, and Cloud.",
        "Multiple cash engines fund aggressive AI investment without external capital.",
        "Cloud is re-accelerating on AI workloads, adding a third durable growth leg.",
      ],
      whatMustBeTrue: [
        "Search monetization survives the shift to AI overviews intact.",
        "Google Cloud sustains AI-driven growth and improves margins.",
        "TPU adoption broadens beyond first-party use.",
      ],
      catalysts: [
        "Gemini product cadence and enterprise adoption.",
        "Cloud margin expansion and backlog growth.",
        "Resolution of antitrust/regulatory overhangs.",
      ],
      risks: [
        "Search disruption from AI-native query experiences.",
        "Regulatory and antitrust pressure on the ad business.",
        "Rising capex intensity if AI ROI lags.",
      ],
      killCriteria: [
        "Sustained Search revenue decline that ad/Cloud growth can't offset.",
        "Cloud growth decelerates persistently versus AWS/Azure.",
        "Regulatory action that structurally breaks the ad model.",
      ],
      downsideGuardrail:
        "Search + YouTube cash engine plus a net-cash balance sheet anchors the floor even in stress scenarios.",
      positionSizingBand: "core",
      positionSizingNote:
        "Educational label only: lower-variance compounder profile is the kind of name researchers treat as a core anchor.",
      reviewFrequency: "Quarterly (earnings-driven)",
      reviewStatus: "fresh",
      sourceNote: CURATED_SOURCE,
      checklist: [
        { key: "thesis-strength", label: "Thesis strength", score: 85, note: "Vertically integrated AI stack with proven distribution." },
        { key: "valuation", label: "Valuation", score: 70, note: "Reasonable versus mega-cap peers given growth and cash." },
        { key: "momentum", label: "Momentum", score: 70, note: "Cloud re-acceleration supports the trend." },
        { key: "management", label: "Management", score: 75, note: "Deep bench; capital allocation under more scrutiny lately." },
        { key: "balance-sheet", label: "Balance sheet", score: 90, note: "Large net cash, strong FCF." },
        { key: "catalyst-clarity", label: "Catalyst clarity", score: 75, note: "Clear earnings/product catalysts on a regular cadence." },
        { key: "data-confidence", label: "Data confidence", score: 80, note: "US filer — live pricing and SEC fundamentals available." },
      ],
    },
    scenario: { marketCapBucket: "mega", scenarioPotential: "compounder", riskLevel: "moderate" },
  },
  {
    idea: {
      id: "amzn",
      ticker: "AMZN",
      companyName: "Amazon.com, Inc.",
      role: "core-compounder",
      sectionKey: "core-ai-compounders",
      sectionLabel: SECTION_LABEL["core-ai-compounders"],
      themes: ["AI infrastructure", "AWS", "Advertising", "Logistics/retail efficiency"],
      timeHorizon: "Long-term (5y+)",
      targetOutcome: "Compounder — ~2x over the horizon on margin mix shift",
      convictionScore: 78,
      dataConfidence: "curated",
      thesis: [
        "AWS is a core AI-infrastructure compounder with custom silicon (Trainium/Inferentia) and a large enterprise base.",
        "Advertising is a high-margin growth leg layered on top of retail traffic.",
        "Retail/logistics efficiency continues to convert revenue into rising operating margin.",
      ],
      whatMustBeTrue: [
        "AWS growth re-accelerates with AI workloads and holds margins.",
        "Advertising keeps compounding as a structurally high-margin segment.",
        "Retail operating margin keeps expanding via logistics efficiency.",
      ],
      catalysts: [
        "AWS AI-workload growth and custom-silicon adoption.",
        "Advertising revenue mix climbing.",
        "Retail margin inflection from fulfillment optimization.",
      ],
      risks: [
        "Retail demand cyclicality and consumer weakness.",
        "AWS competitive pressure from Azure/GCP.",
        "Capex intensity to fund AI infrastructure.",
      ],
      killCriteria: [
        "AWS growth decelerates while margins compress simultaneously.",
        "Retail margin expansion reverses for multiple quarters.",
        "Advertising growth stalls structurally.",
      ],
      downsideGuardrail:
        "Diversified cash engines (AWS + ads + retail) reduce single-segment dependence in a downturn.",
      positionSizingBand: "core",
      positionSizingNote:
        "Educational label only: diversified compounder profile fits a core-anchor research role.",
      reviewFrequency: "Quarterly (earnings-driven)",
      reviewStatus: "fresh",
      sourceNote: CURATED_SOURCE,
      checklist: [
        { key: "thesis-strength", label: "Thesis strength", score: 82, note: "Three reinforcing engines: AWS, ads, retail efficiency." },
        { key: "valuation", label: "Valuation", score: 60, note: "Optically high P/E but driven by margin mix shift." },
        { key: "momentum", label: "Momentum", score: 70, note: "AWS and ads growth supportive." },
        { key: "management", label: "Management", score: 75, note: "Disciplined cost focus under current leadership." },
        { key: "balance-sheet", label: "Balance sheet", score: 78, note: "Strong cash generation funds capex internally." },
        { key: "catalyst-clarity", label: "Catalyst clarity", score: 72, note: "Clear quarterly AWS/ads/margin signposts." },
        { key: "data-confidence", label: "Data confidence", score: 80, note: "US filer — live pricing and SEC fundamentals available." },
      ],
    },
    scenario: { marketCapBucket: "mega", scenarioPotential: "compounder", riskLevel: "moderate" },
  },
  {
    idea: {
      id: "meta",
      ticker: "META",
      companyName: "Meta Platforms, Inc.",
      role: "core-compounder",
      sectionKey: "core-ai-compounders",
      sectionLabel: SECTION_LABEL["core-ai-compounders"],
      themes: ["Advertising", "AI recommendation", "Open-source AI", "Wearables"],
      timeHorizon: "Long-term (5y+)",
      targetOutcome: "Compounder with AI leverage — ~2x if ARPU expands",
      convictionScore: 76,
      dataConfidence: "curated",
      thesis: [
        "Best-in-class engagement and data footprint for AI-driven recommendation and ad targeting.",
        "Massive in-house GPU fleet gives first-party AI capability and ad-tooling leverage.",
        "Strong capital return alongside investment in AI and the open-source Llama strategy.",
      ],
      whatMustBeTrue: [
        "AI-driven engagement and ad-targeting improvements keep lifting ARPU.",
        "Reality Labs spend stays disciplined rather than escalating uncontrolled.",
        "Open-source Llama remains strategic optionality, not a margin drain.",
      ],
      catalysts: [
        "Agentic ad tooling and AI-driven ARPU gains.",
        "Reels/recommendation engagement improvements.",
        "Llama ecosystem traction.",
      ],
      risks: [
        "Reality Labs cash burn weighing on consolidated margins.",
        "EU regulatory and global antitrust exposure.",
        "AI capex digestion if ROI lags expectations.",
      ],
      killCriteria: [
        "Material Family-of-Apps ARPU decline.",
        "Capex sustainably outruns operating cash flow.",
        "Regulatory action that breaks core ad targeting.",
      ],
      downsideGuardrail:
        "Family-of-apps engagement and ad monetization remain exceptional cash engines underpinning the floor.",
      positionSizingBand: "core",
      positionSizingNote:
        "Educational label only: high-cash-generation compounder fits a core-anchor research role.",
      reviewFrequency: "Quarterly (earnings-driven)",
      reviewStatus: "fresh",
      sourceNote: CURATED_SOURCE,
      checklist: [
        { key: "thesis-strength", label: "Thesis strength", score: 80, note: "Engagement + data + first-party AI compute." },
        { key: "valuation", label: "Valuation", score: 68, note: "Reasonable on core ad earnings; RL is the swing factor." },
        { key: "momentum", label: "Momentum", score: 72, note: "Ad growth and AI-driven engagement supportive." },
        { key: "management", label: "Management", score: 70, note: "Founder-led; RL spend discipline is the watch item." },
        { key: "balance-sheet", label: "Balance sheet", score: 85, note: "Net cash, strong FCF, active buybacks." },
        { key: "catalyst-clarity", label: "Catalyst clarity", score: 70, note: "ARPU and RL-spend signposts each quarter." },
        { key: "data-confidence", label: "Data confidence", score: 80, note: "US filer — live pricing and SEC fundamentals available." },
      ],
    },
    scenario: { marketCapBucket: "mega", scenarioPotential: "compounder", riskLevel: "moderate" },
  },
  {
    idea: {
      id: "pltr",
      ticker: "PLTR",
      companyName: "Palantir Technologies Inc.",
      role: "asymmetric-candidate",
      sectionKey: "ai-software-data",
      sectionLabel: SECTION_LABEL["ai-software-data"],
      themes: ["AIP", "Government", "Commercial adoption", "Enterprise AI"],
      timeHorizon: "Medium-to-long term (3–5y)",
      targetOutcome: "Asymmetric — 2x/3x if commercial AIP scales",
      convictionScore: 58,
      dataConfidence: "curated",
      thesis: [
        "Operational AI platform (AIP) addresses a real enterprise pain point with a differentiated deployment model.",
        "Sticky, high-margin government franchise provides a stable cash baseline.",
        "Founder-led with a fast product cadence and a growing commercial pipeline.",
      ],
      whatMustBeTrue: [
        "US commercial growth sustains at high rates.",
        "AIP boot-camp pipeline converts into multi-year enterprise contracts.",
        "Government segment stays a stable, growing cash engine.",
      ],
      catalysts: [
        "Commercial customer-count and net-dollar-retention acceleration.",
        "Large government/defense contract awards.",
        "AIP expansion into new verticals.",
      ],
      risks: [
        "Valuation already prices in significant commercial scale.",
        "Government revenue lumpiness and budget cycles.",
        "Heavy stock-based compensation dilution.",
      ],
      killCriteria: [
        "Sustained deceleration in US commercial growth.",
        "Material slip in net dollar retention.",
        "Stalled AIP pipeline conversion over multiple quarters.",
      ],
      downsideGuardrail:
        "Sticky government revenue base anchors valuation in stress scenarios, even if commercial disappoints.",
      positionSizingBand: "starter",
      positionSizingNote:
        "Educational label only: asymmetric but expensive — a starter-sized research stake reflects the wide range of outcomes.",
      reviewFrequency: "Quarterly + on major contract news",
      reviewStatus: "monitoring",
      sourceNote: CURATED_SOURCE,
      checklist: [
        { key: "thesis-strength", label: "Thesis strength", score: 70, note: "Differentiated platform; commercial proof still building." },
        { key: "valuation", label: "Valuation", score: 25, note: "Very rich — prices in a lot of future commercial scale." },
        { key: "momentum", label: "Momentum", score: 65, note: "Strong narrative and commercial growth momentum." },
        { key: "management", label: "Management", score: 65, note: "Founder-led, strong product cadence; SBC a concern." },
        { key: "balance-sheet", label: "Balance sheet", score: 80, note: "Net cash, positive FCF — funds itself." },
        { key: "catalyst-clarity", label: "Catalyst clarity", score: 60, note: "Commercial metrics and contract awards are watchable." },
        { key: "data-confidence", label: "Data confidence", score: 75, note: "US filer — live pricing and SEC fundamentals available." },
      ],
    },
    scenario: { marketCapBucket: "large", scenarioPotential: "2x potential", riskLevel: "high" },
  },
  {
    idea: {
      id: "nvda",
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      role: "core-compounder",
      sectionKey: "core-ai-compounders",
      sectionLabel: SECTION_LABEL["core-ai-compounders"],
      themes: ["AI hardware/accelerators", "Data-center infrastructure", "CUDA/software ecosystem", "Networking/systems"],
      timeHorizon: "Long-term (5y+)",
      targetOutcome: "Compounder — ~2x if AI growth and margins stay durable (not guaranteed)",
      convictionScore: 74,
      dataConfidence: "curated",
      thesis: [
        "Dominant AI accelerator platform — the default training/inference hardware through the current data-center build-out.",
        "CUDA and the broader software ecosystem create a deep, sticky moat that raises switching costs versus raw silicon.",
        "Riding the data-center capex cycle while expanding from chips to networking and full system-level platforms.",
      ],
      whatMustBeTrue: [
        "AI capex remains strong and hyperscalers keep buying GPUs at scale.",
        "Gross and operating margins stay high rather than normalizing under competition.",
        "Competitors and customer custom silicon do not materially erode NVIDIA's unit economics.",
      ],
      catalysts: [
        "Continued data-center revenue growth and next-gen platform ramps.",
        "Networking/systems attach lifting average revenue per deployment.",
        "Broadening AI adoption beyond hyperscalers into enterprise and sovereign demand.",
      ],
      risks: [
        "Valuation already embeds durable hypergrowth — disappointment compresses the multiple hard.",
        "Cyclicality of the capex cycle and demand/supply imbalance risk.",
        "Customer concentration in a handful of hyperscalers.",
        "Export controls limiting addressable markets, plus customer custom-silicon and competitive pressure.",
      ],
      killCriteria: [
        "AI capex decelerates materially across major customers.",
        "Gross/operating margins compress persistently.",
        "A major customer shifts decisively to in-house chips at scale.",
        "Sustained demand/supply imbalance signals a cycle rollover.",
      ],
      downsideGuardrail:
        "Dominant install base, software lock-in, and net-cash balance sheet anchor the floor, but the rich price still embeds strong forward growth.",
      positionSizingBand: "core",
      positionSizingNote:
        "Educational label only: a dominant-platform compounder fits a core-anchor research role, tempered by valuation and capex-cycle risk.",
      reviewFrequency: "Quarterly (earnings-driven) + on capex-cycle signals",
      reviewStatus: "fresh",
      sourceNote: CURATED_SOURCE,
      checklist: [
        { key: "thesis-strength", label: "Thesis strength", score: 85, note: "Dominant platform with a deep software moat across the AI stack." },
        { key: "valuation", label: "Valuation", score: 40, note: "Rich — embeds durable hypergrowth and high margins." },
        { key: "momentum", label: "Momentum", score: 78, note: "Strong data-center growth and platform ramps." },
        { key: "management", label: "Management", score: 80, note: "Founder-led with a long execution track record." },
        { key: "balance-sheet", label: "Balance sheet", score: 88, note: "Net cash, very strong FCF — funds itself." },
        { key: "catalyst-clarity", label: "Catalyst clarity", score: 72, note: "Clear quarterly data-center and platform-ramp signposts." },
        { key: "data-confidence", label: "Data confidence", score: 80, note: "US filer — live pricing and SEC fundamentals available." },
      ],
    },
    scenario: { marketCapBucket: "mega", scenarioPotential: "compounder", riskLevel: "high" },
  },
  ...THEME_SEEDS,
];

// Build a full IdeaSeed from a stored custom row. User-added ideas carry only
// ticker/name/theme/role/score, so the rest is generic curated scaffolding
// that prompts the user to fill in their own research. Pricing/scenario
// enrichment still runs via the shared code path.
function customRowToSeed(row: CustomConvictionRow): IdeaSeed {
  const role = (["core-compounder", "asymmetric-candidate", "high-variance-optionality"].includes(
    row.role,
  )
    ? row.role
    : "asymmetric-candidate") as ConvictionRole;
  const t = row.ticker;
  return themeSeed({
    id: row.id,
    ticker: t,
    companyName: row.companyName,
    role,
    sectionKey: "other",
    themes: [row.theme],
    targetOutcome: "User-defined idea — set your own target outcome",
    convictionScore: row.convictionScore,
    thesis: [`User-added idea for ${t}. Add your thesis bullets here.`],
    whatMustBeTrue: ["Define the preconditions that must hold for this idea to work."],
    catalysts: ["List the catalysts you are watching for this idea."],
    risks: ["List the key risks for this idea."],
    killCriteria: ["Define what would remove this idea from your book."],
    downsideGuardrail: "Define the downside floor / why this isn't a zero.",
    positionSizingBand: "watchlist",
    positionSizingNote: "Educational label only: user-added ideas start in the watchlist band until researched.",
    reviewFrequency: "Set your own review cadence",
    reviewStatus: "needs-review",
    checklist: { thesis: 50, valuation: 50, momentum: 50, management: 50, balanceSheet: 50, catalyst: 50, data: 50 },
    scenario: { marketCapBucket: "mid", scenarioPotential: "2x potential", riskLevel: "high" },
  });
}

// Effective seed list = curated defaults + user custom rows, minus any ids the
// user has removed. Reads the persistence store fresh each call.
function effectiveSeeds(): { seed: IdeaSeed; custom: boolean }[] {
  const removed = new Set(convictionStore.listRemoved());
  const defaults = SEEDS.filter((s) => !removed.has(s.idea.id)).map((seed) => ({
    seed,
    custom: false,
  }));
  const custom = convictionStore
    .listCustom()
    .filter((r) => !removed.has(r.id))
    .map((r) => ({ seed: customRowToSeed(r), custom: true }));
  // Dedupe by canonical ticker so the UI never renders two cards for the same
  // name. Curated defaults win over custom rows on collision (a ticker can
  // carry multiple theme tags, but it surfaces in exactly one section card).
  const out: { seed: IdeaSeed; custom: boolean }[] = [];
  const seenTickers = new Set<string>();
  for (const entry of [...defaults, ...custom]) {
    const ticker = entry.seed.idea.ticker.toUpperCase();
    if (seenTickers.has(ticker)) continue;
    seenTickers.add(ticker);
    out.push(entry);
  }
  return out;
}

const DISCLAIMER =
  "Conviction Ideas are starter research ideas, not recommendations and not personalized financial advice. Conviction scores, checklist scores, and scenario models are hypothetical research inputs — not predictions or targets. Position-sizing bands are educational labels, not allocation guidance. Investments can lose value. Consult a qualified financial professional before acting.";

const METRICS_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cached: { at: number; data: ConvictionIdeasResponse } | null = null;

// Build the StockPick-shaped object that the shared enrichment + scenario
// model consume. Conviction-specific fields are not part of StockPick, so we
// map across only what the shared code reads.
function toStockPickBase(seed: IdeaSeed): StockPick {
  const { idea, scenario } = seed;
  return {
    ticker: idea.ticker,
    companyName: idea.companyName,
    themes: ["ai-software"],
    subTheme: null,
    marketCapBucket: scenario.marketCapBucket,
    marketCapLabel: `${scenario.marketCapBucket} cap (curated)`,
    scenarioPotential: scenario.scenarioPotential,
    convictionScore: idea.convictionScore,
    riskLevel: scenario.riskLevel,
    downsideGuardrail: idea.downsideGuardrail,
    upsideCase: idea.targetOutcome,
    whatMustBeTrue: idea.whatMustBeTrue,
    thesis: idea.thesis,
    risks: idea.risks,
    removalTriggers: idea.killCriteria,
    dataConfidence: idea.dataConfidence,
    sourceNote: idea.sourceNote,
    issuerCountry: seed.scenario.issuerCountry ?? "US",
  };
}

async function buildResponse(): Promise<ConvictionIdeasResponse> {
  let livePricingHit = false;
  let fundamentalsHit = false;

  const ideas: ConvictionIdea[] = await Promise.all(
    effectiveSeeds().map(async ({ seed, custom }) => {
      const base = toStockPickBase(seed);
      let keyMetrics = null;
      try {
        keyMetrics = await enrichOne(base);
        if (keyMetrics.price != null) livePricingHit = true;
        if (keyMetrics.revenueGrowth != null || keyMetrics.grossMargin != null) {
          fundamentalsHit = true;
        }
      } catch {
        keyMetrics = null;
      }
      const withMetrics: StockPick = { ...base, keyMetrics };
      let scenarioModel = null;
      try {
        scenarioModel = buildScenarioModel(withMetrics);
      } catch {
        scenarioModel = null;
      }
      const sectionKey = seed.idea.sectionKey ?? "other";
      const idea: ConvictionIdea = {
        ...seed.idea,
        sectionKey,
        sectionLabel: seed.idea.sectionLabel ?? SECTION_LABEL[sectionKey],
        roleLabel: ROLE_LABEL[seed.idea.role],
        custom,
        keyMetrics,
        scenarioModel,
      };
      return idea;
    }),
  );

  // Only surface sections that actually contain at least one idea, preserving
  // the canonical display order from SECTIONS.
  const presentSections = new Set(ideas.map((i) => i.sectionKey ?? "other"));
  const sections = SECTIONS.filter((s) => presentSections.has(s.key));

  return {
    roles: ROLES,
    sections,
    ideas,
    lastUpdated: Date.now(),
    disclaimer: DISCLAIMER,
    notes:
      "A small, deliberate research book — not a broad watchlist. Each idea carries explicit preconditions, kill criteria, and review guardrails. Metrics are best-effort: pricing from a public quote provider, fundamentals from SEC EDGAR where available.",
    metricsStatus: {
      livePricing: livePricingHit,
      fundamentals: fundamentalsHit,
      note: livePricingHit
        ? "Live pricing and fundamentals attached where available."
        : "Pricing unavailable — showing curated content only.",
    },
  };
}

export async function getConvictionIdeas(): Promise<ConvictionIdeasResponse> {
  const now = Date.now();
  if (cached && now - cached.at < METRICS_TTL_MS) return cached.data;
  const data = await buildResponse();
  cached = { at: now, data };
  return data;
}

// Drop the response cache so the next read reflects an add/remove immediately.
function invalidate(): void {
  cached = null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function allKnownIds(): Set<string> {
  const ids = new Set<string>(SEEDS.map((s) => s.idea.id));
  for (const r of convictionStore.listCustom()) ids.add(r.id);
  return ids;
}

export class ConvictionConflictError extends Error {}

// Add a user-defined conviction idea. Validation happens at the route via the
// shared zod schema; this assumes a clean input. Throws ConvictionConflictError
// if the ticker collides with an existing (non-removed) idea.
export async function addConvictionIdea(
  input: AddConvictionIdeaInput,
): Promise<ConvictionIdeasResponse> {
  const ticker = input.ticker.toUpperCase();
  const baseId = slugify(ticker) || `idea-${Date.now()}`;
  const removed = new Set(convictionStore.listRemoved());

  // Collide only against ideas currently visible. If the id exists but was
  // removed, re-adding revives the slot (addCustom clears the removed flag).
  const known = allKnownIds();
  if (known.has(baseId) && !removed.has(baseId)) {
    throw new ConvictionConflictError(
      `An idea for ${ticker} already exists.`,
    );
  }

  // If baseId belongs to a curated default, store the custom row under a
  // distinct id to avoid overwriting the default's identity space.
  let id = baseId;
  const isDefaultId = SEEDS.some((s) => s.idea.id === baseId);
  if (isDefaultId) id = `${baseId}-custom`;
  while (known.has(id) && !removed.has(id)) id = `${id}-1`;

  convictionStore.addCustom({
    id,
    ticker,
    companyName: input.companyName,
    role: input.role,
    theme: input.theme,
    convictionScore: input.convictionScore,
    createdAt: Date.now(),
  });
  invalidate();
  return getConvictionIdeas();
}

// Remove any idea by id. Custom ideas are deleted outright; curated defaults
// are recorded in the removed table so they stay hidden across restarts.
export async function removeConvictionIdea(
  id: string,
): Promise<ConvictionIdeasResponse> {
  const isCustom = convictionStore.getCustom(id) != null;
  if (isCustom) {
    convictionStore.deleteCustom(id);
  } else {
    const isDefault = SEEDS.some((s) => s.idea.id === id);
    if (!isDefault) {
      throw new Error(`Unknown conviction idea: ${id}`);
    }
    convictionStore.markRemoved(id);
  }
  invalidate();
  return getConvictionIdeas();
}
