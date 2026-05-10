import type {
  StockPick,
  StockPickThemeInfo,
  StockPicksResponse,
} from "@shared/schema";

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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote:
      "Curated by TreasuryLens — figures approximate. Higher uncertainty; not a recommendation.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote: "Curated by TreasuryLens — figures approximate.",
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
    sourceNote:
      "Curated by TreasuryLens — speculative; figures approximate. Not a recommendation.",
  },
];

let cached: StockPicksResponse | null = null;

export function getStockPicks(): StockPicksResponse {
  if (cached) return cached;
  cached = {
    themes: THEMES,
    picks: PICKS,
    lastUpdated: Date.now(),
    disclaimer:
      "TreasuryLens stock picks are curated research watchlists and scenario models, not personalized investment advice. Scenario potentials are hypothetical, not predictions. Investments can lose value. Consult a qualified financial professional before making any investment decision.",
    notes:
      "Market-cap buckets and scenario tags are curated and approximate. Tickers are public U.S. listings; we link out only to source filings on existing pages.",
  };
  return cached;
}
