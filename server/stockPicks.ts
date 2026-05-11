import type {
  StockPick,
  StockPickEtf,
  StockPickKeyMetrics,
  StockPickPerformance,
  StockPickThemeInfo,
  StockPicksResponse,
} from "@shared/schema";
import type { Bar } from "./indicators";
import {
  fetchMassiveChart,
  fetchMassiveTickerDetails,
  fetchYahooChart,
  fetchYahooQuote,
} from "./marketData";
import { getEquityFundamentals, getSharesOutstanding } from "./secEdgar";

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

const PICKS: StockPick[] = [
  // ───────── AI Hardware ─────────
  {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    themes: ["ai-hardware"],
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
];

const ETFS: StockPickEtf[] = [
  // AI Hardware ETFs
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
    concentrationNote: "Top 10 ~55% of fund (approximate).",
    topHoldingsNote: "Heaviest weights in NVDA / AVGO / AMD.",
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
    concentrationNote: "~80 holdings — broader than BOTZ.",
    topHoldingsNote: "Mix of industrial automation, sensors, robotics.",
    riskLevel: "elevated",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },

  // AI Software ETFs
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
    concentrationNote: "~65 holdings; mid-concentration in top 10.",
    topHoldingsNote: "Mix of MSFT/AMZN/GOOGL alongside SaaS leaders.",
    riskLevel: "moderate",
    dataConfidence: "curated",
    sourceNote: CURATED_SOURCE + " Verify on issuer site.",
  },

  // AI Energy ETFs
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
    concentrationNote: "Concentrated in pure-play miners + physical uranium.",
    topHoldingsNote: "Cameco, Kazatomprom, NexGen Energy dominate.",
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
    concentrationNote: "Top 10 ~60% of fund.",
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
    concentrationNote: "~100 holdings; moderately concentrated.",
    topHoldingsNote: "Mix of industrials, materials, and electrical equipment.",
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

async function enrichOne(pick: StockPick): Promise<StockPickKeyMetrics> {
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

async function buildResponse(): Promise<StockPicksResponse> {
  // Run enrichment with bounded concurrency. Even though both providers cache
  // internally, we keep it modest to avoid burst-rate-limit issues on cold
  // cache start.
  const CONCURRENCY = 4;
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
        return { ...p, keyMetrics: metrics };
      }),
    );
    enrichedPicks.push(...enrichedSlice);
  }

  return {
    themes: THEMES,
    picks: enrichedPicks,
    etfs: ETFS,
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
  };
}

export async function getStockPicks(): Promise<StockPicksResponse> {
  const now = Date.now();
  if (cached && now - cached.at < METRICS_TTL_MS) return cached.data;
  const data = await buildResponse();
  cached = { at: now, data };
  return data;
}
