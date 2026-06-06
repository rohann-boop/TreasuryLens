import type {
  ConvictionChartPoint,
  ConvictionChartResponse,
  DataConfidence,
  MarketCapBucket,
  RiskLevel,
  ScenarioPotential,
  StockPick,
  StockPickEtf,
  StockPickEtfMetrics,
  StockPickKeyMetrics,
  StockPickPerformance,
  StockPickSubTheme,
  StockPickTheme,
  StockPickThemeInfo,
  StockPicksResponse,
} from "@shared/schema";
import type { Bar } from "./indicators";
import { sma } from "./indicators";
import {
  fetchMassiveChart,
  fetchMassiveTickerDetails,
  fetchYahooChart,
  fetchYahooQuote,
} from "./marketData";
import { getEquityFundamentals, getSharesOutstanding } from "./secEdgar";
import { buildScenarioMethodology, buildScenarioModel } from "./scenarioModel";

const THEMES: StockPickThemeInfo[] = [
  {
    key: "ai-hardware",
    name: "AI Hardware",
    blurb:
      "Compute, accelerators, memory, networking and the fabs that build them. The picks-and-shovels of the AI buildout.",
  },
  {
    key: "ai-software",
    name: "AI Software",
    blurb:
      "Platforms, model providers, enterprise applications and the data layer that turns AI capability into recurring revenue.",
  },
  {
    key: "ai-energy",
    name: "AI Energy",
    blurb:
      "Power generation, grid, and equipment exposed to multi-year datacenter demand growth — nuclear, gas peakers, and electrical infrastructure.",
  },
];

const CURATED_SOURCE =
  "Curated by TreasuryLens — figures approximate. Not a recommendation.";

// Compact builder for the extended universe. Long-form picks above carry
// hand-written thesis/risks; these shorter records share a common shape so
// the file stays readable as the list grows.
type MkPick = {
  ticker: string;
  companyName: string;
  themes: StockPickTheme[];
  subTheme?: StockPickSubTheme;
  bucket: MarketCapBucket;
  scenario: ScenarioPotential;
  conviction: number;
  risk: RiskLevel;
  downsideGuardrail: string;
  upsideCase: string;
  whatMustBeTrue: string[];
  thesis: string[];
  risks: string[];
  removalTriggers: string[];
  issuerCountry?: string;
  confidence?: DataConfidence;
  sourceSuffix?: string;
};

function bucketLabelFor(b: MarketCapBucket): string {
  if (b === "mega") return "Mega cap (curated)";
  if (b === "large") return "Large cap (curated)";
  if (b === "mid") return "Mid cap (curated)";
  if (b === "small") return "Small cap (curated)";
  return "Micro cap (curated)";
}

function mk(p: MkPick): StockPick {
  return {
    ticker: p.ticker,
    companyName: p.companyName,
    themes: p.themes,
    subTheme: p.subTheme ?? null,
    marketCapBucket: p.bucket,
    marketCapLabel: bucketLabelFor(p.bucket),
    scenarioPotential: p.scenario,
    convictionScore: p.conviction,
    riskLevel: p.risk,
    downsideGuardrail: p.downsideGuardrail,
    upsideCase: p.upsideCase,
    whatMustBeTrue: p.whatMustBeTrue,
    thesis: p.thesis,
    risks: p.risks,
    removalTriggers: p.removalTriggers,
    dataConfidence: p.confidence ?? "curated",
    sourceNote: p.sourceSuffix ? `${CURATED_SOURCE} ${p.sourceSuffix}` : CURATED_SOURCE,
    issuerCountry: p.issuerCountry ?? "US",
  };
}

// Type imports needed at module-import time (StockPickSubTheme/RiskLevel/etc.)
// are already imported via the top of the file's @shared/schema import.

const PICKS: StockPick[] = [
  // ───────── AI Hardware ─────────
  {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 82,
    riskLevel: "moderate",
    downsideGuardrail:
      "Dominant accelerator share and CUDA moat cushion drawdowns; valuation is the variable.",
    upsideCase:
      "Continued data-center capex cycle keeps GPU demand outstripping supply through the medium term.",
    whatMustBeTrue: [
      "Hyperscaler capex on AI training/inference continues to grow.",
      "Software ecosystem (CUDA, frameworks) keeps switching costs high.",
      "Margins stay defensible as custom silicon competition arrives.",
    ],
    thesis: [
      "Effective duopoly economics on leading-edge AI accelerators.",
      "Networking (NVLink, Spectrum-X) extends moat beyond the GPU die.",
      "Software platform monetization (NIM, Omniverse) optional upside.",
    ],
    risks: [
      "Hyperscaler in-house silicon (TPU, Trainium, MTIA) eroding mix.",
      "Cyclical capex digestion in a recession scenario.",
      "Geopolitical/export-control exposure to China.",
    ],
    removalTriggers: [
      "Gross margin compression below mid-60s sustained for >2 quarters.",
      "Loss of a top-3 hyperscaler design win to in-house silicon.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "AMD",
    companyName: "Advanced Micro Devices, Inc.",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 64,
    riskLevel: "elevated",
    downsideGuardrail:
      "Diversified CPU/embedded business offsets binary AI accelerator outcomes.",
    upsideCase:
      "MI300/MI350 family takes meaningful share as buyers demand a second source to NVIDIA.",
    whatMustBeTrue: [
      "ROCm matures enough for material enterprise deployments.",
      "Hyperscalers want a credible alternative to NVIDIA accelerators.",
      "Server CPU share gains continue against Intel.",
    ],
    thesis: [
      "Only credible merchant GPU alternative at scale today.",
      "EPYC server CPU franchise still in share-gain mode.",
      "Xilinx FPGA assets aligned with edge/inference workloads.",
    ],
    risks: [
      "Software stack still trails CUDA materially.",
      "Capacity-constrained at TSMC alongside NVIDIA.",
      "Margin gap to NVIDIA persists.",
    ],
    removalTriggers: [
      "Multiple quarters of flat AI accelerator revenue.",
      "Server CPU share losses to ARM-based competitors.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "AVGO",
    companyName: "Broadcom Inc.",
    themes: ["ai-hardware"],
    subTheme: "networking",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 76,
    riskLevel: "moderate",
    downsideGuardrail:
      "Custom ASIC + networking franchise plus VMware cash flows; less binary than pure GPU plays.",
    upsideCase:
      "Hyperscaler custom-silicon programs scale into a multi-year ASIC and Ethernet networking cycle.",
    whatMustBeTrue: [
      "Top hyperscalers continue to invest in custom AI ASICs.",
      "Ethernet wins meaningful share vs InfiniBand for AI fabrics.",
      "VMware execution stabilizes recurring software mix.",
    ],
    thesis: [
      "Effective duopolist in AI networking and custom silicon design services.",
      "Diversified across semis, networking, and software.",
      "Capital return discipline supports compounding.",
    ],
    risks: [
      "Concentration in a small number of hyperscaler customers.",
      "VMware integration friction with enterprise base.",
      "Cyclical exposure in broader semis business.",
    ],
    removalTriggers: [
      "Loss of a marquee custom-ASIC program.",
      "Software segment growth stalls post-VMware.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "TSM",
    companyName: "Taiwan Semiconductor Manufacturing Company",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 78,
    riskLevel: "elevated",
    downsideGuardrail:
      "Effective monopoly on leading-edge nodes; pricing power is structural.",
    upsideCase:
      "Leading-edge node and CoWoS packaging demand keep utilization tight across the cycle.",
    whatMustBeTrue: [
      "Advanced node leadership (N3/N2) is retained vs Intel Foundry/Samsung.",
      "CoWoS/advanced packaging capacity continues to expand.",
      "Cross-strait geopolitical situation remains manageable.",
    ],
    thesis: [
      "Bottleneck supplier to every major AI accelerator program.",
      "Pricing power demonstrated in recent quarters.",
      "Long-term capacity contracts with hyperscalers and fabless leaders.",
    ],
    risks: [
      "Taiwan geopolitical tail risk is real and not hedgeable in the equity.",
      "Capex intensity remains elevated.",
      "Customer concentration in top 3 fabless players.",
    ],
    removalTriggers: [
      "Material slip on N2 ramp.",
      "Sustained pricing concessions to top customers.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "TW",
  },
  {
    ticker: "ASML",
    companyName: "ASML Holding N.V.",
    themes: ["ai-hardware"],
    subTheme: "semi-equipment",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 74,
    riskLevel: "moderate",
    downsideGuardrail:
      "Sole supplier of EUV lithography; backlog visibility tends to be multi-year.",
    upsideCase:
      "High-NA EUV adoption and leading-edge node investment drive a sustained system shipment ramp.",
    whatMustBeTrue: [
      "Foundry/IDM capex on advanced nodes continues to grow.",
      "High-NA EUV ships and qualifies on schedule.",
      "China DUV restrictions remain manageable in aggregate revenue.",
    ],
    thesis: [
      "Monopoly on EUV lithography systems with ~20-year R&D moat.",
      "Service & upgrades create a high-margin recurring tail.",
      "Concentrated, financially strong customer base.",
    ],
    risks: [
      "Concentration in handful of foundry customers.",
      "Export-control overhang on China DUV business.",
      "Order lumpiness creates noisy near-term prints.",
    ],
    removalTriggers: [
      "Multi-quarter slowdown in EUV system bookings.",
      "Customer-driven push-outs on High-NA roadmap.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "NL",
  },
  {
    ticker: "AMAT",
    companyName: "Applied Materials, Inc.",
    themes: ["ai-hardware"],
    subTheme: "semi-equipment",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 68,
    riskLevel: "moderate",
    downsideGuardrail:
      "Diversified across deposition, etch, and inspection — broad WFE exposure.",
    upsideCase:
      "Advanced packaging and gate-all-around node transitions drive a multi-year WFE upcycle.",
    whatMustBeTrue: [
      "Foundry/memory capex rebounds and stays elevated.",
      "Advanced packaging tools take share of incremental spend.",
      "China revenue digestion clears without major export-control escalation.",
    ],
    thesis: [
      "Broad WFE exposure with strong service tail.",
      "Levered to leading-edge logic and HBM/DRAM build-out.",
      "Disciplined capital return.",
    ],
    risks: [
      "China revenue mix exposed to export controls.",
      "Memory capex remains cyclical.",
      "Tool-mix shifts can compress margins.",
    ],
    removalTriggers: [
      "Sustained WFE downturn.",
      "Material China export-control escalation.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "LRCX",
    companyName: "Lam Research Corporation",
    themes: ["ai-hardware"],
    subTheme: "semi-equipment",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 64,
    riskLevel: "moderate",
    downsideGuardrail:
      "Etch/deposition franchise critical to 3D NAND and advanced logic.",
    upsideCase:
      "HBM and advanced packaging restart drive memory WFE recovery.",
    whatMustBeTrue: [
      "Memory capex recovery materializes.",
      "Lam retains share in 3D NAND etch.",
      "HBM ramp benefits etch/deposition tool mix.",
    ],
    thesis: [
      "Critical equipment supplier to memory and advanced logic.",
      "Strong service revenue base.",
      "Track record of capital return.",
    ],
    risks: [
      "Memory cycle is volatile.",
      "China WFE exposure.",
      "Concentration in a few customers.",
    ],
    removalTriggers: [
      "Sustained memory capex deceleration.",
      "Material loss of share in etch/CVD nodes.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "KLAC",
    companyName: "KLA Corporation",
    themes: ["ai-hardware"],
    subTheme: "semi-equipment",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 66,
    riskLevel: "moderate",
    downsideGuardrail:
      "Effective monopoly in process control inspection — sticky tool fleet.",
    upsideCase:
      "Advanced node complexity drives outsized inspection tool intensity per wafer.",
    whatMustBeTrue: [
      "Leading-edge node transitions continue.",
      "Process control intensity rises per wafer.",
      "Advanced packaging adds inspection demand.",
    ],
    thesis: [
      "High-margin near-monopoly in optical inspection.",
      "Service revenue layer compounds across installed base.",
      "Premium ROIC profile in semis.",
    ],
    risks: [
      "Cyclical WFE exposure.",
      "Customer concentration.",
      "Currency / China overhang.",
    ],
    removalTriggers: [
      "Multi-quarter WFE downturn.",
      "Loss of share in newer inspection segments.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "MU",
    companyName: "Micron Technology, Inc.",
    themes: ["ai-hardware"],
    subTheme: "memory",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 58,
    riskLevel: "elevated",
    downsideGuardrail:
      "U.S.-based memory IDM with HBM exposure — cyclical but strategic.",
    upsideCase:
      "HBM3E/4 ramp meaningfully tightens DRAM supply through the next memory cycle.",
    whatMustBeTrue: [
      "HBM share gains stick with major AI accelerator customers.",
      "DRAM pricing discipline persists.",
      "NAND demand stabilizes.",
    ],
    thesis: [
      "Direct HBM exposure tied to AI accelerator volume.",
      "Strategic U.S. memory supplier with CHIPS Act support.",
      "Memory cycle leverage is asymmetric on the upside.",
    ],
    risks: [
      "Memory pricing is famously cyclical.",
      "Capex burden during ramps weighs on FCF.",
      "Competitive HBM moves by Samsung and SK Hynix.",
    ],
    removalTriggers: [
      "HBM share losses against SK Hynix.",
      "DRAM pricing collapse for 2+ quarters.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "ARM",
    companyName: "Arm Holdings plc",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 52,
    riskLevel: "elevated",
    downsideGuardrail:
      "Royalty model with broad chip ecosystem; lower capital intensity than peers.",
    upsideCase:
      "Arm-based server CPUs and edge AI inference drive royalty rate uplift.",
    whatMustBeTrue: [
      "v9 royalty rate uplift continues to ramp.",
      "Arm-based hyperscaler CPUs (Graviton, Cobalt) keep gaining share.",
      "Compute Subsystem strategy converts to revenue.",
    ],
    thesis: [
      "Architectural standard for the vast majority of mobile and edge silicon.",
      "Server CPU and AI inference are incremental opportunity sets.",
      "Royalty model — high incremental margins.",
    ],
    risks: [
      "Valuation prices in significant share gains.",
      "Concentration in mobile cycle near term.",
      "RISC-V competitive threat over time.",
    ],
    removalTriggers: [
      "Stalled v9 royalty rate progression.",
      "Material share loss in mobile/IoT.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "GB",
  },
  {
    ticker: "MRVL",
    companyName: "Marvell Technology, Inc.",
    themes: ["ai-hardware"],
    subTheme: "networking",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 58,
    riskLevel: "elevated",
    downsideGuardrail:
      "Diversified semis franchise with growing custom-silicon and optical DSP business.",
    upsideCase:
      "Custom AI ASICs for hyperscalers and optical interconnect drive a structural revenue step-up.",
    whatMustBeTrue: [
      "Custom ASIC programs scale on schedule.",
      "Optical DSP share remains intact as 1.6T transitions ramp.",
      "Enterprise/carrier segments stabilize.",
    ],
    thesis: [
      "Second-source custom AI silicon designer with named hyperscaler programs.",
      "Optical and switching content per AI rack rising.",
      "Recurring infrastructure exposure.",
    ],
    risks: [
      "Customer concentration on a few AI programs.",
      "Carrier/enterprise weakness drags the mix.",
      "Competitive pressure from larger ASIC integrators.",
    ],
    removalTriggers: [
      "Loss of a marquee custom silicon program.",
      "Optical DSP share erosion.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "ANET",
    companyName: "Arista Networks, Inc.",
    themes: ["ai-hardware"],
    subTheme: "networking",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 70,
    riskLevel: "moderate",
    downsideGuardrail:
      "Best-in-class hyperscaler networking franchise with strong margin profile.",
    upsideCase:
      "AI Ethernet fabrics broaden Arista's share of accelerator-cluster networking.",
    whatMustBeTrue: [
      "Ethernet wins material share for AI back-end fabrics.",
      "Top hyperscaler relationships remain intact.",
      "Software differentiation keeps margins resilient.",
    ],
    thesis: [
      "Hyperscaler-centric networking leader.",
      "Software-defined approach (EOS) is a real moat.",
      "Clean balance sheet with consistent capital return.",
    ],
    risks: [
      "Customer concentration with top two hyperscalers.",
      "NVIDIA Spectrum-X and Cisco competitive pressure.",
      "Cyclical hyperscaler capex.",
    ],
    removalTriggers: [
      "Loss of a top-two hyperscaler share.",
      "Margin compression vs guidance.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "CRDO",
    companyName: "Credo Technology Group Holding Ltd",
    themes: ["ai-hardware"],
    subTheme: "optical",
    marketCapBucket: "small",
    marketCapLabel: "Small cap (curated)",
    scenarioPotential: "3x potential",
    convictionScore: 42,
    riskLevel: "high",
    downsideGuardrail:
      "Position size should reflect single-product concentration risk.",
    upsideCase:
      "Active electrical cables and SerDes IP become standard for AI cluster interconnect.",
    whatMustBeTrue: [
      "AEC adoption accelerates in AI back-end fabrics.",
      "SerDes IP licensing scales.",
      "Customer base broadens beyond a few hyperscalers.",
    ],
    thesis: [
      "Pure-play AI interconnect exposure.",
      "Asset-light, IP-driven model.",
      "Multiple shots on goal across product lines.",
    ],
    risks: [
      "Limited customer concentration risk.",
      "Optical alternatives could leapfrog AECs.",
      "Lumpy revenue prints.",
    ],
    removalTriggers: [
      "AEC design-in losses at a top hyperscaler.",
      "Multi-quarter revenue stall.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "SMCI",
    companyName: "Super Micro Computer, Inc.",
    themes: ["ai-hardware"],
    subTheme: "datacenter-hardware",
    marketCapBucket: "mid",
    marketCapLabel: "Mid cap (curated)",
    scenarioPotential: "3x potential",
    convictionScore: 48,
    riskLevel: "very high",
    downsideGuardrail:
      "Position size should reflect governance/disclosure overhang; not a 'set and forget'.",
    upsideCase:
      "Direct-liquid-cooled AI server design wins compound as hyperscaler and Tier-2 build-outs accelerate.",
    whatMustBeTrue: [
      "Audit and disclosure issues are resolved cleanly.",
      "Liquid-cooled reference designs retain time-to-market advantage.",
      "GPU allocations remain favorable.",
    ],
    thesis: [
      "Time-to-market advantage on each new accelerator generation.",
      "Liquid-cooling expertise differentiates among system integrators.",
      "Leverage to the AI server build-out cycle.",
    ],
    risks: [
      "Past governance/disclosure concerns weigh on trust premium.",
      "Margin profile thinner than semis it depends on.",
      "Customer/supplier concentration.",
    ],
    removalTriggers: [
      "Further restatements or auditor changes.",
      "Sustained gross-margin compression below ~10%.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },

  // ───────── AI Software ─────────
  {
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    themes: ["ai-software"],
    subTheme: "hyperscalers",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 84,
    riskLevel: "low",
    downsideGuardrail:
      "Diversified, highly profitable franchises (Azure, Office, Windows) provide ballast.",
    upsideCase:
      "Azure AI revenue compounds as enterprise generative-AI workloads move to production.",
    whatMustBeTrue: [
      "Azure share gains continue against AWS/GCP.",
      "Copilot attach rates ramp across Microsoft 365 base.",
      "Capex investments earn an attractive return on invested capital.",
    ],
    thesis: [
      "Distribution moat on enterprise AI through Office and Azure.",
      "OpenAI partnership remains a strategic advantage.",
      "Best-in-class cash flow and capital return.",
    ],
    risks: [
      "AI capex digestion if enterprise ROI lags expectations.",
      "Regulatory scrutiny on bundling and M&A.",
      "Open-source model commoditization risk.",
    ],
    removalTriggers: [
      "Sustained Azure deceleration relative to peers.",
      "Capital-intensity remains elevated without commensurate revenue.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "GOOGL",
    companyName: "Alphabet Inc.",
    themes: ["ai-software"],
    subTheme: "hyperscalers",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 78,
    riskLevel: "moderate",
    downsideGuardrail:
      "Search/YouTube cash engine plus full-stack AI (TPU, Gemini, DeepMind).",
    upsideCase:
      "Gemini + Cloud + TPU integration converts AI research lead into recurring enterprise revenue.",
    whatMustBeTrue: [
      "Search monetization survives AI overviews intact.",
      "Google Cloud growth re-accelerates with AI workloads.",
      "TPU adoption broadens beyond first-party use.",
    ],
    thesis: [
      "Vertically integrated AI stack from chip to model to product.",
      "Multi-engine business model (Search, YouTube, Cloud).",
      "Strong balance sheet supports aggressive AI investment.",
    ],
    risks: [
      "Search disruption from AI-native experiences.",
      "Regulatory pressure on ad business.",
      "Capex intensity rising fast.",
    ],
    removalTriggers: [
      "Sustained Search revenue decline.",
      "Cloud growth deceleration vs AWS/Azure.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "META",
    companyName: "Meta Platforms, Inc.",
    themes: ["ai-software"],
    subTheme: "ai-apps",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 74,
    riskLevel: "moderate",
    downsideGuardrail:
      "Family-of-apps engagement and ad monetization are exceptional cash engines.",
    upsideCase:
      "Llama, Reels recommendation AI, and agentic ad tooling expand ARPU across 3B+ users.",
    whatMustBeTrue: [
      "AI-driven engagement and ad-targeting improvements continue.",
      "Reality Labs spend doesn't escalate uncontrolled.",
      "Open-source Llama strategy stays strategic optionality.",
    ],
    thesis: [
      "Best-in-class data and engagement footprint for AI personalization.",
      "Massive in-house GPU fleet — first-party AI capability.",
      "Strong capital return alongside investment.",
    ],
    risks: [
      "Reality Labs cash burn.",
      "Regulatory risk in EU and antitrust globally.",
      "AI capex digestion if ROI lags.",
    ],
    removalTriggers: [
      "Material Family of Apps ARPU decline.",
      "Capex outruns operating cash flow sustainably.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "PLTR",
    companyName: "Palantir Technologies Inc.",
    themes: ["ai-software"],
    subTheme: "enterprise-apps",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 58,
    riskLevel: "high",
    downsideGuardrail:
      "Sticky government revenue base anchors valuation in stress scenarios.",
    upsideCase:
      "AIP commercial pipeline scales beyond bootcamps into enduring multi-year enterprise contracts.",
    whatMustBeTrue: [
      "Commercial US growth sustains at high rates.",
      "AIP boot-camp pipeline converts to multi-year contracts.",
      "Government segment stays a stable cash engine.",
    ],
    thesis: [
      "Operational AI platform addresses a real enterprise pain point.",
      "Government franchise provides high-margin baseline.",
      "Founder-led with strong product cadence.",
    ],
    risks: [
      "Valuation already prices in significant commercial scale.",
      "Government revenue lumpiness.",
      "Heavy stock-based compensation.",
    ],
    removalTriggers: [
      "Sustained deceleration in U.S. commercial growth.",
      "Material slip in net dollar retention.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "SNOW",
    companyName: "Snowflake Inc.",
    themes: ["ai-software"],
    subTheme: "data-platforms",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 60,
    riskLevel: "elevated",
    downsideGuardrail:
      "Net-revenue-retention and cash position support optionality on the AI platform pivot.",
    upsideCase:
      "Cortex and data-cloud workloads make Snowflake the default substrate for enterprise AI on structured data.",
    whatMustBeTrue: [
      "Cortex/AI workloads expand without cannibalizing core consumption.",
      "Competitive intensity vs Databricks does not crush margins.",
      "Customer consumption growth re-accelerates.",
    ],
    thesis: [
      "Architectural separation of storage and compute remains differentiated.",
      "Marketplace and data-sharing build network effects.",
      "Strong balance sheet enables R&D investment.",
    ],
    risks: [
      "Pricing pressure from open formats (Iceberg) and competitors.",
      "Consumption model creates near-term volatility.",
      "Path to durable GAAP profitability still in progress.",
    ],
    removalTriggers: [
      "Sustained NRR below ~115%.",
      "Material new-logo deceleration.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "NOW",
    companyName: "ServiceNow, Inc.",
    themes: ["ai-software"],
    subTheme: "enterprise-apps",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 72,
    riskLevel: "moderate",
    downsideGuardrail:
      "High retention rates and mission-critical workflows make revenue resilient.",
    upsideCase:
      "Now Assist embeds GenAI into core workflow platforms and drives a durable pricing uplift.",
    whatMustBeTrue: [
      "Now Assist attach rates continue to grow.",
      "Federal vertical remains a stable growth engine.",
      "Free cash flow margin expansion path stays intact.",
    ],
    thesis: [
      "Workflow platform with deep enterprise penetration.",
      "Track record of consistent execution.",
      "AI features layered onto an already-monetized base.",
    ],
    risks: [
      "Premium valuation leaves limited margin for execution slips.",
      "Enterprise IT budget tightening risk.",
      "Competition from Microsoft on workflow AI.",
    ],
    removalTriggers: [
      "Sustained slowdown in subscription billings growth.",
      "Material churn at top 50 customers.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "CRM",
    companyName: "Salesforce, Inc.",
    themes: ["ai-software"],
    subTheme: "enterprise-apps",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 62,
    riskLevel: "moderate",
    downsideGuardrail:
      "Cash flow generation and capital return cushion the multiple if AI monetization slips.",
    upsideCase:
      "Agentforce drives a per-seat-plus-consumption monetization step-up across the installed base.",
    whatMustBeTrue: [
      "Agentforce/Data Cloud generate measurable incremental revenue.",
      "Operating margin discipline persists.",
      "Core CRM growth re-accelerates modestly.",
    ],
    thesis: [
      "Massive installed base to upsell AI features into.",
      "Improved capital allocation since activist involvement.",
      "Data Cloud is a strategic asset for agentic workflows.",
    ],
    risks: [
      "Maturing core CRM growth.",
      "Microsoft Dynamics competition in mid-market.",
      "AI ROI for customers still being proven.",
    ],
    removalTriggers: [
      "Sustained current-RPO growth below high single digits.",
      "Operating margin erosion vs guidance.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "ADBE",
    companyName: "Adobe Inc.",
    themes: ["ai-software"],
    subTheme: "enterprise-apps",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 66,
    riskLevel: "moderate",
    downsideGuardrail:
      "Creative Cloud monetization and free cash flow conversion remain best-in-class.",
    upsideCase:
      "Firefly and GenStudio convert AI from threat to monetizable upsell across creative and marketing.",
    whatMustBeTrue: [
      "Generative credits monetize without significant cannibalization.",
      "Enterprise GenStudio adoption ramps.",
      "Creative Cloud net-add growth stabilizes.",
    ],
    thesis: [
      "Distribution and brand moat in creative workflows.",
      "Document Cloud is a durable secondary engine.",
      "Track record of franchise expansion.",
    ],
    risks: [
      "Open-source and competitor generative tools commoditize edits.",
      "Slower creative seat growth at maturity.",
      "Pricing pushback in SMB.",
    ],
    removalTriggers: [
      "Two consecutive quarters of net-new ARR declines.",
      "Material price discounting to defend share.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "ORCL",
    companyName: "Oracle Corporation",
    themes: ["ai-software"],
    subTheme: "data-platforms",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 64,
    riskLevel: "moderate",
    downsideGuardrail:
      "Database franchise and OCI GPU backlog provide layered exposure.",
    upsideCase:
      "OCI capacity build-out plus AI-cluster contracts re-rate Oracle into a credible AI infrastructure peer.",
    whatMustBeTrue: [
      "OCI capacity-constrained backlog converts to revenue.",
      "Cloud database migrations sustain Autonomous Database growth.",
      "Capex discipline preserves margins.",
    ],
    thesis: [
      "Differentiated AI training/inference capacity with named hyperscaler-grade customers.",
      "Database moat with cloud migration tailwind.",
      "Strong cash flow profile.",
    ],
    risks: [
      "Heavy AI capex risks margin compression if returns lag.",
      "Customer concentration risk in OCI contracts.",
      "Net debt level.",
    ],
    removalTriggers: [
      "Sustained slip in cloud RPO growth.",
      "Margin guide reductions on capex pressure.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "MDB",
    companyName: "MongoDB, Inc.",
    themes: ["ai-software"],
    subTheme: "data-platforms",
    marketCapBucket: "mid",
    marketCapLabel: "Mid cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 52,
    riskLevel: "elevated",
    downsideGuardrail:
      "Atlas franchise is a strategic developer database with sticky workloads.",
    upsideCase:
      "Vector search and AI agents drive Atlas consumption beyond traditional OLTP workloads.",
    whatMustBeTrue: [
      "Atlas consumption re-accelerates.",
      "Vector / RAG workloads pull new use cases.",
      "Margins expand toward long-term targets.",
    ],
    thesis: [
      "Developer-first document database with strong product velocity.",
      "Multi-cloud distribution.",
      "Levered to net-new application development.",
    ],
    risks: [
      "Competition from hyperscaler native services.",
      "Consumption pressure during macro softness.",
      "SBC dilution.",
    ],
    removalTriggers: [
      "Atlas growth sub-20% for multiple quarters.",
      "Net dollar retention breaks below ~115%.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "DDOG",
    companyName: "Datadog, Inc.",
    themes: ["ai-software"],
    subTheme: "developer-tools",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 66,
    riskLevel: "moderate",
    downsideGuardrail:
      "Observability spend is sticky and tied to cloud workload growth.",
    upsideCase:
      "AI-native applications increase telemetry data volume and product attach rates.",
    whatMustBeTrue: [
      "Cloud workload growth remains healthy.",
      "Multi-product attach rates continue to expand.",
      "AI observability adoption translates into revenue.",
    ],
    thesis: [
      "Best-in-class observability platform with strong land-and-expand motion.",
      "Real beneficiary of AI workload telemetry growth.",
      "Margin discipline alongside growth.",
    ],
    risks: [
      "Cost-optimization cycles can pressure consumption.",
      "Competition from open-source and hyperscaler-native tools.",
      "SBC dilution.",
    ],
    removalTriggers: [
      "NRR breaks below ~115% sustained.",
      "New-product attach growth stalls.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "CRWD",
    companyName: "CrowdStrike Holdings, Inc.",
    themes: ["ai-software"],
    subTheme: "cybersecurity",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 60,
    riskLevel: "elevated",
    downsideGuardrail:
      "Sticky endpoint security platform with broad module attach.",
    upsideCase:
      "Charlotte AI and identity/SIEM modules drive a multi-product step-up over time.",
    whatMustBeTrue: [
      "Customer trust rebuilds post 2024 outage.",
      "Multi-module attach continues to expand.",
      "Free cash flow margin remains best-in-class.",
    ],
    thesis: [
      "Platform consolidation play across security tooling.",
      "AI-native detection and response capabilities.",
      "Strong cash conversion supports R&D and capital return.",
    ],
    risks: [
      "Outage overhang on near-term sales cycles.",
      "Competitive intensity from Microsoft and SentinelOne.",
      "Premium valuation.",
    ],
    removalTriggers: [
      "Sustained NRR or net-new ARR deceleration.",
      "Material customer attrition tied to past outage.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "AI",
    companyName: "C3.ai, Inc.",
    themes: ["ai-software"],
    subTheme: "ai-apps",
    marketCapBucket: "small",
    marketCapLabel: "Small cap (curated)",
    scenarioPotential: "3x potential",
    convictionScore: 30,
    riskLevel: "very high",
    downsideGuardrail:
      "Position size should reflect speculative nature; pre-profit at scale.",
    upsideCase:
      "Federal and defense AI deployments scale into a durable contracted revenue base.",
    whatMustBeTrue: [
      "Government bookings convert to recurring revenue.",
      "Operating losses narrow on a credible path.",
      "Customer concentration diversifies.",
    ],
    thesis: [
      "Pure-play enterprise AI applications vendor.",
      "Government and defense pipeline is a real differentiator.",
      "Optionality on agentic AI workloads.",
    ],
    risks: [
      "Persistent operating losses.",
      "Customer concentration with Baker Hughes.",
      "Competitive intensity from hyperscalers.",
    ],
    removalTriggers: [
      "Multi-quarter revenue stall.",
      "Material customer attrition.",
    ],
    dataConfidence: "approximate",
    sourceNote: CURATED_SOURCE + " Highly speculative.",
    issuerCountry: "US",
  },
  {
    ticker: "SAP",
    companyName: "SAP SE",
    themes: ["ai-software"],
    subTheme: "enterprise-apps",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 60,
    riskLevel: "low",
    downsideGuardrail:
      "Mission-critical ERP installed base with multi-year RISE migration runway.",
    upsideCase:
      "Joule and Business AI features drive a per-seat uplift across the cloud ERP base.",
    whatMustBeTrue: [
      "Cloud ERP migration cadence remains steady.",
      "Business AI features monetize.",
      "Operating leverage continues.",
    ],
    thesis: [
      "Sticky enterprise ERP relationships.",
      "Cloud transition is well underway.",
      "AI features layered on existing data assets.",
    ],
    risks: [
      "Migration timing volatility.",
      "European labor cost structure.",
      "Competition from Workday and Microsoft.",
    ],
    removalTriggers: [
      "Cloud backlog deceleration.",
      "Operating margin guide reductions.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "DE",
  },

  // ───────── AI Energy ─────────
  {
    ticker: "CEG",
    companyName: "Constellation Energy Corporation",
    themes: ["ai-energy"],
    subTheme: "ipps",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 70,
    riskLevel: "moderate",
    downsideGuardrail:
      "Largest U.S. nuclear fleet with regulated cash flows provides downside support.",
    upsideCase:
      "Behind-the-meter and PPA deals with hyperscalers re-rate the value of dispatchable, carbon-free baseload.",
    whatMustBeTrue: [
      "Datacenter PPA economics continue to support premium pricing.",
      "License extensions and uprates proceed on schedule.",
      "Regulatory stance on co-located nuclear remains constructive.",
    ],
    thesis: [
      "Scarcity of dispatchable, carbon-free baseload power.",
      "Hyperscaler PPAs validate a structural pricing uplift.",
      "Optionality on uprates and SMR partnerships.",
    ],
    risks: [
      "Power-price volatility on the merchant side.",
      "Regulatory shifts on co-located generation.",
      "Long lead times on capacity additions.",
    ],
    removalTriggers: [
      "Material adverse FERC ruling on co-located loads.",
      "Sustained collapse in forward power curves.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "VST",
    companyName: "Vistra Corp.",
    themes: ["ai-energy"],
    subTheme: "ipps",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 64,
    riskLevel: "elevated",
    downsideGuardrail:
      "Energy Harbor nuclear deal diversifies generation and improves carbon profile.",
    upsideCase:
      "ERCOT load growth and nuclear assets attract premium hyperscaler offtake economics.",
    whatMustBeTrue: [
      "Texas load growth from datacenters persists.",
      "Nuclear assets attract premium contracting.",
      "Capital allocation balances buybacks and growth investment.",
    ],
    thesis: [
      "Largest competitive U.S. power generator with nuclear optionality.",
      "Exposure to high-growth ERCOT and PJM markets.",
      "Disciplined capital return.",
    ],
    risks: [
      "Volatile gas and power markets.",
      "Texas grid policy and weather extremes.",
      "Execution on plant integration.",
    ],
    removalTriggers: [
      "Collapse in forward Texas power curves.",
      "Material plant outages affecting EBITDA guide.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "NEE",
    companyName: "NextEra Energy, Inc.",
    themes: ["ai-energy"],
    subTheme: "utilities",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 68,
    riskLevel: "moderate",
    downsideGuardrail:
      "Regulated Florida utility provides a defensive earnings anchor.",
    upsideCase:
      "Renewables backlog and storage growth align with corporate clean-energy procurement for AI.",
    whatMustBeTrue: [
      "Renewables backlog converts on schedule.",
      "Interest rate environment doesn't pressure project economics further.",
      "Florida service-territory growth continues.",
    ],
    thesis: [
      "Scale leader in U.S. renewables development.",
      "Strong regulated utility base supports growth investment.",
      "Long-duration backlog reduces near-term execution risk.",
    ],
    risks: [
      "Rate-sensitivity of project IRRs.",
      "Policy shifts on renewable tax credits.",
      "Supply chain and interconnection delays.",
    ],
    removalTriggers: [
      "Material write-downs in Energy Resources backlog.",
      "Sustained EPS growth below long-term guide.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "ETN",
    companyName: "Eaton Corporation plc",
    themes: ["ai-energy"],
    subTheme: "grid-equipment",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "compounder",
    convictionScore: 72,
    riskLevel: "moderate",
    downsideGuardrail:
      "Diversified electrical and aerospace portfolio limits single-end-market exposure.",
    upsideCase:
      "Datacenter and electrification backlog drives multi-year mid-teens electrical segment growth.",
    whatMustBeTrue: [
      "Datacenter and grid backlog converts to revenue on schedule.",
      "Pricing discipline persists through the cycle.",
      "Aerospace cycle remains supportive.",
    ],
    thesis: [
      "Direct beneficiary of datacenter electrical content per MW growth.",
      "Track record of execution and margin expansion.",
      "Reshoring and electrification tailwinds layered with AI.",
    ],
    risks: [
      "Cyclical commercial/industrial exposure.",
      "Lead-time normalization could pressure pricing.",
      "Project push-outs at hyperscalers.",
    ],
    removalTriggers: [
      "Backlog growth turns negative for two consecutive quarters.",
      "Margin guide cuts on mix or pricing.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "IE",
  },
  {
    ticker: "PWR",
    companyName: "Quanta Services, Inc.",
    themes: ["ai-energy"],
    subTheme: "engineering",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 66,
    riskLevel: "moderate",
    downsideGuardrail:
      "Utility maintenance and storm restoration revenue is non-cyclical and recurring.",
    upsideCase:
      "Multi-decade transmission build-out is the physical layer behind AI energy demand growth.",
    whatMustBeTrue: [
      "Utility transmission and distribution capex continues to grow.",
      "Labor constraints don't compress margins further.",
      "Renewables interconnection queue accelerates.",
    ],
    thesis: [
      "Scarce, scaled labor force for grid and substation work.",
      "Multi-year backlog visibility.",
      "Disciplined acquisitions extend competitive moat.",
    ],
    risks: [
      "Project timing volatility affects quarter-to-quarter prints.",
      "Labor cost inflation.",
      "Concentration with a few large utilities.",
    ],
    removalTriggers: [
      "Backlog declines across two consecutive quarters.",
      "Sustained margin compression on labor.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "GEV",
    companyName: "GE Vernova Inc.",
    themes: ["ai-energy"],
    subTheme: "grid-equipment",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 66,
    riskLevel: "moderate",
    downsideGuardrail:
      "Diversified across gas turbines, grid, and electrification — broad energy build-out exposure.",
    upsideCase:
      "Gas turbine and grid orders surge as datacenter and electrification demand outstrip supply.",
    whatMustBeTrue: [
      "Gas turbine bookings sustain at elevated rates.",
      "Grid solutions backlog converts to revenue.",
      "Wind segment stabilizes operationally.",
    ],
    thesis: [
      "Tier-one supplier of dispatchable gas generation and grid hardware.",
      "Beneficiary of multi-year load-growth investment cycle.",
      "Clean balance sheet post spin.",
    ],
    risks: [
      "Wind segment execution remains a drag.",
      "Project lead times and pricing normalization.",
      "Cyclical exposure to power generation orders.",
    ],
    removalTriggers: [
      "Gas turbine bookings deceleration.",
      "Major project write-down at Wind segment.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "SMR",
    companyName: "NuScale Power Corporation",
    themes: ["ai-energy"],
    subTheme: "nuclear",
    marketCapBucket: "small",
    marketCapLabel: "Small cap (curated)",
    scenarioPotential: "5x potential",
    convictionScore: 32,
    riskLevel: "very high",
    downsideGuardrail:
      "Speculative pre-commercial; treat as a venture-style allocation.",
    upsideCase:
      "Hyperscaler offtake interest and NRC-certified SMR design create the first commercial-scale order book.",
    whatMustBeTrue: [
      "Commercial SMR orders are signed and financed.",
      "Capital structure survives the bridge to first revenue.",
      "Construction execution comes in on credible cost curves.",
    ],
    thesis: [
      "Only NRC-certified small modular reactor design in the U.S. market.",
      "Optionality on datacenter offtake.",
      "Strategic relationships with engineering partners.",
    ],
    risks: [
      "Pre-revenue with material dilution risk.",
      "Project cancellations have historical precedent.",
      "Long, regulator-dependent timelines.",
    ],
    removalTriggers: [
      "Loss of marquee customer commitment.",
      "Capital structure event with heavy dilution.",
    ],
    dataConfidence: "approximate",
    sourceNote: CURATED_SOURCE + " Highly speculative.",
    issuerCountry: "US",
  },
  {
    ticker: "OKLO",
    companyName: "Oklo Inc.",
    themes: ["ai-energy"],
    subTheme: "nuclear",
    marketCapBucket: "small",
    marketCapLabel: "Small cap (curated)",
    scenarioPotential: "5x potential",
    convictionScore: 35,
    riskLevel: "very high",
    downsideGuardrail:
      "Speculative pre-revenue; treat any position as a venture-style allocation.",
    upsideCase:
      "First commercial Aurora units gain NRC approval and lock in datacenter offtake at premium pricing.",
    whatMustBeTrue: [
      "NRC licensing milestones are met on a credible timeline.",
      "Initial datacenter offtake agreements are signed and funded.",
      "Capital structure remains intact without heavy dilution.",
    ],
    thesis: [
      "Pure-play small modular reactor exposure with named customer interest.",
      "Long-term datacenter demand for firm clean power.",
      "Optionality on used-fuel and microgrid markets.",
    ],
    risks: [
      "Pre-revenue with regulatory and construction execution risk.",
      "Significant equity dilution likely on the path to commercialization.",
      "Sentiment-driven volatility.",
    ],
    removalTriggers: [
      "Material NRC setback or program delay.",
      "Significant adverse changes to capital structure.",
    ],
    dataConfidence: "approximate",
    sourceNote: CURATED_SOURCE + " Highly speculative.",
    issuerCountry: "US",
  },
  {
    ticker: "VRT",
    companyName: "Vertiv Holdings Co",
    themes: ["ai-energy"],
    subTheme: "datacenter-power",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "2x potential",
    convictionScore: 68,
    riskLevel: "elevated",
    downsideGuardrail:
      "Mission-critical data-center power and thermal franchise with multi-year AI-driven backlog visibility.",
    upsideCase:
      "Liquid-cooling and high-density power demand from AI training clusters drives a multi-year revenue and margin step-up.",
    whatMustBeTrue: [
      "AI data-center build-out keeps liquid-cooling and high-density power demand growing.",
      "Vertiv retains share against Schneider/Eaton in thermal and power distribution.",
      "Backlog converts on schedule without margin slippage.",
    ],
    thesis: [
      "Direct pure-play on data-center power, thermal, and rack infrastructure for AI compute.",
      "Leadership in liquid cooling at a moment when AI rack densities force the industry off air cooling.",
      "Strong orders/backlog visibility from hyperscaler and colo build-outs.",
    ],
    risks: [
      "Cyclical exposure to hyperscaler capex; any AI capex digestion hits orders fast.",
      "Competitive intensity from Schneider Electric, Eaton, and Asian thermal vendors.",
      "Execution risk on rapid capacity expansion and lead-time normalization.",
    ],
    removalTriggers: [
      "Orders/backlog growth turns negative for two consecutive quarters.",
      "Material margin compression on mix or pricing pressure.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "DUK",
    companyName: "Duke Energy Corporation",
    themes: ["ai-energy"],
    subTheme: "utilities",
    marketCapBucket: "mega",
    marketCapLabel: "Mega cap (curated)",
    scenarioPotential: "defensive",
    convictionScore: 58,
    riskLevel: "low",
    downsideGuardrail:
      "Regulated utility footprint with constructive Carolinas regulation; defensive income profile.",
    upsideCase:
      "Datacenter-driven load growth supports a longer rate-base growth runway.",
    whatMustBeTrue: [
      "Regulatory recovery on grid investment remains constructive.",
      "Datacenter load forecasts hold up.",
      "Rate-base growth converts to EPS.",
    ],
    thesis: [
      "Regulated utility leverage to Southeast datacenter growth.",
      "Defensive cash flow with reasonable yield.",
      "Multi-decade T&D investment runway.",
    ],
    risks: [
      "Rate-case timing and political risk.",
      "Interest-rate sensitivity.",
      "Coal retirement timeline execution.",
    ],
    removalTriggers: [
      "Adverse Carolinas rate-case outcome.",
      "Material load-growth disappointment.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "SO",
    companyName: "The Southern Company",
    themes: ["ai-energy"],
    subTheme: "utilities",
    marketCapBucket: "large",
    marketCapLabel: "Large cap (curated)",
    scenarioPotential: "defensive",
    convictionScore: 56,
    riskLevel: "low",
    downsideGuardrail:
      "Regulated Southeast utility with Vogtle 3/4 nuclear now commercial.",
    upsideCase:
      "Georgia datacenter load growth extends Southern's rate-base trajectory.",
    whatMustBeTrue: [
      "Georgia regulatory environment stays constructive.",
      "Datacenter load growth is realized.",
      "Nuclear cost recovery is finalized.",
    ],
    thesis: [
      "Two new nuclear units online amid load growth.",
      "Diversified Southeast utility footprint.",
      "Stable income profile.",
    ],
    risks: [
      "Regulatory and political risk in core states.",
      "Coal retirement cost recovery.",
      "Long-cycle capex timing.",
    ],
    removalTriggers: [
      "Adverse rate decisions in core jurisdictions.",
      "Material EPS guide cuts.",
    ],
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE,
    issuerCountry: "US",
  },
  {
    ticker: "LEU",
    companyName: "Centrus Energy Corp.",
    themes: ["ai-energy"],
    subTheme: "uranium",
    marketCapBucket: "small",
    marketCapLabel: "Small cap (curated)",
    scenarioPotential: "3x potential",
    convictionScore: 40,
    riskLevel: "very high",
    downsideGuardrail:
      "Position size should reflect single-product policy-driven exposure.",
    upsideCase:
      "HALEU enrichment capacity becomes strategic for advanced reactors as Russian supply is phased out.",
    whatMustBeTrue: [
      "U.S. government continues to fund HALEU build-out.",
      "Customer offtake agreements scale.",
      "Capital structure remains intact.",
    ],
    thesis: [
      "Only U.S. domestic HALEU enrichment capacity at meaningful scale.",
      "Optionality on advanced reactor fuel demand.",
      "Strategic national-security tailwind.",
    ],
    risks: [
      "Policy and budget risk.",
      "Long lead times to capacity expansion.",
      "Customer concentration.",
    ],
    removalTriggers: [
      "Material policy reversal on enrichment funding.",
      "Customer offtake cancellations.",
    ],
    dataConfidence: "approximate",
    sourceNote: CURATED_SOURCE + " Speculative single-product.",
    issuerCountry: "US",
  },

  // ───────── Extended AI Hardware ─────────
  mk({
    ticker: "QCOM",
    companyName: "Qualcomm Incorporated",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    bucket: "large",
    scenario: "compounder",
    conviction: 58,
    risk: "moderate",
    downsideGuardrail: "Licensing cash flows and modem franchise cushion handset cyclicality.",
    upsideCase: "On-device AI inference drives a Snapdragon mix and pricing tailwind through a multi-year PC/phone upgrade cycle.",
    whatMustBeTrue: [
      "Apple modem insourcing slips or stays partial.",
      "On-device AI PC + smartphone ASPs expand.",
      "Automotive/IoT segments keep scaling.",
    ],
    thesis: [
      "Dominant handset modem and licensing economics.",
      "Edge-AI positioning via Snapdragon X.",
      "Growing auto design-win backlog.",
    ],
    risks: [
      "Apple in-house modem eventually ships.",
      "China smartphone demand volatility.",
      "Licensing rate challenges recur.",
    ],
    removalTriggers: [
      "Material loss of Apple modem business earlier than expected.",
      "Licensing segment step-down on an unfavorable ruling.",
    ],
  }),
  mk({
    ticker: "INTC",
    companyName: "Intel Corporation",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    bucket: "large",
    scenario: "2x potential",
    conviction: 38,
    risk: "high",
    downsideGuardrail: "Diversified CPU franchise and foundry optionality; turnaround is the variable.",
    upsideCase: "18A process ramps on schedule and foundry wins validate the IDM 2.0 strategy.",
    whatMustBeTrue: [
      "Intel 18A yields and schedule hold.",
      "At least one marquee external foundry customer lands.",
      "Server CPU share stops bleeding to AMD/ARM.",
    ],
    thesis: [
      "Only U.S.-headquartered leading-edge fab operator.",
      "Strategic U.S./EU policy tailwinds (CHIPS).",
      "Option value if foundry works.",
    ],
    risks: [
      "Capex intensity compresses free cash flow for years.",
      "Process schedule slip is the base case historically.",
      "AMD/ARM continue share-gain in data center.",
    ],
    removalTriggers: [
      "Another material 18A slip.",
      "Foundry strategy wound down or spun off under distress.",
    ],
  }),
  mk({
    ticker: "TXN",
    companyName: "Texas Instruments Incorporated",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    bucket: "large",
    scenario: "compounder",
    conviction: 54,
    risk: "moderate",
    downsideGuardrail: "Broad analog franchise with decades-long capital return track record.",
    upsideCase: "Industrial/auto cycle turns and 300mm analog capacity ramp drives operating leverage.",
    whatMustBeTrue: [
      "Industrial/auto end-markets recover.",
      "300mm capex cycle peaks and free cash flow rebuilds.",
      "Pricing discipline holds as capacity comes on.",
    ],
    thesis: [
      "One of the highest-quality analog franchises globally.",
      "Broad portfolio dampens single end-market cycles.",
      "Disciplined dividend/buyback policy.",
    ],
    risks: [
      "Capex intensity keeps FCF muted.",
      "Industrial demand slower to recover than expected.",
      "Chinese analog competition on low end.",
    ],
    removalTriggers: [
      "Sustained inventory build through a downturn.",
      "Capex plan materially overshoots with no demand.",
    ],
  }),
  mk({
    ticker: "ADI",
    companyName: "Analog Devices, Inc.",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    bucket: "large",
    scenario: "compounder",
    conviction: 56,
    risk: "moderate",
    downsideGuardrail: "High-performance analog with durable industrial and auto exposure.",
    upsideCase: "Industrial automation and AI data-center power management drive above-cycle growth.",
    whatMustBeTrue: [
      "Industrial cycle turns.",
      "Data-center power-management share continues.",
      "Maxim integration delivers synergies.",
    ],
    thesis: [
      "Premium analog franchise with strong margins.",
      "Data-center adjacencies growing.",
      "Steady FCF and dividend compounder.",
    ],
    risks: [
      "Industrial volatility.",
      "Auto semi exposure to EV capex cycle.",
      "Competitive intensity at low end.",
    ],
    removalTriggers: [
      "Sustained operating margin compression.",
      "Material loss of data-center design wins.",
    ],
  }),
  mk({
    ticker: "MCHP",
    companyName: "Microchip Technology Incorporated",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 46,
    risk: "elevated",
    downsideGuardrail: "Broad microcontroller franchise; cycle-dependent but not binary.",
    upsideCase: "Inventory correction ends and industrial/auto orders normalise into a new cycle.",
    whatMustBeTrue: [
      "Customer inventory destocking completes.",
      "Industrial orders reaccelerate.",
      "Debt paydown continues.",
    ],
    thesis: [
      "Leading MCU franchise with broad end-market reach.",
      "Operating leverage once cycle turns.",
      "Capital return resumed post-leverage goal.",
    ],
    risks: [
      "Extended industrial downturn.",
      "Competitive pressure from Chinese MCU vendors.",
      "Debt service burden during weak quarters.",
    ],
    removalTriggers: [
      "Sustained guide cuts and margin compression.",
      "Inventory at channel remains elevated multiple quarters.",
    ],
  }),
  mk({
    ticker: "NXPI",
    companyName: "NXP Semiconductors N.V.",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    bucket: "mid",
    scenario: "compounder",
    conviction: 50,
    risk: "moderate",
    downsideGuardrail: "Auto-heavy analog/MCU franchise with strong SAM in EV/ADAS.",
    upsideCase: "Auto semi content per vehicle keeps rising with ADAS/electrification.",
    whatMustBeTrue: [
      "Auto content-per-vehicle growth continues.",
      "Industrial cycle stabilises.",
      "Share gains vs. peers in MCU/ADAS.",
    ],
    thesis: [
      "Top-3 automotive semiconductor supplier.",
      "Strong IP portfolio around secure connectivity.",
      "Leveraged to ADAS/electrification content.",
    ],
    risks: [
      "EV capex cycle slowdown.",
      "China auto semi competition.",
      "Cyclical exposure to global auto production.",
    ],
    removalTriggers: [
      "Material auto content share loss.",
      "Sustained margin compression.",
    ],
    issuerCountry: "NL",
  }),
  mk({
    ticker: "ON",
    companyName: "ON Semiconductor Corporation",
    themes: ["ai-hardware"],
    subTheme: "semiconductors",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 42,
    risk: "elevated",
    downsideGuardrail: "SiC leadership in automotive power gives multi-year design-win visibility.",
    upsideCase: "SiC adoption in EV powertrain and grid inverters re-accelerates industrial growth.",
    whatMustBeTrue: [
      "EV SiC ramp continues.",
      "Industrial/renewable demand reaccelerates.",
      "Gross margin rebuild from current trough.",
    ],
    thesis: [
      "Top-tier SiC supplier with long-term supply agreements.",
      "Diversification out of legacy image sensor cycles.",
      "Operating leverage on SiC mix.",
    ],
    risks: [
      "EV demand slower than expected.",
      "SiC competition from Wolfspeed/Infineon.",
      "Inventory correction duration.",
    ],
    removalTriggers: [
      "Sustained SiC design-win losses.",
      "EV powertrain volumes step down for multiple quarters.",
    ],
  }),
  mk({
    ticker: "WDC",
    companyName: "Western Digital Corporation",
    themes: ["ai-hardware"],
    subTheme: "memory",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 44,
    risk: "elevated",
    downsideGuardrail: "Planned business separation surfaces HDD cash flows from NAND cyclicality.",
    upsideCase: "HDD nearline demand from AI data-center storage keeps pricing tight through 2026.",
    whatMustBeTrue: [
      "Nearline HDD demand from hyperscalers continues.",
      "Separation completes and markets re-rate both pieces.",
      "NAND pricing stabilises or recovers.",
    ],
    thesis: [
      "HDD duopolist with Seagate on nearline.",
      "Event-driven catalyst from separation.",
      "Leveraged to hyperscaler storage capex.",
    ],
    risks: [
      "NAND downturn deeper than expected.",
      "Separation delays or unfavorable mix.",
      "SSD substitution in nearline longer-term.",
    ],
    removalTriggers: [
      "Deal process breaks or deal value destructive.",
      "Nearline HDD share loss to Seagate.",
    ],
  }),
  mk({
    ticker: "STX",
    companyName: "Seagate Technology Holdings plc",
    themes: ["ai-hardware"],
    subTheme: "memory",
    bucket: "mid",
    scenario: "compounder",
    conviction: 50,
    risk: "moderate",
    downsideGuardrail: "HDD duopoly with Western Digital; HAMR ramp creates price/capacity lever.",
    upsideCase: "HAMR ramps smoothly and AI data-center storage demand keeps nearline utilisation tight.",
    whatMustBeTrue: [
      "HAMR qualification and yield hold.",
      "Nearline HDD demand stays elevated.",
      "Pricing discipline holds across the duopoly.",
    ],
    thesis: [
      "Duopoly economics in HDD.",
      "HAMR leadership extends TAM per platter.",
      "Steady capital return.",
    ],
    risks: [
      "HAMR technical slips.",
      "SSD substitution cannibalises long-term.",
      "Hyperscaler buying pauses.",
    ],
    removalTriggers: [
      "HAMR ramp issues materially delay cash flow.",
      "Sustained share loss to WDC.",
    ],
    issuerCountry: "IE",
  }),
  mk({
    ticker: "TER",
    companyName: "Teradyne, Inc.",
    themes: ["ai-hardware"],
    subTheme: "semi-equipment",
    bucket: "mid",
    scenario: "compounder",
    conviction: 52,
    risk: "moderate",
    downsideGuardrail: "Dominant semi test franchise; SOC and HBM test benefit from AI accelerators.",
    upsideCase: "AI accelerator and HBM test intensity drive SOC test share and pricing expansion.",
    whatMustBeTrue: [
      "AI accelerator test intensity continues to rise.",
      "HBM test demand stays elevated.",
      "Robotics segment stabilises.",
    ],
    thesis: [
      "Top-2 SOC test franchise.",
      "HBM test levered to AI memory cycle.",
      "Robotics optionality (UR, MiR).",
    ],
    risks: [
      "Capex timing lumpiness.",
      "Mobile test share competition with Advantest.",
      "Robotics drag on margins.",
    ],
    removalTriggers: [
      "Material SOC share loss.",
      "Sustained robotics unit economics deterioration.",
    ],
  }),
  mk({
    ticker: "ONTO",
    companyName: "Onto Innovation Inc.",
    themes: ["ai-hardware"],
    subTheme: "semi-equipment",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 48,
    risk: "elevated",
    downsideGuardrail: "Advanced-packaging inspection is a structural beneficiary of HBM/chiplets.",
    upsideCase: "HBM and advanced-packaging complexity drive a multi-year inspection tool cycle.",
    whatMustBeTrue: [
      "HBM bit-growth continues.",
      "Advanced packaging node transitions add inspection steps.",
      "Customer concentration risk remains manageable.",
    ],
    thesis: [
      "Pure-play leverage to advanced packaging and HBM.",
      "Margin expansion on higher-mix tool sales.",
      "Share gains in process control.",
    ],
    risks: [
      "Concentration in a few customers.",
      "Order lumpiness.",
      "Memory capex cycle volatility.",
    ],
    removalTriggers: [
      "Sustained bookings deceleration.",
      "Loss of a marquee HBM qualification.",
    ],
  }),
  mk({
    ticker: "AEHR",
    companyName: "Aehr Test Systems",
    themes: ["ai-hardware"],
    subTheme: "semi-equipment",
    bucket: "micro",
    scenario: "5x potential",
    conviction: 28,
    risk: "very high",
    downsideGuardrail: "Position size should reflect single-customer/single-product concentration risk.",
    upsideCase: "Silicon carbide wafer-level burn-in becomes a standard step for EV power semis.",
    whatMustBeTrue: [
      "SiC adoption in auto continues.",
      "New customers diversify beyond original SiC anchor.",
      "Packaged-part burn-in expansion lands.",
    ],
    thesis: [
      "Niche leader in wafer-level burn-in for SiC.",
      "Large TAM relative to current run-rate.",
      "Optionality in AI processor burn-in.",
    ],
    risks: [
      "Customer concentration.",
      "EV cycle-sensitive bookings.",
      "Execution risk on new product lines.",
    ],
    removalTriggers: [
      "Anchor customer order air pocket beyond a quarter.",
      "Failed expansion into new product families.",
    ],
    confidence: "approximate",
    sourceSuffix: "Highly speculative micro-cap.",
  }),
  mk({
    ticker: "CIEN",
    companyName: "Ciena Corporation",
    themes: ["ai-hardware"],
    subTheme: "optical",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 46,
    risk: "elevated",
    downsideGuardrail: "Coherent optical franchise serves hyperscaler DCI and carrier upgrade cycles.",
    upsideCase: "Pluggable coherent and 800G DCI ramp drive a multi-year optical transport refresh.",
    whatMustBeTrue: [
      "Hyperscaler DCI orders re-accelerate.",
      "800G+ coherent adoption continues.",
      "Carrier capex stabilises.",
    ],
    thesis: [
      "Top-tier coherent optical DSP/systems vendor.",
      "Leveraged to AI datacenter interconnect.",
      "Pluggable TAM expansion.",
    ],
    risks: [
      "Lumpy hyperscaler ordering.",
      "Nokia/Infinera (now Nokia) competition.",
      "Carrier capex pressure.",
    ],
    removalTriggers: [
      "Sustained DCI share loss.",
      "Multiple quarters of guide cuts.",
    ],
  }),
  mk({
    ticker: "JNPR",
    companyName: "Juniper Networks, Inc.",
    themes: ["ai-hardware"],
    subTheme: "networking",
    bucket: "mid",
    scenario: "defensive",
    conviction: 42,
    risk: "moderate",
    downsideGuardrail: "HPE acquisition provides a strategic floor pending regulatory outcome.",
    upsideCase: "AI networking portfolio (Apstra, Mist) accelerates inside a larger distribution footprint.",
    whatMustBeTrue: [
      "HPE deal closes on expected terms.",
      "AI-native networking (Mist/Apstra) continues to grow.",
      "Enterprise campus refresh cycle continues.",
    ],
    thesis: [
      "Scarce AI-native campus/WAN vendor.",
      "Deal-driven floor on the stock.",
      "Mist AIOps differentiation.",
    ],
    risks: [
      "Deal closing risk on antitrust.",
      "Service provider capex pressure.",
      "Cisco competitive intensity.",
    ],
    removalTriggers: [
      "Deal breaks on regulatory grounds.",
      "AI/campus share loss.",
    ],
  }),
  mk({
    ticker: "CSCO",
    companyName: "Cisco Systems, Inc.",
    themes: ["ai-hardware"],
    subTheme: "networking",
    bucket: "mega",
    scenario: "defensive",
    conviction: 52,
    risk: "moderate",
    downsideGuardrail: "Large recurring software mix (Splunk, subscriptions) underpins cash flow.",
    upsideCase: "AI Ethernet fabric (Silicon One) and Splunk cross-sell drive a multi-year product/software reacceleration.",
    whatMustBeTrue: [
      "Splunk integration executes well.",
      "Ethernet wins AI networking share vs. InfiniBand.",
      "Enterprise refresh cycle continues.",
    ],
    thesis: [
      "Scale leader in enterprise networking.",
      "Splunk adds meaningful ARR and cyber overlap.",
      "Attractive capital return profile.",
    ],
    risks: [
      "White-box/Arista competition in data center.",
      "Service provider spending remains soft.",
      "AI networking share unproven at scale.",
    ],
    removalTriggers: [
      "Sustained core switching share loss.",
      "Splunk integration disappointment.",
    ],
  }),
  mk({
    ticker: "COHR",
    companyName: "Coherent Corp.",
    themes: ["ai-hardware"],
    subTheme: "optical",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 46,
    risk: "elevated",
    downsideGuardrail: "Datacom transceiver share and industrial laser breadth cushion cycle volatility.",
    upsideCase: "800G/1.6T transceiver ramp and silicon photonics design-ins accelerate datacom.",
    whatMustBeTrue: [
      "800G+ transceiver ramp continues.",
      "Debt paydown continues post II-VI deal.",
      "Industrial laser end-markets stabilise.",
    ],
    thesis: [
      "Top-tier datacom optical vendor.",
      "Vertical integration in InP/SiPh.",
      "Deleveraging narrative.",
    ],
    risks: [
      "Hyperscaler inventory digestion.",
      "Chinese datacom pricing pressure.",
      "Industrial segment softness.",
    ],
    removalTriggers: [
      "Sustained datacom share loss.",
      "Leverage path stalls.",
    ],
  }),
  mk({
    ticker: "LITE",
    companyName: "Lumentum Holdings Inc.",
    themes: ["ai-hardware"],
    subTheme: "optical",
    bucket: "small",
    scenario: "2x potential",
    conviction: 38,
    risk: "elevated",
    downsideGuardrail: "Laser and 3D sensing footprint provide a base while datacom ramps.",
    upsideCase: "EMLs and CW lasers for AI transceivers drive a multi-year datacom cycle.",
    whatMustBeTrue: [
      "AI transceiver EML/CW laser demand continues.",
      "Cloud Light acquisition contributes as expected.",
      "3D sensing content at key smartphone customer stabilises.",
    ],
    thesis: [
      "Critical laser supplier to AI transceivers.",
      "Vertical integration from chip to module.",
      "Operating leverage if datacom mix rises.",
    ],
    risks: [
      "Customer concentration in smartphone 3D sensing.",
      "Competitive pressure in EMLs.",
      "Datacom bookings timing.",
    ],
    removalTriggers: [
      "Sustained laser share loss to peers.",
      "Guide cuts across consecutive quarters.",
    ],
  }),
  mk({
    ticker: "FN",
    companyName: "Fabrinet",
    themes: ["ai-hardware"],
    subTheme: "optical",
    bucket: "mid",
    scenario: "compounder",
    conviction: 52,
    risk: "moderate",
    downsideGuardrail: "Contract-manufacturing model for high-mix optics is hard to replicate.",
    upsideCase: "AI transceiver volumes and NVIDIA optical content keep the order book full.",
    whatMustBeTrue: [
      "NVIDIA optical supply relationship continues.",
      "Mix of AI transceivers expands.",
      "Operational execution on capacity adds.",
    ],
    thesis: [
      "Scarce complex-optics contract manufacturer.",
      "Levered to AI transceiver ramp.",
      "Consistent operating margin.",
    ],
    risks: [
      "Customer concentration (NVIDIA, Ciena).",
      "Geographic concentration in Thailand.",
      "Order air pockets.",
    ],
    removalTriggers: [
      "Loss of a marquee optics program.",
      "Sustained demand deceleration.",
    ],
    issuerCountry: "KY",
  }),
  mk({
    ticker: "DELL",
    companyName: "Dell Technologies Inc.",
    themes: ["ai-hardware"],
    subTheme: "datacenter-hardware",
    bucket: "large",
    scenario: "compounder",
    conviction: 58,
    risk: "moderate",
    downsideGuardrail: "Scale server/storage franchise with cash-return discipline.",
    upsideCase: "AI server shipments and backlog convert to high-margin revenue through 2026.",
    whatMustBeTrue: [
      "AI server backlog converts without margin giveback.",
      "Storage franchise stabilises.",
      "Client PC refresh cycle turns.",
    ],
    thesis: [
      "Top-2 AI server OEM by dollar shipments.",
      "Broad storage and client portfolio.",
      "Disciplined capital return.",
    ],
    risks: [
      "AI server margins compress at scale.",
      "Hyperscaler ODM competition.",
      "PC cycle drags on consumer exposure.",
    ],
    removalTriggers: [
      "Sustained AI server margin compression.",
      "Material storage share loss.",
    ],
  }),
  mk({
    ticker: "HPE",
    companyName: "Hewlett Packard Enterprise Company",
    themes: ["ai-hardware"],
    subTheme: "datacenter-hardware",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 44,
    risk: "moderate",
    downsideGuardrail: "GreenLake subscription and networking (Aruba) mix supports recurring revenue.",
    upsideCase: "Juniper close expands HPE's AI networking and Aruba cross-sell meaningfully.",
    whatMustBeTrue: [
      "Juniper deal closes.",
      "AI server pipeline converts.",
      "GreenLake ARR continues growth.",
    ],
    thesis: [
      "Recurring revenue share rising via GreenLake.",
      "AI networking depth post-Juniper.",
      "Reasonable valuation vs. peers.",
    ],
    risks: [
      "Juniper close risk.",
      "AI server margin pressure.",
      "Legacy storage share losses.",
    ],
    removalTriggers: [
      "Juniper deal breaks.",
      "Material AI server mix disappointment.",
    ],
  }),
  mk({
    ticker: "NTAP",
    companyName: "NetApp, Inc.",
    themes: ["ai-hardware"],
    subTheme: "datacenter-hardware",
    bucket: "mid",
    scenario: "compounder",
    conviction: 48,
    risk: "moderate",
    downsideGuardrail: "All-flash share and public-cloud storage services cushion on-prem cycles.",
    upsideCase: "AI training/inference storage workloads and cloud-services ARR drive margin expansion.",
    whatMustBeTrue: [
      "AI storage design-wins scale.",
      "Public cloud services growth continues.",
      "All-flash share gains persist.",
    ],
    thesis: [
      "Hybrid cloud storage leader.",
      "Improving capital return profile.",
      "AI workload tailwind.",
    ],
    risks: [
      "Enterprise IT budgets.",
      "Hyperscaler storage services compete directly.",
      "Pricing pressure in flash.",
    ],
    removalTriggers: [
      "Cloud services growth stalls.",
      "Sustained all-flash share loss.",
    ],
  }),
  mk({
    ticker: "AMBA",
    companyName: "Ambarella, Inc.",
    themes: ["ai-hardware"],
    subTheme: "edge-ai",
    bucket: "small",
    scenario: "3x potential",
    conviction: 32,
    risk: "very high",
    downsideGuardrail: "Edge AI SoCs have a clear TAM in auto/security but adoption is back-weighted.",
    upsideCase: "CV3 automotive SoC design wins convert to revenue and security vision cameras restart growth.",
    whatMustBeTrue: [
      "Auto CV SoC ramp begins in earnest.",
      "Security camera end-market recovers.",
      "Cash burn narrows.",
    ],
    thesis: [
      "Pure-play edge-AI vision SoC.",
      "Large auto CV design-win backlog.",
      "Optionality on robotics/drones.",
    ],
    risks: [
      "Auto design-win slippage.",
      "Cash burn if revenue delays further.",
      "Competition from Mobileye/Qualcomm/NVIDIA.",
    ],
    removalTriggers: [
      "Multiple quarters of auto design-win pushouts.",
      "Gross margin compression below target band.",
    ],
    confidence: "approximate",
    sourceSuffix: "Speculative small-cap.",
  }),

  // ───────── Extended AI Software ─────────
  mk({
    ticker: "AMZN",
    companyName: "Amazon.com, Inc.",
    themes: ["ai-software"],
    subTheme: "hyperscalers",
    bucket: "mega",
    scenario: "compounder",
    conviction: 76,
    risk: "moderate",
    downsideGuardrail: "AWS scale and ads growth support profitability through retail cycles.",
    upsideCase: "AWS Bedrock/Trainium AI services reaccelerate cloud growth and margin.",
    whatMustBeTrue: [
      "AWS growth reaccelerates on AI workloads.",
      "Ads segment maintains double-digit growth.",
      "Retail margins stay disciplined.",
    ],
    thesis: [
      "Dominant cloud + ads + retail flywheel.",
      "Trainium/Inferentia AI silicon option.",
      "Strong FCF recovery underway.",
    ],
    risks: [
      "AWS share loss to Azure/Google on AI.",
      "Retail consumer slowdown.",
      "Regulatory scrutiny.",
    ],
    removalTriggers: [
      "AWS growth stalls below hyperscaler peers for multiple quarters.",
      "Ads segment decelerates materially.",
    ],
  }),
  mk({
    ticker: "CFLT",
    companyName: "Confluent, Inc.",
    themes: ["ai-software"],
    subTheme: "data-platforms",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 46,
    risk: "elevated",
    downsideGuardrail: "Category-defining streaming platform; consumption/cash-based revenue model.",
    upsideCase: "Flink plus real-time data for AI inference pipelines drives ACV expansion.",
    whatMustBeTrue: [
      "Consumption growth reaccelerates.",
      "Flink adoption scales alongside Kafka.",
      "Operating leverage improves.",
    ],
    thesis: [
      "De facto managed Kafka + Flink platform.",
      "Real-time data for AI is a clear adjacency.",
      "Improving operating margin trajectory.",
    ],
    risks: [
      "AWS MSK + Kinesis competition.",
      "Consumption headwinds in downturn.",
      "FCF still early.",
    ],
    removalTriggers: [
      "Sustained net-expansion deceleration.",
      "Material margin re-compression.",
    ],
  }),
  mk({
    ticker: "TEAM",
    companyName: "Atlassian Corporation",
    themes: ["ai-software"],
    subTheme: "developer-tools",
    bucket: "large",
    scenario: "compounder",
    conviction: 54,
    risk: "moderate",
    downsideGuardrail: "Strong dev-tools franchise; Cloud migration tail provides revenue visibility.",
    upsideCase: "Rovo AI monetisation and enterprise mix drive ARPU expansion.",
    whatMustBeTrue: [
      "Cloud migration cohort continues.",
      "Rovo and AI add-ons attach.",
      "Operating leverage improves.",
    ],
    thesis: [
      "Dev collaboration leader (Jira, Confluence, Bitbucket).",
      "Enterprise move-up cycle.",
      "AI monetisation optionality.",
    ],
    risks: [
      "Competitive pressure (Linear, Notion).",
      "Seat-count sensitivity to tech employment.",
      "AI monetisation slower than hoped.",
    ],
    removalTriggers: [
      "Net-dollar retention slips materially.",
      "Cloud migration tail stalls.",
    ],
    issuerCountry: "US",
  }),
  mk({
    ticker: "ESTC",
    companyName: "Elastic N.V.",
    themes: ["ai-software"],
    subTheme: "data-platforms",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 44,
    risk: "elevated",
    downsideGuardrail: "Open-source-anchored search/observability with enterprise adoption.",
    upsideCase: "Elasticsearch relevance for vector search and RAG drives new workloads.",
    whatMustBeTrue: [
      "Vector/search-relevance adoption expands.",
      "Observability cohort growth reaccelerates.",
      "Cloud mix continues to grow.",
    ],
    thesis: [
      "Scarce open-source enterprise search/observability.",
      "AI/vector search tailwind.",
      "Improving FCF profile.",
    ],
    risks: [
      "Pinecone/Weaviate competition in vector.",
      "Budget scrutiny slows bookings.",
      "Leadership churn risk.",
    ],
    removalTriggers: [
      "Sustained growth deceleration below peers.",
      "Cloud mix growth stalls.",
    ],
    issuerCountry: "NL",
  }),
  mk({
    ticker: "PANW",
    companyName: "Palo Alto Networks, Inc.",
    themes: ["ai-software"],
    subTheme: "cybersecurity",
    bucket: "large",
    scenario: "compounder",
    conviction: 64,
    risk: "moderate",
    downsideGuardrail: "Platformization strategy and strong FCF underpin durable compounding.",
    upsideCase: "AI-driven SOC (XSIAM) and platformization drive share gains across security stacks.",
    whatMustBeTrue: [
      "XSIAM adoption continues.",
      "Platformization RPO growth holds.",
      "FCF margins remain best-in-class.",
    ],
    thesis: [
      "Top-tier security platform.",
      "AI-native SOC differentiation.",
      "Best-in-class capital efficiency.",
    ],
    risks: [
      "Deal bundling compresses margins short-term.",
      "Competitive intensity from CRWD/ZS/MSFT.",
      "Enterprise budget scrutiny.",
    ],
    removalTriggers: [
      "Sustained RPO growth deceleration.",
      "Material FCF margin step-down.",
    ],
  }),
  mk({
    ticker: "ZS",
    companyName: "Zscaler, Inc.",
    themes: ["ai-software"],
    subTheme: "cybersecurity",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 52,
    risk: "elevated",
    downsideGuardrail: "SASE/ZTNA tailwinds underpin multi-year growth despite competitive heat.",
    upsideCase: "AI-driven ZTNA and expanded platform modules reaccelerate net-new customer growth.",
    whatMustBeTrue: [
      "Zero Trust adoption continues.",
      "AI features attach to platform.",
      "Operating margin discipline holds.",
    ],
    thesis: [
      "Pure-play Zero Trust platform.",
      "Strong net retention.",
      "Improving operating leverage.",
    ],
    risks: [
      "PANW/MSFT SASE competition.",
      "Enterprise deal cycles elongate.",
      "Mix shift pressures gross margin.",
    ],
    removalTriggers: [
      "Net-dollar retention slips materially.",
      "Competitive displacement losses.",
    ],
  }),
  mk({
    ticker: "FTNT",
    companyName: "Fortinet, Inc.",
    themes: ["ai-software"],
    subTheme: "cybersecurity",
    bucket: "large",
    scenario: "compounder",
    conviction: 56,
    risk: "moderate",
    downsideGuardrail: "Appliance install base + high-margin services support cash generation.",
    upsideCase: "SecOps/SASE portfolio drives software mix growth and operating leverage.",
    whatMustBeTrue: [
      "Billings growth reaccelerates.",
      "SecOps/SASE attach rates rise.",
      "Operating margin discipline holds.",
    ],
    thesis: [
      "Integrated security platform with hardware moat.",
      "Strong FCF generation.",
      "Capital return discipline.",
    ],
    risks: [
      "Appliance refresh cycle timing.",
      "Platform competition with PANW/CRWD.",
      "SMB pricing pressure.",
    ],
    removalTriggers: [
      "Billings deceleration persists.",
      "Margin compression sustained.",
    ],
  }),
  mk({
    ticker: "OKTA",
    companyName: "Okta, Inc.",
    themes: ["ai-software"],
    subTheme: "cybersecurity",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 40,
    risk: "elevated",
    downsideGuardrail: "Scale identity franchise; ARR base dampens growth volatility.",
    upsideCase: "Identity threat protection and governance modules drive upsell and share gains.",
    whatMustBeTrue: [
      "Security incidents remediated without customer loss.",
      "New governance modules attach.",
      "Operating leverage continues.",
    ],
    thesis: [
      "Independent identity platform at scale.",
      "Broad integration ecosystem.",
      "Improving FCF.",
    ],
    risks: [
      "Microsoft Entra competition.",
      "Security-incident trust cost.",
      "Enterprise budget pressure.",
    ],
    removalTriggers: [
      "Net-new customer growth stalls.",
      "Material margin reversal.",
    ],
  }),
  mk({
    ticker: "S",
    companyName: "SentinelOne, Inc.",
    themes: ["ai-software"],
    subTheme: "cybersecurity",
    bucket: "small",
    scenario: "3x potential",
    conviction: 34,
    risk: "high",
    downsideGuardrail: "Autonomous EDR/XDR platform with strong net retention and improving cash burn.",
    upsideCase: "AI-native SOC (Purple AI) and platform expansion drive ARR acceleration.",
    whatMustBeTrue: [
      "Purple AI adoption ramps.",
      "FCF breakeven trajectory holds.",
      "Net retention remains healthy.",
    ],
    thesis: [
      "AI-native endpoint platform.",
      "Expanding XDR footprint.",
      "Improving unit economics.",
    ],
    risks: [
      "CRWD competitive intensity.",
      "Cash burn duration.",
      "SMB churn sensitivity.",
    ],
    removalTriggers: [
      "Sustained NRR decline.",
      "Pathway to FCF breakeven slips materially.",
    ],
  }),
  mk({
    ticker: "NET",
    companyName: "Cloudflare, Inc.",
    themes: ["ai-software"],
    subTheme: "cybersecurity",
    bucket: "mid",
    scenario: "3x potential",
    conviction: 48,
    risk: "elevated",
    downsideGuardrail: "Edge/Workers platform plus Zero Trust suite layered on global network.",
    upsideCase: "AI inference at the edge (Workers AI) becomes a meaningful new workload monetisation.",
    whatMustBeTrue: [
      "Workers AI adoption accelerates.",
      "Large enterprise cohort growth continues.",
      "Operating leverage improves.",
    ],
    thesis: [
      "Global edge network platform.",
      "Expanding Zero Trust + AI inference TAM.",
      "Developer-led distribution.",
    ],
    risks: [
      "Hyperscaler edge competition.",
      "Consumption growth volatility.",
      "High valuation sensitivity.",
    ],
    removalTriggers: [
      "Net retention slips materially.",
      "Workers AI traction stalls.",
    ],
  }),
  mk({
    ticker: "PATH",
    companyName: "UiPath Inc.",
    themes: ["ai-software"],
    subTheme: "automation",
    bucket: "small",
    scenario: "3x potential",
    conviction: 30,
    risk: "high",
    downsideGuardrail: "Balance sheet strong; AI-augmented automation TAM still large despite execution stumbles.",
    upsideCase: "Agentic automation with LLMs revitalises new-logo and net expansion.",
    whatMustBeTrue: [
      "Agentic/AI automation attaches.",
      "Net retention rebuilds.",
      "Operating leverage improves.",
    ],
    thesis: [
      "RPA share leader repositioning toward agents.",
      "Net-cash balance sheet.",
      "Operating margin discipline improving.",
    ],
    risks: [
      "Microsoft Power Automate competition.",
      "Execution missteps in go-to-market.",
      "Agentic AI disrupting classic RPA.",
    ],
    removalTriggers: [
      "ARR growth stalls again.",
      "Sustained operating margin compression.",
    ],
  }),
  mk({
    ticker: "WDAY",
    companyName: "Workday, Inc.",
    themes: ["ai-software"],
    subTheme: "enterprise-apps",
    bucket: "large",
    scenario: "compounder",
    conviction: 58,
    risk: "moderate",
    downsideGuardrail: "Durable HCM/financials SaaS with strong gross retention.",
    upsideCase: "Agentic AI + financials expansion drive platform ARR growth and margin expansion.",
    whatMustBeTrue: [
      "Financials franchise continues share gain.",
      "AI features monetise.",
      "Operating leverage continues.",
    ],
    thesis: [
      "Leading HCM, growing financials.",
      "Durable recurring revenue.",
      "AI-driven agent optionality.",
    ],
    risks: [
      "Deal cycles elongate.",
      "Pricing pressure on AI add-ons.",
      "Competitive intensity from Oracle/SAP.",
    ],
    removalTriggers: [
      "Subscription revenue growth decelerates below peers.",
      "Margin re-compression.",
    ],
  }),
  mk({
    ticker: "INTU",
    companyName: "Intuit Inc.",
    themes: ["ai-software"],
    subTheme: "enterprise-apps",
    bucket: "mega",
    scenario: "compounder",
    conviction: 62,
    risk: "moderate",
    downsideGuardrail: "Dominant SMB financial software with strong gross margins.",
    upsideCase: "Intuit Assist (GenAI) drives ARPU and mid-market share gains.",
    whatMustBeTrue: [
      "Intuit Assist drives measurable adoption.",
      "Mailchimp rebuild delivers.",
      "QuickBooks Online continues growth.",
    ],
    thesis: [
      "SMB accounting/tax dominant franchise.",
      "AI-driven ARPU expansion.",
      "Mid-market optionality.",
    ],
    risks: [
      "Free-file tax risk.",
      "Consumer segment volatility.",
      "Competition in mid-market.",
    ],
    removalTriggers: [
      "QBO growth slows materially.",
      "AI monetisation disappoints.",
    ],
  }),
  mk({
    ticker: "HUBS",
    companyName: "HubSpot, Inc.",
    themes: ["ai-software"],
    subTheme: "enterprise-apps",
    bucket: "large",
    scenario: "compounder",
    conviction: 54,
    risk: "moderate",
    downsideGuardrail: "SMB-focused CRM franchise with high gross retention and strong brand.",
    upsideCase: "AI-powered go-to-market features and multi-hub attach drive ARPU expansion.",
    whatMustBeTrue: [
      "AI feature monetisation attaches.",
      "Multi-hub adoption continues.",
      "Operating leverage improves.",
    ],
    thesis: [
      "Leader in SMB/mid-market CRM + marketing.",
      "AI-native product roadmap.",
      "Expanding into content/service hubs.",
    ],
    risks: [
      "SMB budget pressure.",
      "Salesforce/MSFT mid-market encroachment.",
      "Seat-based headwinds.",
    ],
    removalTriggers: [
      "Net retention slips materially.",
      "ARR growth decelerates below peers.",
    ],
  }),
  mk({
    ticker: "GTLB",
    companyName: "GitLab Inc.",
    themes: ["ai-software"],
    subTheme: "developer-tools",
    bucket: "small",
    scenario: "2x potential",
    conviction: 38,
    risk: "elevated",
    downsideGuardrail: "Integrated DevSecOps platform; AI feature layer adds monetisation lever.",
    upsideCase: "Duo AI add-ons and enterprise security modules drive ARR per customer expansion.",
    whatMustBeTrue: [
      "Duo/AI features attach at scale.",
      "Net expansion rebuilds.",
      "Path to FCF breakeven holds.",
    ],
    thesis: [
      "Integrated DevSecOps platform.",
      "AI-powered software development tailwind.",
      "Improving operating leverage.",
    ],
    risks: [
      "Microsoft GitHub Copilot competitive intensity.",
      "Seat-count pressure in tech employment slumps.",
      "Feature commoditisation risk.",
    ],
    removalTriggers: [
      "Net retention slips further.",
      "Operating loss widens unexpectedly.",
    ],
  }),
  mk({
    ticker: "DOCN",
    companyName: "DigitalOcean Holdings, Inc.",
    themes: ["ai-software"],
    subTheme: "developer-tools",
    bucket: "small",
    scenario: "2x potential",
    conviction: 34,
    risk: "elevated",
    downsideGuardrail: "Profitable cloud challenger focused on SMB/startup developers.",
    upsideCase: "Paperspace GPU cloud and managed AI services reaccelerate revenue growth.",
    whatMustBeTrue: [
      "GPU/AI workloads scale on platform.",
      "Core cloud growth stabilises.",
      "FCF margin holds.",
    ],
    thesis: [
      "SMB-focused cloud with profitable unit economics.",
      "AI-platform optionality.",
      "Disciplined capital allocation.",
    ],
    risks: [
      "Hyperscaler SMB encroachment.",
      "AI capacity/demand mismatch.",
      "SMB churn sensitivity.",
    ],
    removalTriggers: [
      "Core revenue growth stalls.",
      "AI workload traction disappoints.",
    ],
  }),
  mk({
    ticker: "IBM",
    companyName: "International Business Machines Corporation",
    themes: ["ai-software"],
    subTheme: "ai-apps",
    bucket: "large",
    scenario: "defensive",
    conviction: 46,
    risk: "moderate",
    downsideGuardrail: "Large services + software mix and dividend support yield-sensitive investors.",
    upsideCase: "watsonx enterprise AI platform and HashiCorp integration drive software growth.",
    whatMustBeTrue: [
      "watsonx revenue contribution scales.",
      "HashiCorp integration executes.",
      "Consulting growth stabilises.",
    ],
    thesis: [
      "Scale enterprise AI and hybrid cloud franchise.",
      "Capital-return discipline.",
      "Meaningful deal-flow optionality.",
    ],
    risks: [
      "Consulting cyclicality.",
      "Hyperscaler AI competition.",
      "Integration execution risk.",
    ],
    removalTriggers: [
      "Software segment growth stalls.",
      "FCF path deteriorates.",
    ],
  }),
  mk({
    ticker: "BBAI",
    companyName: "BigBear.ai Holdings, Inc.",
    themes: ["ai-software"],
    subTheme: "ai-apps",
    bucket: "micro",
    scenario: "5x potential",
    conviction: 18,
    risk: "very high",
    downsideGuardrail: "Position size should reflect going-concern risk and customer-concentration exposure.",
    upsideCase: "Defense/intel AI contracts scale and the company reaches operating breakeven.",
    whatMustBeTrue: [
      "Government contract wins convert to revenue.",
      "Cash burn narrows materially.",
      "Share issuance doesn't dilute upside further.",
    ],
    thesis: [
      "AI-for-government niche with long sales cycles.",
      "Potential re-rating on contract wins.",
      "Leverage to defense AI spending.",
    ],
    risks: [
      "Persistent operating losses.",
      "Dilutive financings.",
      "Customer concentration.",
    ],
    removalTriggers: [
      "Revenue growth stalls.",
      "Going-concern language resurfaces.",
    ],
    confidence: "approximate",
    sourceSuffix: "Highly speculative micro-cap.",
  }),
  mk({
    ticker: "VEEV",
    companyName: "Veeva Systems Inc.",
    themes: ["ai-software"],
    subTheme: "vertical-software",
    bucket: "large",
    scenario: "compounder",
    conviction: 58,
    risk: "moderate",
    downsideGuardrail: "Sticky life-sciences vertical SaaS with high gross retention.",
    upsideCase: "Vault Basics and AI-driven clinical/R&D modules reaccelerate growth.",
    whatMustBeTrue: [
      "Core life-sciences franchise stays dominant.",
      "New AI modules attach.",
      "Operating leverage continues.",
    ],
    thesis: [
      "Category-defining vertical SaaS in life sciences.",
      "Structural R&D digitisation tailwind.",
      "High-margin recurring revenue.",
    ],
    risks: [
      "SFDC platform transition execution.",
      "Pharma R&D budget cycles.",
      "Competitive intensity.",
    ],
    removalTriggers: [
      "NRR/RPO growth step-down.",
      "Material churn from top 20 customers.",
    ],
  }),
  mk({
    ticker: "TYL",
    companyName: "Tyler Technologies, Inc.",
    themes: ["ai-software"],
    subTheme: "vertical-software",
    bucket: "mid",
    scenario: "compounder",
    conviction: 54,
    risk: "low",
    downsideGuardrail: "Public-sector SaaS with long contract cycles and low churn.",
    upsideCase: "State/local cloud migration and payments monetisation drive durable growth.",
    whatMustBeTrue: [
      "SaaS transition continues.",
      "Payments attach rate rises.",
      "Operating margin continues expansion.",
    ],
    thesis: [
      "Dominant public-sector SaaS franchise.",
      "Ultra-low customer churn.",
      "Payments + AI optionality.",
    ],
    risks: [
      "Public-sector budget cycles.",
      "M&A integration risk.",
      "Valuation premium versus peers.",
    ],
    removalTriggers: [
      "SaaS mix transition stalls.",
      "Sustained bookings deceleration.",
    ],
  }),

  // ───────── Extended AI Energy ─────────
  mk({
    ticker: "BWXT",
    companyName: "BWX Technologies, Inc.",
    themes: ["ai-energy"],
    subTheme: "nuclear",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 56,
    risk: "moderate",
    downsideGuardrail: "Government/naval nuclear franchise provides revenue base independent of SMR timing.",
    upsideCase: "Advanced reactor component manufacturing and SMR orders add a commercial growth leg.",
    whatMustBeTrue: [
      "U.S. naval program remains steady.",
      "SMR component orders scale.",
      "Medical isotopes segment grows.",
    ],
    thesis: [
      "Sole-source naval nuclear propulsion supplier.",
      "Advanced reactor components leverage.",
      "Visible long-cycle backlog.",
    ],
    risks: [
      "Government budget cycles.",
      "SMR commercial deployment timing.",
      "Project execution risk.",
    ],
    removalTriggers: [
      "Naval program funding reduction.",
      "Material SMR component order slippage.",
    ],
  }),
  mk({
    ticker: "CCJ",
    companyName: "Cameco Corporation",
    themes: ["ai-energy"],
    subTheme: "uranium",
    bucket: "large",
    scenario: "compounder",
    conviction: 58,
    risk: "moderate",
    downsideGuardrail: "Top-tier uranium producer with Westinghouse downstream exposure.",
    upsideCase: "Uranium price strength and reactor newbuilds drive long-cycle contracting and Westinghouse growth.",
    whatMustBeTrue: [
      "Uranium contracting continues at higher prices.",
      "Westinghouse services perform.",
      "Production ramps without cost overruns.",
    ],
    thesis: [
      "Scarce Tier-1 uranium exposure.",
      "Westinghouse adds reactor-services leg.",
      "Improving balance sheet.",
    ],
    risks: [
      "Uranium price volatility.",
      "Operational incidents at mines.",
      "Contract duration uncertainty.",
    ],
    removalTriggers: [
      "Production materially underdelivers.",
      "Uranium contracting rolls over.",
    ],
    issuerCountry: "CA",
  }),
  mk({
    ticker: "UEC",
    companyName: "Uranium Energy Corp.",
    themes: ["ai-energy"],
    subTheme: "uranium",
    bucket: "small",
    scenario: "3x potential",
    conviction: 36,
    risk: "high",
    downsideGuardrail: "U.S.-focused ISR producer with strategic national-security tailwind.",
    upsideCase: "Restart of U.S. ISR uranium production and strategic-reserve contracts materialise.",
    whatMustBeTrue: [
      "U.S. production restart executes.",
      "DOE strategic-reserve purchases continue.",
      "Uranium prices stay supportive.",
    ],
    thesis: [
      "Leveraged play on U.S. uranium reshoring.",
      "ISR cost-curve positioning.",
      "Optionality on vanadium/ThO2.",
    ],
    risks: [
      "Development/restart execution risk.",
      "Uranium price volatility.",
      "Permitting and capital needs.",
    ],
    removalTriggers: [
      "Restart delays extend multi-year.",
      "Strategic-reserve program curtailed.",
    ],
    confidence: "approximate",
    sourceSuffix: "Speculative small-cap.",
  }),
  mk({
    ticker: "NXE",
    companyName: "NexGen Energy Ltd.",
    themes: ["ai-energy"],
    subTheme: "uranium",
    bucket: "small",
    scenario: "5x potential",
    conviction: 30,
    risk: "very high",
    downsideGuardrail: "Pre-production; position sizing should reflect development-stage risk.",
    upsideCase: "Arrow deposit permits and reaches production into a structurally tight uranium market.",
    whatMustBeTrue: [
      "Permitting completes on schedule.",
      "Financing closes without excessive dilution.",
      "Uranium prices support capex.",
    ],
    thesis: [
      "One of the largest undeveloped high-grade uranium deposits globally.",
      "Strategic Canadian jurisdiction.",
      "Optionality on reactor newbuild cycle.",
    ],
    risks: [
      "Permitting delays.",
      "Capital-raise dilution.",
      "Single-asset development risk.",
    ],
    removalTriggers: [
      "Permitting setback.",
      "Financing terms destroy upside.",
    ],
    issuerCountry: "CA",
    confidence: "approximate",
    sourceSuffix: "Pre-production speculative.",
  }),
  mk({
    ticker: "AEP",
    companyName: "American Electric Power Company, Inc.",
    themes: ["ai-energy"],
    subTheme: "utilities",
    bucket: "large",
    scenario: "defensive",
    conviction: 48,
    risk: "low",
    downsideGuardrail: "Regulated utility with large transmission-heavy footprint and clear ROE.",
    upsideCase: "Data-center driven load growth expands capex plan and regulated earnings power.",
    whatMustBeTrue: [
      "Data-center load growth sustained.",
      "Rate cases support capex plan.",
      "Regulatory frameworks stay constructive.",
    ],
    thesis: [
      "Largest U.S. transmission footprint.",
      "Load-growth tailwind supports capex.",
      "Defensive dividend profile.",
    ],
    risks: [
      "Rate-case outcomes.",
      "Interest-rate sensitivity.",
      "Coal retirement cost recovery.",
    ],
    removalTriggers: [
      "Material rate-case setbacks.",
      "Load-growth thesis weakens.",
    ],
  }),
  mk({
    ticker: "EXC",
    companyName: "Exelon Corporation",
    themes: ["ai-energy"],
    subTheme: "utilities",
    bucket: "large",
    scenario: "defensive",
    conviction: 44,
    risk: "low",
    downsideGuardrail: "Pure-play T&D utility with visible capex and rate-base growth.",
    upsideCase: "Grid modernisation and data-center load expand capex and rate base.",
    whatMustBeTrue: [
      "Illinois/PJM regulatory frameworks stay constructive.",
      "Capex plan approved as expected.",
      "Interconnection volumes continue.",
    ],
    thesis: [
      "Pure-play regulated T&D.",
      "Rate-base growth visibility.",
      "Defensive yield profile.",
    ],
    risks: [
      "Illinois regulatory decisions.",
      "Rate-case timing.",
      "Financing costs.",
    ],
    removalTriggers: [
      "Material adverse rate decisions.",
      "Capex plan materially reduced.",
    ],
  }),
  mk({
    ticker: "NRG",
    companyName: "NRG Energy, Inc.",
    themes: ["ai-energy"],
    subTheme: "ipps",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 50,
    risk: "elevated",
    downsideGuardrail: "Retail + generation mix and capital-return plan support cash flows.",
    upsideCase: "Power-price strength and data-center PPAs drive generation margin expansion.",
    whatMustBeTrue: [
      "ERCOT/PJM power prices stay firm.",
      "Hedge book converts at good prices.",
      "Capital-return plan executes.",
    ],
    thesis: [
      "Integrated power and retail franchise.",
      "Leverage to Texas data-center load.",
      "Buyback-heavy capital return.",
    ],
    risks: [
      "Commodity/power-price volatility.",
      "Retail segment competition.",
      "Regulatory/weather events.",
    ],
    removalTriggers: [
      "Sustained power-price weakness.",
      "Retail margins compress persistently.",
    ],
  }),
  mk({
    ticker: "TLN",
    companyName: "Talen Energy Corporation",
    themes: ["ai-energy"],
    subTheme: "ipps",
    bucket: "mid",
    scenario: "3x potential",
    conviction: 52,
    risk: "elevated",
    downsideGuardrail: "Susquehanna nuclear + zero-emission fleet with long-duration contract optionality.",
    upsideCase: "AWS/Amazon-style behind-the-meter PPAs and PJM power strength drive earnings power.",
    whatMustBeTrue: [
      "Behind-the-meter PPAs approved / expanded.",
      "PJM capacity prices remain firm.",
      "Nuclear fleet operates reliably.",
    ],
    thesis: [
      "Scarce zero-emission baseload with data-center co-location optionality.",
      "PJM capacity market tailwind.",
      "Event-driven contract catalysts.",
    ],
    risks: [
      "FERC/regulatory decisions on PPAs.",
      "Power-price volatility.",
      "Single-site nuclear concentration.",
    ],
    removalTriggers: [
      "Adverse regulatory ruling on BTM PPA.",
      "Sustained PJM price weakness.",
    ],
  }),
  mk({
    ticker: "HUBB",
    companyName: "Hubbell Incorporated",
    themes: ["ai-energy"],
    subTheme: "grid-equipment",
    bucket: "mid",
    scenario: "compounder",
    conviction: 54,
    risk: "moderate",
    downsideGuardrail: "Diversified electrical-products portfolio with strong utility backlog.",
    upsideCase: "Utility grid-hardening capex cycle and data-center build-outs drive durable growth.",
    whatMustBeTrue: [
      "Utility capex cycle continues.",
      "Data-center electrical demand persists.",
      "Pricing discipline holds.",
    ],
    thesis: [
      "Leveraged to utility capex super-cycle.",
      "Broad electrical-products portfolio.",
      "Consistent capital return.",
    ],
    risks: [
      "Utility order timing.",
      "Electrical commodity inputs.",
      "Competitive pressure.",
    ],
    removalTriggers: [
      "Utility capex slowdown.",
      "Sustained margin compression.",
    ],
  }),
  mk({
    ticker: "AZZ",
    companyName: "AZZ Inc.",
    themes: ["ai-energy"],
    subTheme: "grid-equipment",
    bucket: "small",
    scenario: "2x potential",
    conviction: 42,
    risk: "elevated",
    downsideGuardrail: "Metal-coatings franchise benefits from infrastructure and grid capex.",
    upsideCase: "Grid-hardening and data-center infrastructure drive coatings and electrical demand.",
    whatMustBeTrue: [
      "Infrastructure/grid capex cycle continues.",
      "Precoat metals segment executes.",
      "Debt paydown continues.",
    ],
    thesis: [
      "Specialty coatings leader.",
      "Leveraged to grid capex.",
      "Deleveraging optionality.",
    ],
    risks: [
      "Commodity price pass-through timing.",
      "Regional industrial cycles.",
      "Leverage ratio.",
    ],
    removalTriggers: [
      "Material backlog erosion.",
      "Deleveraging plan stalls.",
    ],
  }),
  mk({
    ticker: "POWL",
    companyName: "Powell Industries, Inc.",
    themes: ["ai-energy"],
    subTheme: "grid-equipment",
    bucket: "small",
    scenario: "3x potential",
    conviction: 48,
    risk: "elevated",
    downsideGuardrail: "Switchgear and electrical infrastructure benefits from industrial and utility capex.",
    upsideCase: "Data-center and LNG/industrial project backlog drives a multi-year capacity-utilisation cycle.",
    whatMustBeTrue: [
      "Backlog converts at strong margins.",
      "Data-center and LNG orders continue.",
      "Capacity expansion executes.",
    ],
    thesis: [
      "Niche electrical infrastructure leader.",
      "Leveraged to data-center power backlog.",
      "Margin expansion ongoing.",
    ],
    risks: [
      "Project execution risk.",
      "Order lumpiness.",
      "Labor and component availability.",
    ],
    removalTriggers: [
      "Sustained margin compression.",
      "Backlog growth stalls.",
    ],
  }),
  mk({
    ticker: "CARR",
    companyName: "Carrier Global Corporation",
    themes: ["ai-energy"],
    subTheme: "datacenter-power",
    bucket: "large",
    scenario: "compounder",
    conviction: 54,
    risk: "moderate",
    downsideGuardrail: "Global HVAC platform with strong aftermarket revenue.",
    upsideCase: "Data-center thermal/cooling demand plus commercial HVAC upgrades drive multi-year growth.",
    whatMustBeTrue: [
      "Data-center cooling demand continues.",
      "Commercial HVAC upgrade cycle holds.",
      "Viessmann integration executes.",
    ],
    thesis: [
      "Scale HVAC franchise.",
      "Levered to data-center thermal.",
      "Aftermarket recurring revenue.",
    ],
    risks: [
      "Residential HVAC cycle.",
      "Integration risk.",
      "Commodity costs.",
    ],
    removalTriggers: [
      "Data-center segment growth stalls.",
      "Integration synergies miss.",
    ],
  }),
  mk({
    ticker: "FLR",
    companyName: "Fluor Corporation",
    themes: ["ai-energy"],
    subTheme: "engineering",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 44,
    risk: "elevated",
    downsideGuardrail: "Large EPC backlog including nuclear/advanced-reactor exposure (NuScale).",
    upsideCase: "Data-center EPC, SMR deployment and industrial capex drive backlog and margin rebuild.",
    whatMustBeTrue: [
      "Energy/industrial capex cycle continues.",
      "NuScale deployments scale.",
      "Project execution margins improve.",
    ],
    thesis: [
      "Scale EPC leveraged to mega-projects.",
      "Optionality on SMRs via NuScale stake.",
      "Improving margin trajectory.",
    ],
    risks: [
      "Project-execution risk on fixed-price work.",
      "Commodity/labor cost inflation.",
      "SMR deployment timing.",
    ],
    removalTriggers: [
      "Recurring project write-downs.",
      "NuScale program material setback.",
    ],
  }),
  mk({
    ticker: "ACM",
    companyName: "AECOM",
    themes: ["ai-energy"],
    subTheme: "engineering",
    bucket: "mid",
    scenario: "compounder",
    conviction: 52,
    risk: "moderate",
    downsideGuardrail: "Professional-services EPC model shifts risk away from fixed-price construction.",
    upsideCase: "Infrastructure/grid and data-center design backlog expands in a multi-year upcycle.",
    whatMustBeTrue: [
      "U.S./international infrastructure capex continues.",
      "Energy transition work scales.",
      "Operating margin discipline holds.",
    ],
    thesis: [
      "Top-tier engineering services franchise.",
      "Leveraged to infrastructure super-cycle.",
      "Disciplined capital return.",
    ],
    risks: [
      "Government budget cycles.",
      "Competition on wins/margins.",
      "Geographic mix risk.",
    ],
    removalTriggers: [
      "Backlog growth stalls.",
      "Operating margin compresses materially.",
    ],
  }),
  mk({
    ticker: "MTZ",
    companyName: "MasTec, Inc.",
    themes: ["ai-energy"],
    subTheme: "engineering",
    bucket: "mid",
    scenario: "2x potential",
    conviction: 46,
    risk: "elevated",
    downsideGuardrail: "Diversified infrastructure contractor with clean energy and pipeline exposure.",
    upsideCase: "T&D upgrade cycle and clean-energy / pipeline backlog drive a multi-year margin rebuild.",
    whatMustBeTrue: [
      "T&D capex continues.",
      "Clean energy project execution improves.",
      "Pipeline segment stabilises.",
    ],
    thesis: [
      "Diversified infrastructure contractor.",
      "Levered to grid modernisation.",
      "Margin-recovery optionality.",
    ],
    risks: [
      "Project execution risk.",
      "Weather and permitting.",
      "Customer concentration.",
    ],
    removalTriggers: [
      "Sustained margin shortfalls.",
      "Backlog erosion.",
    ],
  }),
  mk({
    ticker: "FLNC",
    companyName: "Fluence Energy, Inc.",
    themes: ["ai-energy"],
    subTheme: "energy-storage",
    bucket: "small",
    scenario: "3x potential",
    conviction: 36,
    risk: "high",
    downsideGuardrail: "Backed by Siemens + AES with meaningful backlog; still pre-steady FCF.",
    upsideCase: "Grid-scale storage demand and digital-platform attach drive bookings and margin expansion.",
    whatMustBeTrue: [
      "Battery/storage deployments scale.",
      "Project margins improve.",
      "Competition from Tesla Megapack doesn't compress pricing further.",
    ],
    thesis: [
      "Pure-play grid-scale storage integrator.",
      "Large backlog and global reach.",
      "Strategic backing.",
    ],
    risks: [
      "Cell pricing volatility.",
      "Project execution and working capital.",
      "Competitive intensity.",
    ],
    removalTriggers: [
      "Sustained margin shortfalls.",
      "Backlog growth stalls.",
    ],
  }),
  mk({
    ticker: "NNE",
    companyName: "Nano Nuclear Energy Inc.",
    themes: ["ai-energy"],
    subTheme: "nuclear",
    bucket: "micro",
    scenario: "5x potential",
    conviction: 18,
    risk: "very high",
    downsideGuardrail: "Pre-revenue micro-reactor developer; position size should reflect binary outcomes.",
    upsideCase: "Micro-reactor designs reach licensing milestones and attract strategic partners.",
    whatMustBeTrue: [
      "Licensing progress continues.",
      "Capital position funds multi-year development.",
      "Strategic partnerships emerge.",
    ],
    thesis: [
      "Optionality on micro-reactor TAM.",
      "Early-stage national-security tailwind.",
      "Scarcity value among public micro-nuclear names.",
    ],
    risks: [
      "Pre-revenue with ongoing losses.",
      "Licensing uncertainty and timelines.",
      "Share-count dilution.",
    ],
    removalTriggers: [
      "Licensing setbacks.",
      "Balance-sheet distress.",
    ],
    confidence: "approximate",
    sourceSuffix: "Highly speculative micro-cap, pre-revenue.",
  }),
  mk({
    ticker: "PCG",
    companyName: "PG&E Corporation",
    themes: ["ai-energy"],
    subTheme: "utilities",
    bucket: "large",
    scenario: "2x potential",
    conviction: 42,
    risk: "elevated",
    downsideGuardrail: "Rate-base growth visibility post-reorganisation; California electrification tailwind.",
    upsideCase: "Capex plan approval and wildfire risk mitigation drive a steady re-rating.",
    whatMustBeTrue: [
      "Wildfire mitigation execution continues.",
      "Rate cases supportive.",
      "Electrification load continues.",
    ],
    thesis: [
      "Large California regulated utility.",
      "Rate-base growth runway.",
      "Re-rating path on risk mitigation.",
    ],
    risks: [
      "Wildfire liability tail.",
      "Political/regulatory risk.",
      "Customer affordability scrutiny.",
    ],
    removalTriggers: [
      "Major wildfire liability event.",
      "Adverse CPUC decisions.",
    ],
  }),
];

// Approximate AUM at time of curation (USD). Verify on issuer site.
// Used as a fallback when a live source cannot be queried.
const ETFS: StockPickEtf[] = [
  // ───────── AI Hardware ETFs ─────────
  {
    ticker: "SMH",
    name: "VanEck Semiconductor ETF",
    themes: ["ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Concentrated basket of the largest U.S.-listed semiconductor names — direct AI hardware exposure.",
    whyUseIt:
      "Simplest large-cap semis exposure; heavy weights in NVDA, TSM, AVGO capture the AI accelerator cycle.",
    tradeoffs:
      "Top-heavy concentration: a handful of names drive most of the return. Less diversified than broader tech.",
    expenseRatio: 0.35,
    aum: 27_000_000_000,
    concentrationNote: "Top 10 ~70% of fund (approximate).",
    topHoldingsNote: "Concentrated in NVDA / TSM / AVGO / AMD / ASML.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "SOXX",
    name: "iShares Semiconductor ETF",
    themes: ["ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Equal-ish weighted exposure across the largest U.S.-listed semiconductor companies.",
    whyUseIt:
      "Slightly more diversified across semis than SMH; better breadth into equipment and analog.",
    tradeoffs:
      "Still concentrated in 30 names; sensitivity to a single semi cycle remains high.",
    expenseRatio: 0.35,
    aum: 14_500_000_000,
    concentrationNote: "Top 10 ~55% of fund (approximate).",
    topHoldingsNote: "NVDA / AVGO / AMD / QCOM / TXN among top holdings.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "SOXQ",
    name: "Invesco PHLX Semiconductor ETF",
    themes: ["ai-hardware"],
    exposureType: "ETF",
    themeFit: "Lower-fee tracker for the PHLX Semiconductor Index.",
    whyUseIt:
      "Cheapest mainstream semis ETF option for buy-and-hold semis exposure.",
    tradeoffs:
      "Track-record is shorter than SOXX/SMH; otherwise broadly similar exposure profile.",
    expenseRatio: 0.19,
    aum: 1_200_000_000,
    concentrationNote: "Top 10 ~55% of fund (approximate).",
    topHoldingsNote: "Heaviest weights in NVDA / AVGO / AMD.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "PSI",
    name: "Invesco Semiconductors ETF",
    themes: ["ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Dynamic factor-weighted semis basket — quality/value tilt vs cap-weight SMH/SOXX.",
    whyUseIt:
      "Methodology rotates into stronger semis fundamentals; useful diversifier from cap-weighted SMH.",
    tradeoffs:
      "Smaller fund, higher expense; tracking error vs SOX index can be material.",
    expenseRatio: 0.57,
    aum: 700_000_000,
    concentrationNote: "~30 holdings; factor weighting reduces top-name dominance.",
    topHoldingsNote: "Rotates; commonly holds NVDA / AVGO / KLAC / LRCX / AMAT.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "BOTZ",
    name: "Global X Robotics & Artificial Intelligence ETF",
    themes: ["ai-hardware", "ai-software"],
    exposureType: "ETF",
    themeFit:
      "Robotics and industrial AI tilt — mixes hardware automation with some AI software names.",
    whyUseIt:
      "Diversifies beyond U.S. mega-cap semis into Japanese and European robotics leaders.",
    tradeoffs:
      "Mixed-bag exposure that does not track AI accelerator demand cleanly. Performance can lag pure semis.",
    expenseRatio: 0.69,
    aum: 2_700_000_000,
    concentrationNote: "Concentrated in Japan/U.S. robotics names.",
    topHoldingsNote: "NVDA / ISRG / KEYS / Fanuc / Keyence often appear.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "ROBO",
    name: "ROBO Global Robotics & Automation Index ETF",
    themes: ["ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Equal-weighted-ish robotics and automation basket with both pure-plays and enablers.",
    whyUseIt:
      "More equal-weighted than BOTZ; lower single-name concentration.",
    tradeoffs:
      "Equal-weighting drags during mega-cap rallies; expense ratio is higher than broad semis.",
    expenseRatio: 0.95,
    aum: 1_000_000_000,
    concentrationNote: "~80 holdings — broader than BOTZ.",
    topHoldingsNote: "Mix of industrial automation, sensors, robotics.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "QTUM",
    name: "Defiance Quantum ETF",
    themes: ["ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Companies developing quantum computing, AI compute, and adjacent advanced silicon.",
    whyUseIt:
      "Long-tail exposure to next-generation compute alongside leading-edge semis and AI hardware.",
    tradeoffs:
      "Thematic basket — quantum names are speculative; index can drift from purist quantum exposure.",
    expenseRatio: 0.4,
    aum: 1_500_000_000,
    concentrationNote: "~70 holdings; modest concentration in top 10.",
    topHoldingsNote: "Mix of semi caps, IBM/HPE, IonQ/Rigetti-style names.",
    riskLevel: "high",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "IRBO",
    name: "iShares Robotics and Artificial Intelligence Multisector ETF",
    themes: ["ai-hardware", "ai-software"],
    exposureType: "ETF",
    themeFit:
      "Equal-weighted global basket of robotics and AI companies — broader, more diversified AI exposure.",
    whyUseIt:
      "Low-fee diversifier vs concentrated thematic funds; cross-sector AI/robotics tilt.",
    tradeoffs:
      "Equal-weighting drags in mega-cap rallies; mixed AI/robotics holdings can dilute the theme.",
    expenseRatio: 0.47,
    aum: 600_000_000,
    concentrationNote: "~110 holdings; equal-weighted.",
    topHoldingsNote: "Broad mix — chipmakers, software, robotics, industrials.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "USD",
    name: "ProShares Ultra Semiconductors",
    themes: ["ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "2x daily leveraged semiconductor exposure — tactical only, not for buy-and-hold.",
    whyUseIt:
      "Short-horizon, high-conviction tactical bet on a near-term semi move. Daily reset compounds against you over time.",
    tradeoffs:
      "Leveraged daily-reset products decay in choppy markets; not appropriate for long holds.",
    expenseRatio: 0.95,
    aum: 800_000_000,
    concentrationNote: "Tracks 2x daily move of Dow Jones U.S. Semiconductors Index.",
    topHoldingsNote: "Swap exposure to a semi index; underlyings are the major semis.",
    riskLevel: "very high",
    leveraged: true,
    dataConfidence: "curated",
    sourceNote:
      CURATED_SOURCE +
      " LEVERAGED daily-reset product — for short-term tactical use only. Verify on issuer site.",
  },

  // ───────── AI / Tech / Software ETFs ─────────
  {
    ticker: "AIQ",
    name: "Global X Artificial Intelligence & Technology ETF",
    themes: ["ai-software", "ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Broad AI basket spanning chipmakers, hyperscalers, and AI-application software.",
    whyUseIt:
      "Single-ticker AI exposure that mixes hardware and software — diversified across the stack.",
    tradeoffs:
      "Holdings overlap heavily with broad tech indices; less differentiated than pure semis or pure software.",
    expenseRatio: 0.68,
    aum: 3_300_000_000,
    concentrationNote: "~80 holdings; top 10 ~40% of fund.",
    topHoldingsNote: "Mega-cap tech and major semis dominate.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "IGV",
    name: "iShares Expanded Tech-Software Sector ETF",
    themes: ["ai-software"],
    exposureType: "ETF",
    themeFit:
      "Large-cap U.S. software basket — closest mainstream proxy for AI-software exposure.",
    whyUseIt:
      "Concentrated software exposure with mega-cap tilt; benefits from broad enterprise AI adoption.",
    tradeoffs:
      "Heavy weights in MSFT/CRM/ORCL — not differentiated from S&P tech sector beta.",
    expenseRatio: 0.41,
    aum: 9_000_000_000,
    concentrationNote: "Top 10 ~55% of fund (approximate).",
    topHoldingsNote: "MSFT / ORCL / CRM / ADBE / SAP top weights.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "WCLD",
    name: "WisdomTree Cloud Computing Fund",
    themes: ["ai-software"],
    exposureType: "ETF",
    themeFit:
      "Pure-play cloud / SaaS basket — high beta exposure to AI-software workloads.",
    whyUseIt:
      "Captures smaller cloud-native names and high-growth SaaS that broader IGV misses.",
    tradeoffs:
      "High volatility; drawdowns during multiple compression are severe. Not suitable for low-risk sleeves.",
    expenseRatio: 0.45,
    aum: 360_000_000,
    concentrationNote: "Equal-weighted; ~70 holdings.",
    topHoldingsNote: "Smaller-cap SaaS, including DDOG, MDB, CRWD, SNOW.",
    riskLevel: "high",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "CLOU",
    name: "Global X Cloud Computing ETF",
    themes: ["ai-software"],
    exposureType: "ETF",
    themeFit:
      "Alternative cloud-software basket with slightly different methodology vs WCLD.",
    whyUseIt:
      "Diversifier or substitute for WCLD; meaningful exposure to mid-cap SaaS.",
    tradeoffs:
      "Overlap with WCLD/IGV; meaningful concentration in top names.",
    expenseRatio: 0.68,
    aum: 350_000_000,
    concentrationNote: "~35 holdings.",
    topHoldingsNote: "Mix of mid-cap SaaS and infrastructure.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "SKYY",
    name: "First Trust Cloud Computing ETF",
    themes: ["ai-software"],
    exposureType: "ETF",
    themeFit:
      "Cloud-computing basket spanning infrastructure providers, platforms, and SaaS.",
    whyUseIt:
      "Broader infrastructure tilt than WCLD; captures hyperscalers alongside SaaS.",
    tradeoffs:
      "Heavier mega-cap weight reduces differentiation vs broad tech.",
    expenseRatio: 0.6,
    aum: 2_600_000_000,
    concentrationNote: "~65 holdings; mid-concentration in top 10.",
    topHoldingsNote: "Mix of MSFT/AMZN/GOOGL alongside SaaS leaders.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "IYW",
    name: "iShares U.S. Technology ETF",
    themes: ["ai-software", "ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Broad U.S. tech sector — diversified AI exposure across hardware, software, and platforms.",
    whyUseIt:
      "Mainstream tech-sector access with mega-cap AI beneficiaries as top weights.",
    tradeoffs:
      "Looks more like a mega-cap tech tracker than a pure AI play; overlap with XLK/VGT.",
    expenseRatio: 0.39,
    aum: 22_000_000_000,
    concentrationNote: "Top 10 ~65% of fund.",
    topHoldingsNote: "AAPL / MSFT / NVDA / AVGO / ORCL top weights.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "XLK",
    name: "Technology Select Sector SPDR Fund",
    themes: ["ai-software", "ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "S&P 500 technology sector — heavy mega-cap AI beneficiary exposure.",
    whyUseIt:
      "Lowest-fee broad U.S. tech exposure; very liquid and tax-efficient.",
    tradeoffs:
      "Concentration in a handful of mega-caps; misses smaller AI-native names.",
    expenseRatio: 0.09,
    aum: 80_000_000_000,
    concentrationNote: "Top 10 ~65% of fund.",
    topHoldingsNote: "MSFT / NVDA / AAPL / AVGO / CRM top weights.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "VGT",
    name: "Vanguard Information Technology ETF",
    themes: ["ai-software", "ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Broad U.S. info-tech basket — diversified AI-beneficiary mega-cap exposure.",
    whyUseIt:
      "Very low-cost broad tech-sector access; deeper into mid-cap than XLK.",
    tradeoffs:
      "Heavy mega-cap weighting; less differentiated AI exposure.",
    expenseRatio: 0.1,
    aum: 95_000_000_000,
    concentrationNote: "Top 10 ~60% of fund.",
    topHoldingsNote: "AAPL / MSFT / NVDA / AVGO / CRM top weights.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },

  // ───────── Cybersecurity ─────────
  {
    ticker: "CIBR",
    name: "First Trust Nasdaq Cybersecurity ETF",
    themes: ["ai-software"],
    exposureType: "ETF",
    themeFit:
      "Cybersecurity basket — AI-driven detection and response is a major growth driver here.",
    whyUseIt:
      "Largest, most diversified pure-play cybersecurity ETF; captures CRWD / PANW / ZS exposure.",
    tradeoffs:
      "Not a clean AI proxy; performance driven by enterprise security spend cycles.",
    expenseRatio: 0.59,
    aum: 7_600_000_000,
    concentrationNote: "~30 holdings; moderate top-10 concentration.",
    topHoldingsNote: "CRWD / PANW / FTNT / ZS / CSCO often appear at top.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "HACK",
    name: "Amplify Cybersecurity ETF",
    themes: ["ai-software"],
    exposureType: "ETF",
    themeFit:
      "Alternative cybersecurity basket — slightly different weighting and constituency vs CIBR.",
    whyUseIt:
      "Diversifier or substitute for CIBR; modestly different exposure profile.",
    tradeoffs:
      "Smaller AUM and liquidity than CIBR; performance broadly tracks the same theme.",
    expenseRatio: 0.6,
    aum: 1_700_000_000,
    concentrationNote: "~50 holdings.",
    topHoldingsNote: "Broad mix of pure-play and platform security names.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "IHAK",
    name: "iShares Cybersecurity and Tech ETF",
    themes: ["ai-software"],
    exposureType: "ETF",
    themeFit:
      "Lower-fee cybersecurity basket from iShares with broader tech tilt.",
    whyUseIt:
      "Lowest-fee mainstream cybersecurity ETF; suitable as a long-term hold.",
    tradeoffs:
      "Smaller fund, less established track record than CIBR; broadly similar exposure.",
    expenseRatio: 0.47,
    aum: 900_000_000,
    concentrationNote: "~35 holdings.",
    topHoldingsNote: "CRWD / PANW / FTNT / CHKP among top holdings.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },

  // ───────── Data Center / Digital Infrastructure ─────────
  {
    ticker: "DTCR",
    name: "Global X Data Center & Digital Infrastructure ETF",
    themes: ["ai-energy", "ai-hardware"],
    exposureType: "ETF",
    themeFit:
      "Data center REITs and digital-infrastructure equities — the physical layer behind AI workloads.",
    whyUseIt:
      "Single-ticker exposure to data-center REITs (EQIX/DLR) and supporting infrastructure.",
    tradeoffs:
      "REIT-heavy mix is rate-sensitive; smaller fund with less liquidity.",
    expenseRatio: 0.5,
    aum: 70_000_000,
    concentrationNote: "~25 holdings; concentrated in top names.",
    topHoldingsNote: "Equinix, Digital Realty, tower & infrastructure names.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "VPN",
    name: "Global X Data Center & Digital Infrastructure ETF (legacy ticker)",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Data center and digital-infrastructure REIT/equity basket (note: similar mandate to DTCR).",
    whyUseIt:
      "Alternative single-ticker data-center / digital-infrastructure exposure.",
    tradeoffs:
      "Overlaps materially with DTCR; small AUM and limited liquidity.",
    expenseRatio: 0.5,
    aum: 35_000_000,
    concentrationNote: "Small fund; concentrated in REITs and tower names.",
    topHoldingsNote: "EQIX / DLR / AMT / SBAC plus international data-center exposure.",
    riskLevel: "moderate",
    dataConfidence: "approximate",
    sourceNote:
      CURATED_SOURCE +
      " Ticker mapping changed historically — confirm fund on issuer site before acting.",
  },

  // ───────── AI Energy ETFs ─────────
  {
    ticker: "URA",
    name: "Global X Uranium ETF",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Uranium miners and nuclear fuel-cycle equities — leveraged to nuclear demand for AI baseload.",
    whyUseIt:
      "Cleanest single-ticker uranium / nuclear-fuel exposure.",
    tradeoffs:
      "Highly cyclical; small-cap miner risk; dominated by a few names.",
    expenseRatio: 0.69,
    aum: 4_100_000_000,
    concentrationNote: "Top 10 ~75% of fund (approximate).",
    topHoldingsNote: "Cameco, Kazatomprom, NexGen, Sprott Physical Uranium.",
    riskLevel: "high",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "URNM",
    name: "Sprott Uranium Miners ETF",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Pure-play uranium miners basket — narrower than URA, more leveraged to uranium price.",
    whyUseIt:
      "Higher beta to uranium price than URA; suitable for tactical exposure.",
    tradeoffs:
      "Greater concentration and volatility; not a substitute for diversified energy.",
    expenseRatio: 0.75,
    aum: 1_900_000_000,
    concentrationNote: "Concentrated in pure-play miners + physical uranium.",
    topHoldingsNote: "Cameco, Kazatomprom, NexGen Energy dominate.",
    riskLevel: "very high",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "URNJ",
    name: "Sprott Junior Uranium Miners ETF",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Junior / smaller uranium miners — high-beta uranium-price proxy.",
    whyUseIt:
      "Most aggressive uranium-price exposure on offer in ETF wrappers.",
    tradeoffs:
      "Very high volatility, small-cap mining risks, fund is concentrated and illiquid relative to URA.",
    expenseRatio: 0.8,
    aum: 250_000_000,
    concentrationNote: "Concentrated in junior miners.",
    topHoldingsNote: "Smaller miners — Paladin, Denison, Energy Fuels, etc.",
    riskLevel: "very high",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "NLR",
    name: "VanEck Uranium and Nuclear ETF",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Combines uranium miners with nuclear utilities — broader nuclear value-chain exposure.",
    whyUseIt:
      "Lower volatility than URA/URNM because utility weight tempers miner cyclicality.",
    tradeoffs:
      "Utility names dilute pure uranium-price beta; less upside in a uranium rally.",
    expenseRatio: 0.61,
    aum: 1_300_000_000,
    concentrationNote: "Mix of utilities and miners (~30 holdings).",
    topHoldingsNote: "Constellation Energy, Cameco, BWX Technologies top weights.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "GRID",
    name: "First Trust NASDAQ Clean Edge Smart Grid Infrastructure Index Fund",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Grid infrastructure and electrification equities — the physical buildout behind datacenter load growth.",
    whyUseIt:
      "Single-ticker exposure to transmission, distribution, and electrical equipment.",
    tradeoffs:
      "Cyclical exposure to capex spend; heavy weight in a handful of industrials.",
    expenseRatio: 0.58,
    aum: 2_200_000_000,
    concentrationNote: "~95 holdings; top 10 ~55%.",
    topHoldingsNote: "ETN / ABB / Schneider / Quanta among top weights.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "XLU",
    name: "Utilities Select Sector SPDR Fund",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Large-cap U.S. utilities basket — defensive way to play datacenter load growth.",
    whyUseIt:
      "Lowest-volatility AI-energy proxy; income profile with growth optionality.",
    tradeoffs:
      "Less direct AI-tailwind exposure; rate-sensitive; capped upside in growth scenarios.",
    expenseRatio: 0.09,
    aum: 19_000_000_000,
    concentrationNote: "Top 10 ~60% of fund.",
    topHoldingsNote: "NEE / SO / DUK / CEG / VST top weights.",
    riskLevel: "low",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "VPU",
    name: "Vanguard Utilities ETF",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Broad U.S. utilities basket — defensive datacenter load-growth exposure.",
    whyUseIt:
      "Lowest-fee broad utilities exposure; alternative to XLU with similar holdings.",
    tradeoffs:
      "Same trade-offs as XLU: rate-sensitive, capped upside in growth scenarios.",
    expenseRatio: 0.1,
    aum: 7_500_000_000,
    concentrationNote: "~70 holdings; top 10 ~50%.",
    topHoldingsNote: "NEE / SO / DUK / CEG / VST top weights.",
    riskLevel: "low",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "PAVE",
    name: "Global X U.S. Infrastructure Development ETF",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Domestic infrastructure equities — construction, materials, electrification providers.",
    whyUseIt:
      "Captures the broader physical buildout (grid, transmission, materials) alongside electrification.",
    tradeoffs:
      "Diluted AI-energy exposure; performance driven by cyclical capex more broadly.",
    expenseRatio: 0.47,
    aum: 7_500_000_000,
    concentrationNote: "~100 holdings; moderately concentrated.",
    topHoldingsNote: "Mix of industrials, materials, and electrical equipment.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
  {
    ticker: "IFRA",
    name: "iShares U.S. Infrastructure ETF",
    themes: ["ai-energy"],
    exposureType: "ETF",
    themeFit:
      "Equal-weighted domestic infrastructure basket — grid, materials, and industrials.",
    whyUseIt:
      "More equal-weighted than PAVE; better breadth into smaller infrastructure names.",
    tradeoffs:
      "Equal-weighting lags during mega-cap rallies; diluted direct AI-energy exposure.",
    expenseRatio: 0.3,
    aum: 2_700_000_000,
    concentrationNote: "~150 holdings; equal-weighted.",
    topHoldingsNote: "Mix of utilities, transports, industrials, and materials.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Metric enrichment
//
// Best-effort: tries Yahoo for price/marketCap/P/E and SEC EDGAR for
// fundamentals. Both sources are optional. Failures degrade gracefully to
// null fields plus a human-readable warning. Cached at module level for
// METRICS_TTL_MS to avoid hammering Yahoo on every page load.
// ─────────────────────────────────────────────────────────────────────────────

const METRICS_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  at: number;
  data: StockPicksResponse;
}

let cached: CacheEntry | null = null;

function formatMarketCap(n: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Historical performance helpers
//
// We use calendar-day lookback windows (30 / 182 / 365 days) and snap to the
// nearest trading-day bar that's at most 7 days older than the target. If the
// series is too short the field is null with a warning.
// ─────────────────────────────────────────────────────────────────────────────

const PERF_WINDOWS: Array<{
  key: "1m" | "6m" | "12m";
  days: number;
  tolerance: number;
}> = [
  { key: "1m", days: 30, tolerance: 7 },
  { key: "6m", days: 182, tolerance: 14 },
  { key: "12m", days: 365, tolerance: 21 },
];

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function findBarAt(bars: Bar[], targetMs: number, toleranceDays: number): Bar | null {
  // Bars assumed ascending by t. Find the bar with t <= targetMs that is
  // closest to targetMs, within tolerance.
  const toleranceMs = toleranceDays * 86400000;
  let best: Bar | null = null;
  for (const b of bars) {
    if (b.t <= targetMs) {
      best = b;
    } else {
      break;
    }
  }
  if (!best) return null;
  if (targetMs - best.t > toleranceMs) {
    // Closest prior bar is too old — could happen for newly listed names
    // or sparse history. Still return it if it's not absurdly stale (e.g.
    // within 2x tolerance) so that 12m for a young ticker can show
    // "approximate" rather than nothing.
    if (targetMs - best.t > toleranceMs * 3) return null;
  }
  return best;
}

function computePerformance(
  bars: Bar[],
  latestPrice: number | null,
  source: string,
): StockPickPerformance {
  const warnings: string[] = [];
  const perf: StockPickPerformance = {
    price1mAgo: null,
    price1mDate: null,
    change1mPct: null,
    price6mAgo: null,
    price6mDate: null,
    change6mPct: null,
    price12mAgo: null,
    price12mDate: null,
    change12mPct: null,
    source,
    confidence: "low",
    warnings,
  };
  if (!bars.length || latestPrice == null || latestPrice <= 0) {
    warnings.push("Performance unavailable — no historical bars.");
    return perf;
  }
  const last = bars[bars.length - 1];
  const now = last.t;
  let filled = 0;
  for (const w of PERF_WINDOWS) {
    const target = now - w.days * 86400000;
    const bar = findBarAt(bars, target, w.tolerance);
    if (!bar || bar.c <= 0) {
      warnings.push(`No bar available for ${w.key} lookback.`);
      continue;
    }
    const change = ((latestPrice - bar.c) / bar.c) * 100;
    if (w.key === "1m") {
      perf.price1mAgo = bar.c;
      perf.price1mDate = isoDate(bar.t);
      perf.change1mPct = change;
    } else if (w.key === "6m") {
      perf.price6mAgo = bar.c;
      perf.price6mDate = isoDate(bar.t);
      perf.change6mPct = change;
    } else if (w.key === "12m") {
      perf.price12mAgo = bar.c;
      perf.price12mDate = isoDate(bar.t);
      perf.change12mPct = change;
    }
    filled += 1;
  }
  perf.confidence = filled === 3 ? "curated" : filled > 0 ? "approximate" : "low";
  return perf;
}

async function fetchBars(ticker: string): Promise<{ bars: Bar[] | null; source: string }> {
  // Prefer Massive (Polygon-compatible) when key is configured — matches the
  // main indicators pipeline used elsewhere in TreasuryLens. Fall back to
  // Yahoo's chart endpoint, which is the same path other instruments use
  // when no Massive key is present.
  const massive = await fetchMassiveChart(ticker);
  if (massive && massive.length > 0) return { bars: massive, source: "massive" };
  const yahoo = await fetchYahooChart(ticker);
  if (yahoo && yahoo.length > 0) return { bars: yahoo, source: "yahoo" };
  return { bars: null, source: "unavailable" };
}

export async function enrichOne(pick: StockPick): Promise<StockPickKeyMetrics> {
  const warnings: string[] = [];
  let price: number | null = null;
  let priceCurrency: string | null = null;
  let marketCap: number | null = null;
  let peRatio: number | null = null;
  let revenueGrowth: number | null = null;
  let grossMargin: number | null = null;
  let operatingMargin: number | null = null;
  let fcfMargin: number | null = null;
  let debtToEquity: number | null = null;
  const metricSources: string[] = [];

  // 1) Historical bars from the shared market-data path (Massive → Yahoo).
  //    The latest close is the most reliable price; performance fields are
  //    derived from this series.
  const { bars, source: barsSource } = await fetchBars(pick.ticker);
  if (bars && bars.length > 0) {
    const last = bars[bars.length - 1];
    if (Number.isFinite(last.c) && last.c > 0) {
      price = last.c;
      metricSources.push(barsSource);
    }
  } else {
    warnings.push("Historical price series unavailable for this ticker.");
  }

  const performance = computePerformance(bars ?? [], price, barsSource);
  // Surface performance warnings up to the key metric warnings so the UI
  // can show one consolidated list in the detail panel.
  warnings.push(...performance.warnings);

  // 2) Yahoo quote for marketCap, currency, trailing P/E. Yahoo is still the
  //    best free source for P/E and float; Massive's free reference endpoint
  //    does not expose P/E. We treat Yahoo as opportunistic — failures here
  //    don't invalidate the price/perf we already have.
  let yahooHit = false;
  try {
    const q = await fetchYahooQuote(pick.ticker);
    if (q) {
      yahooHit = true;
      if (price == null && typeof q.regularMarketPrice === "number") {
        price = q.regularMarketPrice;
        metricSources.push("yahoo");
      }
      if (typeof q.currency === "string") {
        priceCurrency = q.currency;
      }
      if (typeof q.marketCap === "number" && q.marketCap > 0) {
        marketCap = q.marketCap;
      }
      if (
        typeof q.trailingPE === "number" &&
        Number.isFinite(q.trailingPE) &&
        q.trailingPE > 0
      ) {
        peRatio = q.trailingPE;
      } else if (
        typeof q.epsTrailingTwelveMonths === "number" &&
        q.epsTrailingTwelveMonths <= 0
      ) {
        warnings.push("P/E unavailable (TTM earnings negative or zero).");
      }
    }
  } catch {
    // swallow — fall through to Massive ticker details below.
  }

  // 3) Massive ticker reference (Polygon-compatible) for marketCap when
  //    Yahoo didn't provide it. Polygon's free reference endpoint includes
  //    market_cap but not P/E.
  if (marketCap == null) {
    try {
      const details = await fetchMassiveTickerDetails(pick.ticker);
      if (details) {
        if (details.marketCap != null) {
          marketCap = details.marketCap;
          if (!metricSources.includes("massive_ref")) metricSources.push("massive_ref");
        }
        if (!priceCurrency && details.currency) {
          priceCurrency = details.currency.toUpperCase();
        }
      }
    } catch {
      // ignore
    }
  }

  if (!yahooHit && peRatio == null && price == null) {
    warnings.push("Live pricing unavailable for this ticker.");
  }

  // 4) SEC EDGAR for fundamentals — only meaningful for U.S. issuers.
  // Non-US issuers (TW, NL, IE, DE, GB) won't have SEC filings as domestic
  // filers; their cross-listed ADRs occasionally do but we don't rely on it.
  const isUS = !pick.issuerCountry || pick.issuerCountry === "US";
  let secEps: number | null = null;
  let secSharesOutstanding: number | null = null;
  if (isUS) {
    try {
      const f = await getEquityFundamentals(pick.ticker);
      if (f) {
        revenueGrowth = f.revenueGrowth;
        grossMargin = f.grossMargin;
        operatingMargin = f.operatingMargin;
        fcfMargin = f.fcfMargin;
        debtToEquity = f.debtToEquity;
        if (f.eps && Number.isFinite(f.eps.value) && f.eps.value > 0) {
          secEps = f.eps.value;
        }
        metricSources.push("sec_edgar");
        if (f.missingFields && f.missingFields.length > 0) {
          // Don't surface every detail — just a high-level note.
          warnings.push(
            `Some SEC fields missing: ${f.missingFields.slice(0, 3).join(", ")}.`,
          );
        }
      } else {
        warnings.push("SEC EDGAR fundamentals unavailable.");
      }
    } catch {
      warnings.push("Fundamentals fetch failed.");
    }
  } else {
    warnings.push(
      `Non-US issuer (${pick.issuerCountry}); SEC fundamentals not applicable.`,
    );
  }

  // 5) P/E fallback: if Yahoo didn't give it and we have a price + positive
  //    EPS from SEC EDGAR, compute it ourselves. This recovers P/E in the
  //    common case where Yahoo's quote API is blocked but EDGAR works.
  if (peRatio == null && price != null && secEps != null) {
    peRatio = price / secEps;
    if (!metricSources.includes("sec_edgar")) metricSources.push("sec_edgar");
  }

  // 6) Market-cap fallback: when no quote provider gave us a market cap,
  //    derive it from the latest SEC point-in-time shares outstanding × price.
  //    EntityCommonStockSharesOutstanding (cover-page fact) is the
  //    issuer-asserted count and is the same number used by Polygon-style
  //    market_cap fields. Acceptable accuracy for a watchlist UI; treat as
  //    approximate because the share count is a snapshot, not real-time.
  if (marketCap == null && price != null && isUS) {
    try {
      const sh = await getSharesOutstanding(pick.ticker);
      if (sh) {
        secSharesOutstanding = sh.value;
        marketCap = price * sh.value;
        if (!metricSources.includes("sec_edgar")) metricSources.push("sec_edgar");
        warnings.push(
          `Market cap derived from SEC shares outstanding (${sh.tag}) × price (approximate).`,
        );
      }
    } catch {
      // ignore
    }
  }
  void secSharesOutstanding;

  const metricSource =
    metricSources.length > 0 ? Array.from(new Set(metricSources)).join("+") : "unavailable";

  // Confidence rolls up source breadth. Live pricing + fundamentals = curated.
  let metricConfidence: "curated" | "approximate" | "low" = "low";
  const hasLivePrice =
    metricSources.includes("massive") || metricSources.includes("yahoo");
  const hasFundamentals = metricSources.includes("sec_edgar");
  if (hasLivePrice && hasFundamentals) {
    metricConfidence = "curated";
  } else if (metricSources.length > 0) {
    metricConfidence = "approximate";
  }

  // Drop performance warnings that duplicate the top-level series warning —
  // keeps the UI tidy without losing information.
  const dedupedWarnings = Array.from(new Set(warnings));

  return {
    price,
    priceCurrency,
    marketCap,
    marketCapLabel: formatMarketCap(marketCap),
    peRatio,
    revenueGrowth,
    grossMargin,
    operatingMargin,
    fcfMargin,
    debtToEquity,
    metricSource,
    metricAsOf: Date.now(),
    metricConfidence,
    metricWarnings: dedupedWarnings,
    performance,
  };
}

function formatAum(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

// ETF enrichment: best-effort price + performance via the same bars path the
// equity picks use. AUM and expense ratio remain curated (live AUM is not
// available on the providers we can hit anonymously). Confidence rolls up
// the live-pricing hit and the presence of a curated AUM/expense.
async function enrichEtf(etf: StockPickEtf): Promise<StockPickEtfMetrics> {
  const warnings: string[] = [];
  let price: number | null = null;
  let priceCurrency: string | null = "USD"; // U.S.-listed ETF default
  const metricSources: string[] = [];

  const { bars, source: barsSource } = await fetchBars(etf.ticker);
  if (bars && bars.length > 0) {
    const last = bars[bars.length - 1];
    if (Number.isFinite(last.c) && last.c > 0) {
      price = last.c;
      metricSources.push(barsSource);
    }
  } else {
    warnings.push("Historical price series unavailable for this ETF.");
  }

  const performance = computePerformance(bars ?? [], price, barsSource);
  warnings.push(...performance.warnings);

  const aum = etf.aum ?? null;
  if (aum == null) {
    warnings.push("AUM not curated for this ETF — verify on issuer site.");
  } else {
    metricSources.push("curated_aum");
  }

  if (etf.expenseRatio == null) {
    warnings.push("Expense ratio not curated — verify on issuer site.");
  } else {
    if (!metricSources.includes("curated")) metricSources.push("curated");
  }

  if (etf.leveraged) {
    warnings.push(
      "Leveraged daily-reset product — performance figures reflect compounded daily returns and decay in choppy markets.",
    );
  }

  const metricSource =
    metricSources.length > 0
      ? Array.from(new Set(metricSources)).join("+")
      : "unavailable";

  let metricConfidence: "curated" | "approximate" | "low" = "low";
  const hasLivePrice = metricSources.some(
    (s) => s === "massive" || s === "yahoo",
  );
  if (hasLivePrice && (aum != null || etf.expenseRatio != null)) {
    metricConfidence = "curated";
  } else if (metricSources.length > 0) {
    metricConfidence = "approximate";
  }

  const dedupedWarnings = Array.from(new Set(warnings));

  return {
    price,
    priceCurrency,
    aum,
    aumLabel: formatAum(aum),
    expenseRatio: etf.expenseRatio,
    metricSource,
    metricAsOf: Date.now(),
    metricConfidence,
    metricWarnings: dedupedWarnings,
    performance,
  };
}

async function buildResponse(): Promise<StockPicksResponse> {
  // Run enrichment with bounded concurrency. Even though both providers cache
  // internally, we keep it modest to avoid burst-rate-limit issues on cold
  // cache start. Tuned for ~100 picks: 6 keeps cold start under a minute on
  // a warm provider while staying well below typical rate limits.
  const CONCURRENCY = 6;
  const enrichedPicks: StockPick[] = [];
  let livePricingHit = false;
  let fundamentalsHit = false;

  for (let i = 0; i < PICKS.length; i += CONCURRENCY) {
    const slice = PICKS.slice(i, i + CONCURRENCY);
    const enrichedSlice = await Promise.all(
      slice.map(async (p) => {
        const metrics = await enrichOne(p);
        if (metrics.price != null) livePricingHit = true;
        if (metrics.revenueGrowth != null || metrics.grossMargin != null) {
          fundamentalsHit = true;
        }
        const withMetrics: StockPick = { ...p, keyMetrics: metrics };
        const scenarioModel = buildScenarioModel(withMetrics);
        // Keep `scenarioPotential` aligned with classification where they
        // diverge so badges and labels remain consistent.
        const aligned: StockPick = {
          ...withMetrics,
          scenarioModel,
          scenarioPotential:
            scenarioModel.classification as StockPick["scenarioPotential"],
        };
        return aligned;
      }),
    );
    enrichedPicks.push(...enrichedSlice);
  }

  const enrichedEtfs: StockPickEtf[] = [];
  for (let i = 0; i < ETFS.length; i += CONCURRENCY) {
    const slice = ETFS.slice(i, i + CONCURRENCY);
    const enrichedSlice = await Promise.all(
      slice.map(async (e) => {
        const metrics = await enrichEtf(e);
        if (metrics.price != null) livePricingHit = true;
        return { ...e, keyMetrics: metrics };
      }),
    );
    enrichedEtfs.push(...enrichedSlice);
  }

  return {
    themes: THEMES,
    picks: enrichedPicks,
    etfs: enrichedEtfs,
    lastUpdated: Date.now(),
    disclaimer:
      "TreasuryLens stock picks are curated research watchlists and scenario models, not personalized investment advice. Scenario potentials are hypothetical, not predictions. ETFs are diversified exposure alternatives, not recommendations. Investments can lose value. Consult a qualified financial professional before making any investment decision.",
    notes:
      "Market-cap buckets and scenario tags are curated and approximate. Key metrics are best-effort: pricing from public quote provider, fundamentals from SEC EDGAR where available; non-US issuers and negative-earnings names will show null with a warning.",
    metricsStatus: {
      livePricing: livePricingHit,
      fundamentals: fundamentalsHit,
      note: livePricingHit
        ? "Live pricing and fundamentals attached where available."
        : "Pricing unavailable — showing curated content only.",
    },
    scenarioMethodology: buildScenarioMethodology(),
  };
}

export async function getStockPicks(): Promise<StockPicksResponse> {
  const now = Date.now();
  if (cached && now - cached.at < METRICS_TTL_MS) return cached.data;
  const data = await buildResponse();
  cached = { at: now, data };
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conviction Ideas — compact price + moving-average chart
//
// Reuses the same Massive → Yahoo bars path as enrichOne. Returns a
// downsampled close series plus 50-/200-day SMAs aligned to the same points.
// Cached per-ticker (30 min) so repeated selections in the UI are cheap.
// ─────────────────────────────────────────────────────────────────────────────

const chartCache = new Map<string, { at: number; data: ConvictionChartResponse }>();
const CHART_TTL_MS = 30 * 60 * 1000;
const MAX_CHART_POINTS = 180; // keep payload small + mobile-friendly

function downsampleIndices(length: number, target: number): number[] {
  if (length <= target) return Array.from({ length }, (_, i) => i);
  const out: number[] = [];
  const step = (length - 1) / (target - 1);
  for (let i = 0; i < target; i++) out.push(Math.round(i * step));
  // Always include the very last bar.
  if (out[out.length - 1] !== length - 1) out[out.length - 1] = length - 1;
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

export async function getTickerChart(
  rawTicker: string,
): Promise<ConvictionChartResponse> {
  const ticker = rawTicker.trim().toUpperCase();
  const now = Date.now();
  const hit = chartCache.get(ticker);
  if (hit && now - hit.at < CHART_TTL_MS) return hit.data;

  const warnings: string[] = [];
  const { bars, source } = await fetchBars(ticker);

  if (!bars || bars.length === 0) {
    const empty: ConvictionChartResponse = {
      ticker,
      points: [],
      source: "unavailable",
      currency: null,
      availableMaWindows: [],
      lastClose: null,
      changePct: null,
      note: "No historical price series available for this ticker.",
      warnings: ["Historical price series unavailable for this ticker."],
    };
    chartCache.set(ticker, { at: now, data: empty });
    return empty;
  }

  // Compute MAs on the FULL series (so the 200-day window is correct), then
  // downsample the close + MA arrays together to keep the payload small.
  const closes = bars.map((b) => b.c);
  const ma50Full = sma(closes, 50);
  const ma200Full = sma(closes, 200);

  const idxs = downsampleIndices(bars.length, MAX_CHART_POINTS);
  const points: ConvictionChartPoint[] = idxs.map((i) => ({
    t: bars[i].t,
    c: bars[i].c,
    ma50: ma50Full[i],
    ma200: ma200Full[i],
  }));

  const availableMaWindows: number[] = [];
  if (closes.length >= 50) availableMaWindows.push(50);
  if (closes.length >= 200) availableMaWindows.push(200);

  if (closes.length < 50) {
    warnings.push(
      `Only ${closes.length} trading days available — no moving average shown.`,
    );
  } else if (closes.length < 200) {
    warnings.push(
      `Only ${closes.length} trading days available — 200-day moving average not shown.`,
    );
  }

  const first = points[0]?.c ?? null;
  const lastClose = points[points.length - 1]?.c ?? null;
  const changePct =
    first != null && first > 0 && lastClose != null
      ? ((lastClose - first) / first) * 100
      : null;

  const note =
    availableMaWindows.length === 2
      ? "Price with 50-day and 200-day moving averages."
      : availableMaWindows.length === 1
        ? "Price with 50-day moving average (insufficient history for 200-day)."
        : "Price only — insufficient history for moving averages.";

  const data: ConvictionChartResponse = {
    ticker,
    points,
    source,
    currency: source === "unavailable" ? null : "USD",
    availableMaWindows,
    lastClose,
    changePct,
    note,
    warnings,
  };
  chartCache.set(ticker, { at: now, data });
  return data;
}
