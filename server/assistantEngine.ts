// TreasuryLens Assistant — deterministic rules-based engine.
//
// This is the FREE, in-app screen helper. It answers user questions using
// only the app's existing internal data and the active screen route. It does
// NOT call any LLM, model API, or external generative provider at runtime.
//
// The engine is intentionally split from the HTTP route so a real model
// provider can later be plugged in behind the AssistantProvider interface
// (see bottom of file) without touching the React widget.

import { getStockPicks } from "./stockPicks";
import { getStockPicksBacktest } from "./backtest";
import { getThirteenFSummary } from "./sec13f";
import { getPoliticiansSummary } from "./politicians";
import type {
  BacktestResponse,
  StockPicksResponse,
  StockPick,
  StockPickEtf,
  ThirteenFSummaryResponse,
  Manager13FSummary,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AssistantQuery {
  route: string;          // e.g. "/", "/dashboard", "/stock-picks", "/superinvestors"
  question: string;       // raw user text or suggested-prompt text
  context?: Record<string, unknown> | null;
}

export interface AssistantSection {
  heading?: string;
  bullets?: string[];
  body?: string;
}

export interface AssistantSource {
  label: string;
  url?: string | null;
}

export interface AssistantAnswer {
  intent: string;           // matched intent id ("stock-picks.top-12m", "fallback", ...)
  title: string;            // short headline shown above the body
  sections: AssistantSection[];
  sources: AssistantSource[];
  disclaimer: string;       // always present when discussing investing
  followUps: string[];      // suggested next prompts
  mode: "rules" | "llm";    // future: when an LLM provider is plugged in
}

// ---------------------------------------------------------------------------
// Disclaimers / shared copy
// ---------------------------------------------------------------------------

const INVESTING_DISCLAIMER =
  "Research and education only — not personalized investment advice. Verify figures and consult a qualified financial professional before acting.";

const FREE_HELPER_NOTE =
  "Free rules-based helper — no LLM is used. Answers are deterministic and drawn from TreasuryLens internal data.";

const DEFAULT_FOLLOW_UPS: Record<string, string[]> = {
  "/": [
    "What does TreasuryLens do?",
    "How does the goal calculator work?",
    "Where are Stock Picks?",
  ],
  "/dashboard": [
    "What is RSI?",
    "Explain the Buffett Index",
    "What data is live?",
  ],
  "/app": [
    "What is RSI?",
    "Explain the Buffett Index",
    "What data is live?",
  ],
  "/stock-picks": [
    "Show top 12m performers",
    "Show AI Energy ETFs",
    "What does 3x potential mean?",
    "Backtest the 3x picks",
    "Did the picks beat QQQ?",
  ],
  "/themes": [
    "Show top 12m performers",
    "Show AI Energy ETFs",
    "What does 3x potential mean?",
    "Backtest the 2x picks",
    "Did the picks beat SPY?",
  ],
  "/superinvestors": [
    "What is a 13F?",
    "Show Berkshire top holdings",
    "What did Scion sell?",
  ],
  "/13f": [
    "What is a 13F?",
    "Show Berkshire top holdings",
    "What did Scion sell?",
  ],
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9$%\s.]/g, " ").replace(/\s+/g, " ").trim();
}

function has(q: string, ...needles: string[]): boolean {
  return needles.every((n) => q.includes(n));
}

function any(q: string, ...needles: string[]): boolean {
  return needles.some((n) => q.includes(n));
}

function followUps(route: string): string[] {
  return DEFAULT_FOLLOW_UPS[route] ?? DEFAULT_FOLLOW_UPS["/"];
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function bucketLabel(b: string): string {
  switch (b) {
    case "mega": return "Mega cap";
    case "large": return "Large cap";
    case "mid": return "Mid cap";
    case "small": return "Small cap";
    case "micro": return "Micro cap";
    default: return b;
  }
}

function fallbackAnswer(route: string, examples: string[]): AssistantAnswer {
  return {
    intent: "fallback",
    title: "I can answer a few things from on-screen data",
    sections: [
      {
        body: `${FREE_HELPER_NOTE} Try one of these on this screen:`,
        bullets: examples,
      },
    ],
    sources: [],
    disclaimer: INVESTING_DISCLAIMER,
    followUps: followUps(route),
    mode: "rules",
  };
}

function pickByTheme(picks: StockPick[], themeKey: string): StockPick[] {
  return picks.filter((p) => p.themes.includes(themeKey as StockPick["themes"][number]));
}

// Sub-theme keyword detection. Maps user phrasing to the curated subTheme tag
// on each pick. First match wins; checked in insertion order so that more
// specific terms come before broader ones.
const SUBTHEME_KEYWORDS: Array<[string[], string]> = [
  // AI Hardware
  [["semi equipment", "wfe", "lithography", "etch", "deposition"], "semi-equipment"],
  [["memory", "dram", "nand", "hbm", "ssd", "hdd"], "memory"],
  [["networking", "ethernet", "switch"], "networking"],
  [["optical", "transceiver", "photonics", "interconnect"], "optical"],
  [["datacenter hardware", "data center hardware", "server hardware", "storage hardware"], "datacenter-hardware"],
  [["edge ai", "on-device ai", "on device ai", "edge inference"], "edge-ai"],
  [["semiconductor", "semis", "chip"], "semiconductors"],
  // AI Software
  [["hyperscaler", "hyperscale", "cloud platform"], "hyperscalers"],
  [["data platform", "data warehouse", "data lake", "streaming data"], "data-platforms"],
  [["cybersecurity", "cyber security", "security software"], "cybersecurity"],
  [["automation", "rpa"], "automation"],
  [["developer tool", "devtool", "devops"], "developer-tools"],
  [["enterprise app", "saas app"], "enterprise-apps"],
  [["ai app", "genai", "gen ai"], "ai-apps"],
  [["vertical software", "industry software"], "vertical-software"],
  // AI Energy
  [["uranium", "yellowcake"], "uranium"],
  [["nuclear", "smr", "reactor"], "nuclear"],
  [["utilities", "regulated utility"], "utilities"],
  [["ipp", "independent power"], "ipps"],
  [["grid equipment", "transformer", "switchgear", "electrical equipment"], "grid-equipment"],
  [["datacenter power", "data center power", "cooling", "thermal"], "datacenter-power"],
  [["engineering", "epc", "construction"], "engineering"],
  [["energy storage", "battery storage"], "energy-storage"],
];

function detectSubTheme(q: string): string | null {
  for (const [keys, sub] of SUBTHEME_KEYWORDS) {
    for (const k of keys) {
      if (q.includes(k)) return sub;
    }
  }
  return null;
}

function findPick(picks: StockPick[], ticker: string): StockPick | null {
  const t = ticker.toUpperCase();
  return picks.find((p) => p.ticker.toUpperCase() === t) ?? null;
}

function extractTicker(q: string): string | null {
  // Look for short uppercase-likely tokens — q has already been lowercased so
  // match a-z 1-5 char standalone word. We then validate against the universe.
  const m = q.match(/\b([a-z]{1,5})\b/g);
  if (!m) return null;
  return m[0]?.toUpperCase() ?? null;
}

// ---------------------------------------------------------------------------
// Educational glossary — small set of common concepts.
// Add entries here rather than expanding intent functions.
// ---------------------------------------------------------------------------

interface GlossaryEntry {
  keys: string[];        // lowercase substrings; any match triggers
  title: string;
  body: string;
  bullets?: string[];
}

const GLOSSARY: GlossaryEntry[] = [
  {
    keys: ["p/e", "pe ratio", "price to earnings", "price earnings"],
    title: "P/E ratio (Price / Earnings)",
    body: "P/E divides share price by trailing earnings per share. A higher P/E means the market is paying more for each dollar of current profit — often reflecting growth or quality expectations. P/E is undefined when earnings are negative.",
  },
  {
    keys: ["rsi", "relative strength"],
    title: "RSI (Relative Strength Index)",
    body: "RSI is a momentum oscillator from 0–100. Readings above ~70 are often called overbought, below ~30 oversold. It's a signal, not a verdict — strong trends can stay extended for a long time.",
  },
  {
    keys: ["market cap", "market capitalization"],
    title: "Market capitalization",
    body: "Market cap = share price × shares outstanding. It tells you the equity value the market puts on the whole company. Mega cap is typically >$200B, large $10B–$200B, mid $2B–$10B, small $300M–$2B, micro below that.",
  },
  {
    keys: ["13f", "thirteen f"],
    title: "What is a 13F?",
    body: "Form 13F-HR is a quarterly SEC filing by institutional managers with over $100M under management. It lists U.S. long equity positions roughly 45 days after quarter-end — so the data is current as of the quarter, not today. It doesn't show shorts, cash, or non-U.S. holdings.",
  },
  {
    keys: ["buffett index", "buffett metric", "buffett framework", "buffett"],
    title: "Buffett Index",
    body: "TreasuryLens' Buffett Index is a business-quality / valuation framework that scores fundamentals (margins, returns, balance sheet) and management/governance signals from SEC filings — separate from the short-term Signal Lab. For Bitcoin-treasury equities it uses a different rubric centered on holdings and mNAV.",
  },
  {
    keys: ["3x potential", "3x", "scenario potential", "2x potential", "5x potential", "reward risk", "reward / risk", "r/r ratio"],
    title: "Scenario model & potential labels",
    body: "Each pick has a deterministic bull/base/bear scenario model over a 5-year horizon. The classification (2x / 3x / 5x / compounder / defensive / speculative) is derived from bull case implied return %: 2x ≈ ≥100% bull upside, 3x ≈ ≥200%, 5x ≈ ≥400%. Reward/risk = bull% / |bear%|. These are hypothetical bands derived from curated inputs — not predictions, targets, or probabilities.",
  },
  {
    keys: ["compounder"],
    title: "Compounder",
    body: "A 'compounder' is a quality business expected to grow earnings and intrinsic value steadily over many years. The thesis is durability rather than a re-rating.",
  },
  {
    keys: ["mnav", "m-nav", "btc nav", "btc treasury", "bitcoin treasury"],
    title: "BTC treasury metrics",
    body: "For Bitcoin-treasury equities, NAV = BTC holdings × BTC price. mNAV = market cap / BTC NAV (a premium/discount to crypto assets). BTC-per-share and BTC yield (change in BTC/share over time) round out the view.",
  },
  {
    keys: ["live data", "live pricing", "what is live", "live"],
    title: "What data is live",
    body: "TreasuryLens pulls public market quotes for instruments, SEC EDGAR for U.S. equity fundamentals and 13F filings, and uses curated content for theme blurbs and scenario tags. Snapshots are cached briefly server-side so rapid polls don't hit providers.",
  },
];

function matchGlossary(q: string): GlossaryEntry | null {
  for (const g of GLOSSARY) {
    if (g.keys.some((k) => q.includes(k))) return g;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route-specific intent handlers
// ---------------------------------------------------------------------------

const BACKTEST_LIMITATION_NOTE =
  "Backtest is a price-only reconstruction using today's curated universe and today's scenario labels — not a point-in-time recommendation audit. It carries survivorship and look-ahead bias. Research/education only.";

async function answerStockPicksBacktest(
  q: string,
  route: string,
): Promise<AssistantAnswer | null> {
  // Match any wording the user is likely to use about backtesting / 1Y
  // recommendations / beating an index. Returns null if no backtest intent
  // matches so the caller can fall through to the normal stock-picks flow.
  const isBacktest =
    any(
      q,
      "backtest",
      "back test",
      "back-test",
      "1 year ago",
      "one year ago",
      "a year ago",
      "12 months ago",
      "twelve months ago",
      "last year",
      "year ago",
      "how did",
      "how well did",
      "would have picked",
      "would this have picked",
      "would have recommended",
    ) ||
    any(q, "beat spy", "beat the spy", "beat qqq", "beat the qqq", "vs spy", "vs qqq", "outperform spy", "outperform qqq");

  if (!isBacktest) return null;

  const data: BacktestResponse = await getStockPicksBacktest();

  // Detect which classification (if any) the user asked about.
  const wantMulti = q.match(/(2x|3x|5x)/);
  const wantCompounder = any(q, "compounder", "compounders");
  const wantDefensive = any(q, "defensive");
  const wantSpec = any(q, "speculative", "spec");
  let bucketKey: string | null = null;
  if (wantMulti) bucketKey = `${wantMulti[1]} potential`;
  else if (wantCompounder) bucketKey = "compounder";
  else if (wantDefensive) bucketKey = "defensive";
  else if (wantSpec) bucketKey = "speculative";

  const askBeatSpy = any(q, "spy", "s&p", "s and p", "sp 500", "s&p 500");
  const askBeatQqq = any(q, "qqq", "nasdaq");

  const headerLine =
    `Window ${data.windowStartDate ?? "—"} → ${data.windowEndDate ?? "—"} (${data.lookbackDays} days). ` +
    `SPY ${pct(data.summary.spyReturnPct)} · QQQ ${pct(data.summary.qqqReturnPct)}.`;

  // 1) Specific bucket asked: show that bucket plus top names.
  if (bucketKey) {
    const bucket = data.buckets.find((b) => b.classification === bucketKey);
    const rows = data.stocks
      .filter((s) => s.classification === bucketKey && s.returnPct != null)
      .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0));
    const top = rows.slice(0, 8).map(
      (r) =>
        `${r.ticker} — ${r.companyName} — ${pct(r.returnPct)}${
          r.maxDrawdownPct != null ? ` (DD ${pct(r.maxDrawdownPct)})` : ""
        }${
          r.beatSpy != null ? ` · ${r.beatSpy ? "beat" : "lagged"} SPY` : ""
        }${
          r.beatQqq != null ? ` · ${r.beatQqq ? "beat" : "lagged"} QQQ` : ""
        }`,
    );
    const bucketLine = bucket
      ? `${bucket.classification} — count ${bucket.count} · avg ${pct(bucket.avgReturnPct)} · median ${pct(bucket.medianReturnPct)} · hit rate ${pct(bucket.hitRatePct)} · avg DD ${pct(bucket.avgMaxDrawdownPct)} · beat SPY ${pct(bucket.beatSpyRatePct)} · beat QQQ ${pct(bucket.beatQqqRatePct)}`
      : `No names currently classified ${bucketKey} in the backtest.`;
    return {
      intent: "stock-picks.backtest.bucket",
      title: `Backtest — ${bucketKey} (1Y reconstruction)`,
      sections: [
        { body: headerLine },
        { heading: "Bucket aggregate", body: bucketLine },
        {
          heading: "Top names in the bucket",
          bullets: top.length ? top : ["No rows with returns available."],
        },
        {
          heading: "Important — read this",
          body: BACKTEST_LIMITATION_NOTE,
        },
      ],
      sources: [{ label: "TreasuryLens 1Y backtest (price-only reconstruction)" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 2) Beat SPY / beat QQQ summary question.
  if (askBeatSpy || askBeatQqq) {
    const bench = askBeatQqq ? "QQQ" : "SPY";
    const benchReturn = askBeatQqq
      ? data.summary.qqqReturnPct
      : data.summary.spyReturnPct;
    const beatRate = askBeatQqq
      ? data.summary.beatQqqRatePct
      : data.summary.beatSpyRatePct;
    const byBucket = data.buckets.map(
      (b) =>
        `${b.classification} — ${pct(askBeatQqq ? b.beatQqqRatePct : b.beatSpyRatePct)} beat${
          b.avgReturnPct != null ? ` · avg ${pct(b.avgReturnPct)}` : ""
        }`,
    );
    return {
      intent: "stock-picks.backtest.benchmark",
      title: `Backtest vs ${bench} (1Y reconstruction)`,
      sections: [
        { body: headerLine },
        {
          body: `${bench} returned ${pct(benchReturn)} over the window. Across ${data.summary.tested} tested names, ${pct(beatRate)} beat ${bench}. Universe avg ${pct(data.summary.avgReturnPct)}, hit rate ${pct(data.summary.hitRatePct)}.`,
        },
        { heading: `Beat ${bench} rate by bucket`, bullets: byBucket },
        { heading: "Important — read this", body: BACKTEST_LIMITATION_NOTE },
      ],
      sources: [{ label: "TreasuryLens 1Y backtest (price-only reconstruction)" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 3) Generic backtest overview.
  const bucketLines = data.buckets.map(
    (b) =>
      `${b.classification} — n=${b.count} · avg ${pct(b.avgReturnPct)} · median ${pct(b.medianReturnPct)} · hit ${pct(b.hitRatePct)} · DD ${pct(b.avgMaxDrawdownPct)}`,
  );
  return {
    intent: "stock-picks.backtest.summary",
    title: "Scenario backtest — 1Y reconstruction",
    sections: [
      { body: headerLine },
      {
        body: `${data.summary.tested} names tested${data.summary.skipped ? ` (${data.summary.skipped} skipped — insufficient history)` : ""}. Avg return ${pct(data.summary.avgReturnPct)}, median ${pct(data.summary.medianReturnPct)}, hit rate ${pct(data.summary.hitRatePct)}, avg max drawdown ${pct(data.summary.avgMaxDrawdownPct)}. Beat SPY ${pct(data.summary.beatSpyRatePct)} · Beat QQQ ${pct(data.summary.beatQqqRatePct)}. Best bucket: ${data.summary.bestBucket ?? "n/a"}, worst: ${data.summary.worstBucket ?? "n/a"}.`,
      },
      { heading: "By classification", bullets: bucketLines },
      { heading: "Important — read this", body: BACKTEST_LIMITATION_NOTE },
    ],
    sources: [{ label: "TreasuryLens 1Y backtest (price-only reconstruction)" }],
    disclaimer: INVESTING_DISCLAIMER,
    followUps: followUps(route),
    mode: "rules",
  };
}

async function answerStockPicks(q: string, route: string): Promise<AssistantAnswer> {
  // Backtest intents win before anything else on this route — questions like
  // "how did 3x picks do" should go straight to the backtest engine rather
  // than the standard scenario filter.
  const backtest = await answerStockPicksBacktest(q, route);
  if (backtest) return backtest;

  const data: StockPicksResponse = await getStockPicks();
  const picks = data.picks;
  const etfs = data.etfs;

  // 0a) Scenario-aware reward/risk filter — must win over generic glossary
  //     so "best reward risk in AI Energy" routes to the ranked filter rather
  //     than the scenario glossary entry.
  if (
    any(q, "best reward", "highest reward risk", "best risk reward", "best r/r", "best rr") ||
    (any(q, "reward risk", "reward / risk") && any(q, "best", "top", "highest", "show"))
  ) {
    let themeForRR: string | null = null;
    if (any(q, "ai energy", "energy")) themeForRR = "ai-energy";
    else if (any(q, "ai hardware", "hardware")) themeForRR = "ai-hardware";
    else if (any(q, "ai software", "software")) themeForRR = "ai-software";
    let pool = picks;
    if (themeForRR) {
      pool = pool.filter((p) =>
        p.themes.includes(themeForRR as StockPick["themes"][number]),
      );
    }
    const ranked = pool
      .map((p) => ({ p, rr: p.scenarioModel?.rewardRiskRatio ?? null }))
      .filter((r) => r.rr != null)
      .sort((a, b) => (b.rr as number) - (a.rr as number))
      .slice(0, 10);
    const bullets = ranked.map(
      (r) =>
        `${r.p.ticker} — ${r.p.companyName} — R/R ${(r.rr as number).toFixed(2)}× — bull ${pct(r.p.scenarioModel?.bullUpsidePct)} / bear ${pct(r.p.scenarioModel?.bearDownsidePct)}`,
    );
    return {
      intent: "stock-picks.reward-risk",
      title: themeForRR
        ? `Best reward/risk — ${themeForRR.replace("-", " ")}`
        : "Best reward/risk in the universe",
      sections: [
        {
          bullets: bullets.length
            ? bullets
            : ["No scenario model data available yet — try refreshing the Stock Picks page first."],
        },
        {
          body:
            "Reward/risk = bull case implied return % ÷ |bear case implied return %|. Hypothetical bands only.",
        },
      ],
      sources: [{ label: "TreasuryLens scenario model" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 0b) "Why is X (2x|3x|5x|...) potential" — single-pick scenario explanation
  //     must win over the scenario glossary entry.
  if (
    (any(q, "why is", "why's") || has(q, "why")) &&
    (q.match(/(2x|3x|5x)/) || any(q, "potential", "scenario", "upside", "downside"))
  ) {
    const ticker = extractTickerFromQuery(q, picks);
    if (ticker) {
      const pick = findPick(picks, ticker);
      if (pick && pick.scenarioModel) {
        const sm = pick.scenarioModel;
        return {
          intent: "stock-picks.why.scenario",
          title: `${pick.ticker} — ${pick.companyName}`,
          sections: [
            { heading: "Thesis", bullets: pick.thesis },
            { heading: "Upside case", body: pick.upsideCase },
            {
              heading: `Scenario model — classified ${sm.classification}`,
              bullets: [
                `Bull case: ${sm.bull.outputs.targetMultipleOfCurrent.toFixed(2)}× of current (${pct(sm.bullUpsidePct)} upside, req CAGR ${pct(sm.bull.outputs.requiredCagrPct)}).`,
                `Base case: ${sm.base.outputs.targetMultipleOfCurrent.toFixed(2)}× of current (${pct(sm.base.outputs.impliedReturnPct)}).`,
                `Bear case: ${sm.bear.outputs.targetMultipleOfCurrent.toFixed(2)}× of current (${pct(sm.bear.outputs.impliedReturnPct)}).`,
                sm.rewardRiskRatio != null
                  ? `Reward / risk: ${sm.rewardRiskRatio.toFixed(2)}× over ${sm.horizonYears}y.`
                  : `Reward / risk: n/a (bear ≈ 0).`,
              ],
            },
            { heading: "Methodology", body: sm.methodology },
            { heading: "Risks", bullets: pick.risks.slice(0, 3) },
          ],
          sources: [{ label: pick.sourceNote }],
          disclaimer: INVESTING_DISCLAIMER,
          followUps: followUps(route),
          mode: "rules",
        };
      }
    }
  }

  // 0c) "Explain scenario model" — describe the methodology (matches before glossary)
  if (
    any(q, "explain scenario model", "how does the scenario model work", "scenario methodology", "scenario model methodology") ||
    (any(q, "scenario model") && any(q, "explain", "how", "what"))
  ) {
    const m = data.scenarioMethodology;
    if (m) {
      return {
        intent: "stock-picks.scenario-methodology",
        title: "Scenario model methodology",
        sections: [
          { body: m.summary },
          { heading: "Notes", bullets: m.notes },
          {
            heading: "Classification bands",
            bullets: m.classificationBands.map(
              (b) =>
                `${b.classification} — bull ≥ ${b.bullUpsidePctMin}%: ${b.description}`,
            ),
          },
          {
            body: `Horizon: ${m.horizonYears} years. Model type: ${m.modelType}.`,
          },
        ],
        sources: [{ label: "TreasuryLens curated scenario model" }],
        disclaimer: INVESTING_DISCLAIMER,
        followUps: followUps(route),
        mode: "rules",
      };
    }
  }

  // 1) Glossary first — terminology is route-agnostic.
  const glossary = matchGlossary(q);
  if (glossary) {
    return {
      intent: `glossary.${glossary.title}`,
      title: glossary.title,
      sections: [{ body: glossary.body, bullets: glossary.bullets }],
      sources: [{ label: "TreasuryLens glossary (curated)" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 2) Theme detection
  let themeKey: string | null = null;
  if (any(q, "ai energy", "energy theme")) themeKey = "ai-energy";
  else if (any(q, "ai hardware", "hardware theme")) themeKey = "ai-hardware";
  else if (any(q, "ai software", "software theme")) themeKey = "ai-software";

  // 2b) Sub-theme detection (e.g. "nuclear", "cybersecurity", "semi equipment")
  const subTheme = detectSubTheme(q);
  const subThemeLabel = subTheme ? subTheme.replace("-", " ") : null;
  const applySubTheme = (arr: StockPick[]) =>
    subTheme ? arr.filter((p) => p.subTheme === subTheme) : arr;

  // 3) "show etfs" — ETF alternatives, optionally filtered by theme
  if (any(q, "etf", "etfs", "fund", "index fund")) {
    const filtered: StockPickEtf[] = themeKey
      ? etfs.filter((e) => e.themes.includes(themeKey as StockPick["themes"][number]))
      : etfs;
    const list = filtered.slice(0, 8).map((e) =>
      `${e.ticker} — ${e.name}. ${e.themeFit}${e.expenseRatio != null ? ` (ER ${e.expenseRatio.toFixed(2)}%)` : ""}`
    );
    return {
      intent: "stock-picks.etfs",
      title: themeKey ? `ETF alternatives — ${themeKey.replace("-", " ")}` : "ETF alternatives",
      sections: [
        { bullets: list.length ? list : ["No ETFs found for that theme."] },
        { body: "Use ETFs when you want diversified theme exposure without picking single names." },
      ],
      sources: [{ label: "TreasuryLens curated ETF list" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 4) Why is X in theme Y / Why is X Nx potential — explain a single pick
  if (any(q, "why is", "why's") || has(q, "why", "in")) {
    const ticker = extractTickerFromQuery(q, picks);
    if (ticker) {
      const pick = findPick(picks, ticker);
      if (pick) {
        const askedAboutScenario =
          q.match(/(2x|3x|5x|defensive|compounder|speculative)/) != null ||
          any(q, "potential", "scenario", "upside", "downside");
        const sm = pick.scenarioModel ?? null;
        const sections: AssistantSection[] = [
          { heading: "Thesis", bullets: pick.thesis },
          { heading: "Upside case", body: pick.upsideCase },
          { heading: "Risks", bullets: pick.risks.slice(0, 3) },
        ];
        if (askedAboutScenario && sm) {
          sections.push({
            heading: `Scenario model — classified ${sm.classification}`,
            bullets: [
              `Bull case: ${sm.bull.outputs.targetMultipleOfCurrent.toFixed(2)}× of current (${pct(sm.bullUpsidePct)} upside, req CAGR ${pct(sm.bull.outputs.requiredCagrPct)}).`,
              `Base case: ${sm.base.outputs.targetMultipleOfCurrent.toFixed(2)}× of current (${pct(sm.base.outputs.impliedReturnPct)}).`,
              `Bear case: ${sm.bear.outputs.targetMultipleOfCurrent.toFixed(2)}× of current (${pct(sm.bear.outputs.impliedReturnPct)}).`,
              sm.rewardRiskRatio != null
                ? `Reward / risk: ${sm.rewardRiskRatio.toFixed(2)}× over ${sm.horizonYears}y.`
                : `Reward / risk: n/a (bear ≈ 0).`,
            ],
          });
          sections.push({ heading: "Methodology", body: sm.methodology });
        }
        sections.push({
          body: `Themes: ${pick.themes.join(", ")}. ${bucketLabel(pick.marketCapBucket)}. Scenario: ${pick.scenarioPotential}.`,
        });
        return {
          intent: askedAboutScenario ? "stock-picks.why.scenario" : "stock-picks.why",
          title: `${pick.ticker} — ${pick.companyName}`,
          sections,
          sources: [{ label: pick.sourceNote }],
          disclaimer: INVESTING_DISCLAIMER,
          followUps: followUps(route),
          mode: "rules",
        };
      }
    }
  }

  // 5) Small cap filter
  if (any(q, "small cap", "small-cap", "micro cap", "micro-cap")) {
    const wantMicro = any(q, "micro");
    const matches = picks.filter((p) =>
      wantMicro ? p.marketCapBucket === "micro" : (p.marketCapBucket === "small" || p.marketCapBucket === "micro"),
    );
    let filtered = themeKey ? matches.filter((p) => p.themes.includes(themeKey as StockPick["themes"][number])) : matches;
    filtered = applySubTheme(filtered);
    const bullets = filtered.map((p) =>
      `${p.ticker} — ${p.companyName} — ${bucketLabel(p.marketCapBucket)} — ${p.scenarioPotential}`
    );
    const titleSuffix = subThemeLabel ? ` — ${subThemeLabel}` : "";
    return {
      intent: "stock-picks.smallcap",
      title: (wantMicro ? "Micro-cap names" : "Small/micro-cap names") + titleSuffix,
      sections: [{ bullets: bullets.length ? bullets : ["No matches in the current curated universe."] }],
      sources: [{ label: "Curated by TreasuryLens — verify figures." }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 6) 2x / 3x / 5x potential filter
  const wantMulti = q.match(/(2x|3x|5x)/);
  if (wantMulti) {
    const tag = `${wantMulti[1]} potential` as StockPick["scenarioPotential"];
    let matches = picks.filter((p) => p.scenarioPotential === tag);
    if (themeKey) matches = matches.filter((p) => p.themes.includes(themeKey as StockPick["themes"][number]));
    matches = applySubTheme(matches);
    const bullets = matches.map((p) => {
      const sm = p.scenarioModel;
      const bull = sm ? `bull ${pct(sm.bullUpsidePct)}` : null;
      const rr =
        sm && sm.rewardRiskRatio != null
          ? `R/R ${sm.rewardRiskRatio.toFixed(2)}×`
          : null;
      const extras = [bull, rr].filter(Boolean).join(" · ");
      return `${p.ticker} — ${p.companyName} — ${p.themes.join(", ")} — conviction ${p.convictionScore}/100${extras ? ` · ${extras}` : ""}`;
    });
    return {
      intent: "stock-picks.scenario",
      title: themeKey ? `${tag} — ${themeKey.replace("-", " ")}` : `${tag} names`,
      sections: [
        { bullets: bullets.length ? bullets : ["No names in the universe carry that scenario tag right now."] },
        {
          body:
            "Scenario tags now reflect deterministic bull/base/bear bands per pick. " +
            "2x ≈ ≥100% bull upside, 3x ≈ ≥200%, 5x ≈ ≥400%. Hypothetical bands, not predictions.",
        },
      ],
      sources: [{ label: "TreasuryLens scenario model" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 7) Top performers
  if (any(q, "top performers", "best performers", "biggest gainers", "highest gainers", "top 12m", "top performer")) {
    let window: "1m" | "6m" | "12m" = "12m";
    if (any(q, "1m", "1 month", "one month")) window = "1m";
    else if (any(q, "6m", "6 month", "six month")) window = "6m";
    const scored = picks
      .map((p) => {
        const perf = p.keyMetrics?.performance ?? null;
        const change = perf
          ? window === "1m"
            ? perf.change1mPct
            : window === "6m"
              ? perf.change6mPct
              : perf.change12mPct
          : null;
        return { p, change };
      })
      .filter((r) => r.change != null)
      .sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
      .slice(0, 10);
    const bullets = scored.map((r) => `${r.p.ticker} — ${r.p.companyName} — ${pct(r.change)}`);
    return {
      intent: `stock-picks.top.${window}`,
      title: `Top ${window} performers in the universe`,
      sections: [
        { bullets: bullets.length ? bullets : ["Performance data not available yet — try refreshing the Stock Picks page first."] },
        { body: "Past performance does not predict future returns." },
      ],
      sources: [{ label: "TreasuryLens stock-picks data (public quote provider)" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 8) Single ticker lookup — quick stats
  const tickerOnly = extractTickerFromQuery(q, picks);
  if (tickerOnly) {
    const pick = findPick(picks, tickerOnly);
    if (pick) {
      const km = pick.keyMetrics;
      const perf = km?.performance;
      const stats = [
        km?.marketCapLabel ? `Market cap: ${km.marketCapLabel}` : null,
        km?.peRatio != null ? `P/E: ${km.peRatio.toFixed(1)}` : null,
        km?.revenueGrowth != null ? `Revenue growth: ${pct(km.revenueGrowth)}` : null,
        km?.grossMargin != null ? `Gross margin: ${pct(km.grossMargin)}` : null,
        perf?.change12mPct != null ? `12m: ${pct(perf.change12mPct)}` : null,
        perf?.change6mPct != null ? `6m: ${pct(perf.change6mPct)}` : null,
        perf?.change1mPct != null ? `1m: ${pct(perf.change1mPct)}` : null,
      ].filter(Boolean) as string[];
      return {
        intent: "stock-picks.ticker",
        title: `${pick.ticker} — ${pick.companyName}`,
        sections: [
          { heading: "Snapshot", bullets: stats.length ? stats : ["Live metrics unavailable right now."] },
          { heading: "Why on the list", bullets: pick.thesis },
          { body: `Themes: ${pick.themes.join(", ")} • ${bucketLabel(pick.marketCapBucket)} • ${pick.scenarioPotential}` },
        ],
        sources: [{ label: pick.sourceNote }],
        disclaimer: INVESTING_DISCLAIMER,
        followUps: followUps(route),
        mode: "rules",
      };
    }
  }

  // 9) Theme-only request
  if (themeKey) {
    const matches = applySubTheme(pickByTheme(picks, themeKey));
    const bullets = matches.map((p) =>
      `${p.ticker} — ${p.companyName} — ${bucketLabel(p.marketCapBucket)} — ${p.scenarioPotential}`
    );
    return {
      intent: "stock-picks.theme",
      title: subThemeLabel
        ? `${themeKey.replace("-", " ")} · ${subThemeLabel}`
        : `${themeKey.replace("-", " ")} watchlist`,
      sections: [{ bullets: bullets.length ? bullets : ["No matches in the curated universe."] }],
      sources: [{ label: "TreasuryLens curated theme" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // 10) Sub-theme only (no broad theme keyword present) — e.g. "show nuclear picks"
  if (subTheme) {
    const matches = applySubTheme(picks);
    const bullets = matches.map((p) =>
      `${p.ticker} — ${p.companyName} — ${p.themes.join(", ")} — ${bucketLabel(p.marketCapBucket)}`
    );
    return {
      intent: "stock-picks.subtheme",
      title: `${subThemeLabel} watchlist`,
      sections: [{ bullets: bullets.length ? bullets : ["No matches in the curated universe."] }],
      sources: [{ label: "TreasuryLens curated sub-theme" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  return fallbackAnswer(route, [
    "Show top 12m performers",
    "Show AI Energy ETFs",
    "Which AI Energy names have 3x potential?",
    "What does 3x potential mean?",
    "Which are small cap?",
  ]);
}

function extractTickerFromQuery(q: string, picks: StockPick[]): string | null {
  // Look for any 1-5 letter token that matches a known ticker. Avoid the
  // generic extractTicker() since "in" or "is" are tokens too.
  const tokens = q.match(/\b([a-z]{1,5})\b/g) ?? [];
  const tickerSet = new Set(picks.map((p) => p.ticker.toLowerCase()));
  for (const t of tokens) {
    if (tickerSet.has(t)) return t.toUpperCase();
  }
  return null;
}

async function answerSuperInvestors(q: string, route: string): Promise<AssistantAnswer> {
  const data: ThirteenFSummaryResponse = await getThirteenFSummary();
  const managers = data.managers;

  const glossary = matchGlossary(q);
  if (glossary) {
    return {
      intent: `glossary.${glossary.title}`,
      title: glossary.title,
      sections: [{ body: glossary.body }],
      sources: [{ label: "TreasuryLens glossary" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  function findManager(): Manager13FSummary | null {
    if (any(q, "berkshire", "buffett")) return managers.find((m) => m.key === "berkshire") ?? null;
    if (any(q, "pershing", "ackman")) return managers.find((m) => m.key === "pershing") ?? null;
    if (any(q, "bridgewater", "dalio")) return managers.find((m) => m.key === "bridgewater") ?? null;
    if (any(q, "scion", "burry")) return managers.find((m) => m.key === "scion") ?? null;
    if (any(q, "situational", "aschenbrenner", "leopold"))
      return managers.find((m) => m.key === "situational") ?? null;
    return null;
  }

  const mgr = findManager();

  // What did X add / new positions
  if (mgr && any(q, "add", "added", "new position", "new positions", "buy", "bought")) {
    const news = mgr.newPositions.slice(0, 8);
    const inc = mgr.increasedPositions.slice(0, 5);
    return {
      intent: "13f.adds",
      title: `${mgr.firm} — adds and new positions (latest 13F)`,
      sections: [
        {
          heading: "New positions",
          bullets: news.length
            ? news.map((p) => `${p.issuer} — ${formatMoney(p.newValue)} (${p.weight.toFixed(2)}% of portfolio)`)
            : ["None in latest filing."],
        },
        {
          heading: "Increased positions",
          bullets: inc.length
            ? inc.map((p) => `${p.issuer} — ${pct(p.shareChangePct)} shares, now ${formatMoney(p.newValue)}`)
            : ["None significantly increased in latest filing."],
        },
      ],
      sources: mgr.latestFiling ? [{ label: "SEC EDGAR 13F-HR", url: mgr.latestFiling.filingIndexUrl }] : [{ label: "SEC EDGAR 13F-HR" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // What did X sell / reductions
  if (mgr && any(q, "sell", "sold", "reduced", "trim", "trimmed", "exit", "exits", "exited")) {
    const sold = mgr.soldPositions.slice(0, 8);
    const reduced = mgr.reducedPositions.slice(0, 5);
    return {
      intent: "13f.sells",
      title: `${mgr.firm} — sells and reductions (latest 13F)`,
      sections: [
        {
          heading: "Sold out",
          bullets: sold.length
            ? sold.map((p) => `${p.issuer} — exited (was ${formatMoney(p.previousValue)})`)
            : ["No full exits in latest filing."],
        },
        {
          heading: "Reduced",
          bullets: reduced.length
            ? reduced.map((p) => `${p.issuer} — ${pct(p.shareChangePct)} shares, now ${formatMoney(p.newValue)}`)
            : ["No significant reductions in latest filing."],
        },
      ],
      sources: mgr.latestFiling ? [{ label: "SEC EDGAR 13F-HR", url: mgr.latestFiling.filingIndexUrl }] : [{ label: "SEC EDGAR 13F-HR" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // Top holdings
  if (mgr && any(q, "top", "biggest", "largest", "holdings")) {
    const top = mgr.topHoldings.slice(0, 10);
    return {
      intent: "13f.top",
      title: `${mgr.firm} — top holdings (latest 13F)`,
      sections: [
        {
          bullets: top.length
            ? top.map((h) => `${h.issuer} — ${formatMoney(h.value)} (${h.weight.toFixed(2)}% of portfolio)`)
            : ["No holdings parsed in latest filing."],
        },
        { body: `Latest filing report date: ${mgr.latestFiling?.reportDate ?? "n/a"}. 13F shows long U.S. equity positions only, on a ~45-day delay.` },
      ],
      sources: mgr.latestFiling ? [{ label: "SEC EDGAR 13F-HR", url: mgr.latestFiling.filingIndexUrl }] : [{ label: "SEC EDGAR 13F-HR" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // Generic overview if no manager mentioned
  if (any(q, "overview", "managers", "who")) {
    const bullets = managers.map((m) =>
      `${m.firm} — ${m.holdingsCount} holdings, ${formatMoney(m.totalValue)} (as of ${m.latestFiling?.reportDate ?? "n/a"})`
    );
    return {
      intent: "13f.overview",
      title: "13F managers tracked",
      sections: [{ bullets }],
      sources: [{ label: "SEC EDGAR" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  return fallbackAnswer(route, [
    "What is a 13F?",
    "Show Berkshire top holdings",
    "What did Scion sell?",
    "What did Pershing add?",
  ]);
}

async function answerDashboard(q: string, route: string): Promise<AssistantAnswer> {
  const glossary = matchGlossary(q);
  if (glossary) {
    return {
      intent: `glossary.${glossary.title}`,
      title: glossary.title,
      sections: [{ body: glossary.body, bullets: glossary.bullets }],
      sources: [{ label: "TreasuryLens glossary" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  // Buy/Hold/Sell explainer
  if (any(q, "buy", "hold", "sell") && any(q, "why", "explain", "what")) {
    return {
      intent: "dashboard.signal",
      title: "How TreasuryLens Buy/Hold/Sell signals work",
      sections: [
        {
          body: "Signal Lab combines trend, momentum, mean-reversion and volatility sub-models into a composite score with three risk profiles (Conservative / Balanced / Aggressive). It's deterministic and rule-based.",
        },
        {
          heading: "What the labels mean",
          bullets: [
            "Buy — composite score above the configured threshold with supporting confirmation.",
            "Hold — neutral composite or mixed sub-model signals.",
            "Sell — composite below threshold or risk-control trigger.",
          ],
        },
        { body: "These are model outputs from the live snapshot, not advice. Tune profile in the Signal Lab panel to see why." },
      ],
      sources: [{ label: "Signal Lab panel (Dashboard)" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  if (any(q, "live", "data sources", "where")) {
    return {
      intent: "dashboard.live",
      title: "What data is live on the Dashboard",
      sections: [
        {
          bullets: [
            "Prices and history: public quote providers (Yahoo / Massive) cached for ~60s.",
            "Fundamentals: SEC EDGAR for U.S. equities (cached server-side).",
            "Buffett Index: derived from fundamentals + governance signals on each refresh.",
            "Signal Lab: computed from the live snapshot when you change profile.",
          ],
        },
      ],
      sources: [{ label: "TreasuryLens backend" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  return fallbackAnswer(route, [
    "What is RSI?",
    "Explain the Buffett Index",
    "What data is live?",
    "Why is a stock Buy/Hold/Sell?",
    "What does P/E mean?",
  ]);
}

async function answerLanding(q: string, route: string): Promise<AssistantAnswer> {
  const glossary = matchGlossary(q);
  if (glossary) {
    return {
      intent: `glossary.${glossary.title}`,
      title: glossary.title,
      sections: [{ body: glossary.body }],
      sources: [{ label: "TreasuryLens glossary" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  if (any(q, "what does", "what is treasurylens", "about treasurylens", "treasurylens do")) {
    return {
      intent: "landing.about",
      title: "What TreasuryLens does",
      sections: [
        {
          bullets: [
            "Live dashboard for equities, Bitcoin-treasury companies and crypto.",
            "Rules-based Signal Lab (Buy/Hold/Sell) and Buffett-style quality framework.",
            "Stock Picks / Themes — curated AI watchlists with key metrics and ETF alternatives.",
            "SuperInvestors — quarterly 13F filings for Berkshire, Pershing, Bridgewater, Scion.",
            "Goal calculator on the landing page for simple retirement-style scenarios.",
          ],
        },
        { body: "All free, with no LLM in the loop. Data is public-source: quote providers and SEC EDGAR." },
      ],
      sources: [{ label: "TreasuryLens product overview" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  if (any(q, "calculator", "goal", "retirement")) {
    return {
      intent: "landing.calculator",
      title: "Goal calculator",
      sections: [
        {
          body:
            "The calculator on the landing page projects a savings goal using inputs like starting balance, monthly contribution, target amount and time horizon. It's an educational model — not personalized financial advice and not adjusted for taxes, inflation regimes or specific products.",
        },
      ],
      sources: [{ label: "Landing — Goal calculator" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  if (any(q, "stock picks", "themes page", "watchlist", "where are picks", "where is picks")) {
    return {
      intent: "landing.nav.picks",
      title: "Where to find Stock Picks",
      sections: [
        { body: "Stock Picks lives at /stock-picks (or /themes). On mobile, tap the Picks tab in the bottom nav." },
      ],
      sources: [{ label: "Site navigation" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  if (any(q, "13f", "superinvestor", "super investor")) {
    return {
      intent: "landing.nav.13f",
      title: "Where to find SuperInvestors",
      sections: [
        { body: "SuperInvestors lives at /superinvestors (or /13f). On mobile, tap the SuperInvestors tab in the bottom nav." },
      ],
      sources: [{ label: "Site navigation" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  if (any(q, "risk", "disclaimer", "advice")) {
    return {
      intent: "landing.risk",
      title: "Risk and disclaimers",
      sections: [
        {
          body:
            "TreasuryLens is for research and education. It is not a broker-dealer or registered investment adviser. Nothing on the site is personalized investment advice. Markets can lose value; verify any figure on the issuer's filings before acting; consult a qualified professional for your situation.",
        },
      ],
      sources: [{ label: "Site terms / disclosures" }],
      disclaimer: INVESTING_DISCLAIMER,
      followUps: followUps(route),
      mode: "rules",
    };
  }

  return fallbackAnswer(route, [
    "What does TreasuryLens do?",
    "How does the goal calculator work?",
    "Where are Stock Picks?",
    "What is a 13F?",
  ]);
}

// ---------------------------------------------------------------------------
// Provider interface — future LLM swap-in.
//
// The rules engine is the only provider today. A future LLM provider would
// implement the same `answer()` shape so the React widget never needs to
// change. Plug it in by replacing `DEFAULT_PROVIDER` with a wrapper that
// falls back to rules on low-confidence intents.
// ---------------------------------------------------------------------------

export interface AssistantProvider {
  answer(query: AssistantQuery): Promise<AssistantAnswer>;
}

export const rulesProvider: AssistantProvider = {
  async answer(query: AssistantQuery): Promise<AssistantAnswer> {
    const q = norm(query.question);
    const route = (query.route || "/").trim();

    if (!q) {
      return fallbackAnswer(route, followUps(route));
    }

    try {
      if (route === "/stock-picks" || route === "/themes") {
        return await answerStockPicks(q, route);
      }
      if (route === "/superinvestors" || route === "/13f") {
        return await answerSuperInvestors(q, route);
      }
      if (route === "/dashboard" || route === "/app") {
        return await answerDashboard(q, route);
      }
      if (route === "/" || route === "" || route === "/landing") {
        return await answerLanding(q, route);
      }
    } catch (e) {
      return {
        intent: "error",
        title: "Couldn't answer that right now",
        sections: [{ body: (e as Error).message || "Unknown error fetching internal data." }],
        sources: [],
        disclaimer: INVESTING_DISCLAIMER,
        followUps: followUps(route),
        mode: "rules",
      };
    }

    // Glossary-only fallback for unknown routes.
    const glossary = matchGlossary(q);
    if (glossary) {
      return {
        intent: `glossary.${glossary.title}`,
        title: glossary.title,
        sections: [{ body: glossary.body }],
        sources: [{ label: "TreasuryLens glossary" }],
        disclaimer: INVESTING_DISCLAIMER,
        followUps: followUps(route),
        mode: "rules",
      };
    }

    return fallbackAnswer(route, [
      "What does TreasuryLens do?",
      "What is a 13F?",
      "What is RSI?",
      "Show top 12m performers",
    ]);
  },
};

// Default provider used by the HTTP route. Swap to an LLM-backed
// implementation here when one is added.
export const DEFAULT_PROVIDER: AssistantProvider = rulesProvider;

export async function answerAssistant(query: AssistantQuery): Promise<AssistantAnswer> {
  return DEFAULT_PROVIDER.answer(query);
}

// Re-export for tests / direct access.
export const __test = { norm, matchGlossary };
// Marks utilities as intentionally exported even when unused at runtime.
void has;
void extractTicker;
void pickByTheme;
