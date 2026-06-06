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
  MarketCapBucket,
  RiskLevel,
  ScenarioPotential,
  StockPick,
} from "@shared/schema";
import { enrichOne } from "./stockPicks";
import { buildScenarioModel } from "./scenarioModel";

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
  };
}

const SEEDS: IdeaSeed[] = [
  {
    idea: {
      id: "tsla",
      ticker: "TSLA",
      companyName: "Tesla, Inc.",
      role: "high-variance-optionality",
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
];

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
    issuerCountry: "US",
  };
}

async function buildResponse(): Promise<ConvictionIdeasResponse> {
  let livePricingHit = false;
  let fundamentalsHit = false;

  const ideas: ConvictionIdea[] = await Promise.all(
    SEEDS.map(async (seed) => {
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
      const idea: ConvictionIdea = {
        ...seed.idea,
        roleLabel: ROLE_LABEL[seed.idea.role],
        keyMetrics,
        scenarioModel,
      };
      return idea;
    }),
  );

  return {
    roles: ROLES,
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
