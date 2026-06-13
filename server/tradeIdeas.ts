// Trade Ideas — deterministic, transparent distillation of the curated Stock
// Picks / conviction universe into (a) ranked actionable LONG equity ideas and
// (b) ranked bullish OPTION structures built from the same theses.
//
// Design principles (mirrors the rest of TreasuryLens):
//   - No LLM, no black box. Every score is a visible weighted blend.
//   - Reuse the already-enriched universe from getStockPicks() — picks arrive
//     with keyMetrics (live price/fundamentals) and a scenarioModel (bull/base/
//     bear target multiples, target prices, reward/risk). We do NOT recompute
//     pricing here.
//   - Options rank by a *payoff-adjusted probability / actionability* score, not
//     raw theoretical upside. A 10x lottery ticket with a 5% hit chance should
//     not outrank a defined-risk spread on a high-conviction base case.
//   - Option chain data is used only if the backend already exposes it. It does
//     not today, so all option ideas are transparent MODELED FALLBACKS, derived
//     from current price, a volatility/risk proxy, the scenario targets, the
//     time horizon, and the downside guardrail. The dataMode flag says so.
//
// Research / education only. Not personalized financial advice. 2x/3x labels
// describe a modeled scenario, never a guaranteed outcome.

import { getStockPicks } from "./stockPicks";
import type {
  DataConfidence,
  EntryQuality,
  OptionLeg,
  OptionStructureInfo,
  OptionStructureKind,
  RiskLevel,
  ScenarioClassification,
  ScenarioModel,
  StockPick,
  TradeIdeaDataMode,
  TradeIdeaLong,
  TradeIdeaOption,
  TradeIdeaTier,
  TradeIdeaUpsideClass,
  TradeIdeasResponse,
} from "@shared/schema";

const TTL_MS = 30 * 60 * 1000;
let cached: { at: number; data: TradeIdeasResponse } | null = null;

const DISCLAIMER =
  "Trade Ideas are deterministic research distillations of TreasuryLens's curated universe and scenario model — not personalized financial advice, not signals to trade. Option structures are MODELED fallbacks (no live option chain is wired): premiums, breakevens, max-loss and probabilities are illustrative estimates from current price, a volatility/risk proxy and scenario targets. 2x/3x labels describe a modeled bull scenario, not a promise. Options can expire worthless — you can lose 100% of premium. Verify every contract, premium and expiry with your broker before acting.";

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

// ─────────────────────────────────────────────────────────────────────────────
// Volatility / risk proxy
//
// Stock picks don't carry the snapshot's vol30dAnnualized field, so we derive a
// transparent annualised-vol proxy from the curated risk level, widened a touch
// for higher scenario classes (3x/5x names trade wilder). Used only to model
// option premiums in the fallback path; clearly labelled as a proxy in the UI.
// ─────────────────────────────────────────────────────────────────────────────

const RISK_VOL_PROXY: Record<RiskLevel, number> = {
  low: 24,
  moderate: 34,
  elevated: 45,
  high: 58,
  "very high": 75,
};

const CLASS_VOL_BUMP: Partial<Record<ScenarioClassification, number>> = {
  "3x potential": 6,
  "5x potential": 14,
  speculative: 12,
};

function ivProxyPct(pick: StockPick): number {
  const base = RISK_VOL_PROXY[pick.riskLevel] ?? 40;
  const bump = pick.scenarioModel
    ? CLASS_VOL_BUMP[pick.scenarioModel.classification] ?? 0
    : 0;
  return round(base + bump, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry quality
//
// Derived from trailing momentum (6m/12m) relative to a healthy band plus the
// distance the scenario model still leaves to the base case. "Extended" when a
// name has already run hard; "attractive" when momentum is constructive but the
// base case still implies meaningful room. Transparent thresholds.
// ─────────────────────────────────────────────────────────────────────────────

function deriveEntryQuality(pick: StockPick): {
  quality: EntryQuality;
  label: string;
  rationale: string[];
} {
  const perf = pick.keyMetrics?.performance ?? null;
  const c6 = perf?.change6mPct ?? null;
  const baseUpside = pick.scenarioModel?.base.outputs.impliedReturnPct ?? null;
  const rationale: string[] = [];

  if (c6 == null && baseUpside == null) {
    return {
      quality: "unknown",
      label: "Unknown",
      rationale: ["No trailing performance or scenario room available to judge entry."],
    };
  }

  // Extended: ran a lot AND base case leaves little room.
  if (c6 != null && c6 > 80 && (baseUpside == null || baseUpside < 20)) {
    rationale.push(`Up ${Math.round(c6)}% over 6m with limited base-case room left.`);
    return { quality: "extended", label: "Extended", rationale };
  }
  // Wait-for-setup: sharp drawdown — could be value or a falling knife.
  if (c6 != null && c6 < -25) {
    rationale.push(`Down ${Math.round(c6)}% over 6m — wait for the trend to stabilise.`);
    return { quality: "wait-for-setup", label: "Wait for setup", rationale };
  }
  // Attractive: constructive-but-not-parabolic momentum with real base room.
  if ((c6 == null || c6 < 50) && baseUpside != null && baseUpside >= 30) {
    if (c6 != null) rationale.push(`Trailing 6m ${c6 >= 0 ? "+" : ""}${Math.round(c6)}% — not over-extended.`);
    rationale.push(`Base case still implies ~${Math.round(baseUpside)}% room.`);
    return { quality: "attractive", label: "Attractive", rationale };
  }
  if (c6 != null) rationale.push(`Trailing 6m ${c6 >= 0 ? "+" : ""}${Math.round(c6)}%.`);
  if (baseUpside != null) rationale.push(`Base case implies ~${Math.round(baseUpside)}% room.`);
  return { quality: "fair", label: "Fair", rationale };
}

const ENTRY_QUALITY_POINTS: Record<EntryQuality, number> = {
  attractive: 100,
  fair: 65,
  extended: 30,
  "wait-for-setup": 40,
  unknown: 50,
};

function upsideClassFrom(c: ScenarioClassification | null): TradeIdeaUpsideClass {
  switch (c) {
    case "defensive":
      return "defensive";
    case "compounder":
      return "compounder";
    case "2x potential":
      return "2x";
    case "3x potential":
      return "3x";
    case "5x potential":
      return "5x+";
    case "speculative":
      return "5x+";
    default:
      return "compounder";
  }
}

// Concrete invalidation level: prefer the scenario bear target price; if not
// available, fall back to a risk-scaled haircut off the current price.
function invalidationLevel(pick: StockPick): number | null {
  const bearTp = pick.scenarioModel?.bear.outputs.targetPrice ?? null;
  if (bearTp != null) return round(bearTp, 2);
  const price = pick.keyMetrics?.price ?? null;
  if (price == null) return null;
  const haircut =
    pick.riskLevel === "low" ? 0.85 : pick.riskLevel === "moderate" ? 0.8 : 0.7;
  return round(price * haircut, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Long idea score
//
// A transparent 0-100 blend that rewards: conviction, entry quality, a healthy
// scenario reward/risk, and meaningful base-case room — penalising names whose
// only appeal is a low-probability bull tail. NOT a price predictor.
// ─────────────────────────────────────────────────────────────────────────────

function rewardRiskPoints(rr: number | null): number {
  if (rr == null) return 45;
  // 1.0 → 40, 2.0 → 70, 3.0+ → ~90.
  return clamp(40 + (rr - 1) * 30, 0, 95);
}

function baseRoomPoints(baseUpsidePct: number | null): number {
  if (baseUpsidePct == null) return 50;
  // 0% → 30, 40% → 70, 80%+ → ~95.
  return clamp(30 + baseUpsidePct, 0, 95);
}

function buildLong(pick: StockPick): TradeIdeaLong {
  const sm = pick.scenarioModel ?? null;
  const km = pick.keyMetrics ?? null;
  const entry = deriveEntryQuality(pick);

  const convictionPts = clamp(pick.convictionScore, 0, 100);
  const entryPts = ENTRY_QUALITY_POINTS[entry.quality];
  const rrPts = rewardRiskPoints(sm?.rewardRiskRatio ?? null);
  const baseRoom = baseRoomPoints(sm?.base.outputs.impliedReturnPct ?? null);

  // Weighted blend. Conviction and reward/risk lead; entry quality and base-case
  // room round it out so we favour actionable setups over pure long-tail bets.
  const ideaScore = round(
    convictionPts * 0.4 + rrPts * 0.25 + entryPts * 0.2 + baseRoom * 0.15,
    0,
  );

  const rationale: string[] = [];
  rationale.push(`Conviction ${pick.convictionScore}/100 (${pick.riskLevel} risk).`);
  if (sm?.rewardRiskRatio != null) {
    rationale.push(
      `Scenario reward/risk ~${sm.rewardRiskRatio.toFixed(1)}x (bull ${Math.round(sm.bullUpsidePct)}% vs bear ${Math.round(sm.bearDownsidePct)}%).`,
    );
  }
  rationale.push(`Entry read: ${entry.label}. ${entry.rationale[0] ?? ""}`.trim());
  if (pick.upsideCase) rationale.push(`Upside case: ${pick.upsideCase}`);

  const whatWouldChange =
    pick.removalTriggers.length > 0
      ? pick.removalTriggers
      : ["Thesis break or sustained close below the invalidation level."];

  return {
    ticker: pick.ticker,
    companyName: pick.companyName,
    themes: pick.themes,
    subTheme: pick.subTheme ?? null,
    marketCapBucket: pick.marketCapBucket,
    ideaScore,
    tier: tierFromScore(ideaScore),
    convictionScore: pick.convictionScore,
    riskLevel: pick.riskLevel,
    scenarioClassification: sm?.classification ?? null,
    upsideClass: upsideClassFrom(sm?.classification ?? null),
    entryQuality: entry.quality,
    entryLabel: entry.label,
    price: km?.price ?? null,
    priceCurrency: km?.priceCurrency ?? null,
    bullUpsidePct: sm ? round(sm.bullUpsidePct, 1) : null,
    baseUpsidePct: sm ? round(sm.base.outputs.impliedReturnPct, 1) : null,
    bearDownsidePct: sm ? round(sm.bearDownsidePct, 1) : null,
    bullTargetPrice: sm?.bull.outputs.targetPrice ?? null,
    baseTargetPrice: sm?.base.outputs.targetPrice ?? null,
    bearTargetPrice: sm?.bear.outputs.targetPrice ?? null,
    rewardRisk: sm?.rewardRiskRatio ?? null,
    downsideGuardrail: pick.downsideGuardrail,
    invalidationLevel: invalidationLevel(pick),
    catalysts: pick.whatMustBeTrue,
    hasCatalysts: pick.whatMustBeTrue.length > 0,
    thesis: pick.thesis,
    whatMustBeTrue: pick.whatMustBeTrue,
    whatWouldChangeView: whatWouldChange,
    rationale: rationale.filter(Boolean),
    sourceNote: pick.sourceNote,
    dataConfidence: pick.dataConfidence,
    // Scenario derivation passthrough for the "How this was derived" drawer.
    scenarioMethod: sm?.method ?? null,
    scenarioModelType: sm?.modelType ?? null,
    scenarioCoverage: sm?.coverageConfidence ?? null,
    scenarioMethodology: sm?.methodology ?? null,
    scenarioHorizonYears: sm?.horizonYears ?? null,
    scenarioInputs: sm?.derivationInputs ?? null,
    scenarioMissingInputs: sm?.missingInputs ?? null,
    scenarioModelWarnings: sm?.modelWarnings ?? null,
    bullDerivation: sm?.bull.derivation ?? null,
    baseDerivation: sm?.base.derivation ?? null,
    bearDerivation: sm?.bear.derivation ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Option modeling (fallback, transparent)
//
// A deliberately simple Bachelier-ish premium proxy: ATM premium scales with
// price * ivProxy * sqrt(T). Strikes are placed off the current price and the
// scenario targets. Each structure produces net debit/credit, max risk, max
// reward, breakeven, an estimated profit probability (from the scenario
// execution weights and breakeven distance) and a modeled bull payoff multiple
// on capital at risk. None of this needs a live chain; it's an estimate.
// ─────────────────────────────────────────────────────────────────────────────

const STRUCTURES: OptionStructureInfo[] = [
  {
    kind: "long-call",
    label: "Long call",
    summary: "Buy an out-of-the-money call for leveraged, defined-risk upside.",
    bias: "Bullish, convex, max loss = premium",
  },
  {
    kind: "bull-call-spread",
    label: "Bull call spread",
    summary: "Buy a call, sell a higher call to cut cost and cap upside at a target.",
    bias: "Bullish, defined risk + defined reward",
  },
  {
    kind: "call-diagonal",
    label: "Call diagonal",
    summary: "Buy longer-dated lower call, sell shorter-dated higher call to finance it.",
    bias: "Bullish, time-spread, finances the long leg",
  },
  {
    kind: "cash-secured-put",
    label: "Cash-secured put",
    summary: "Sell a put at a level you'd be happy to own the stock; collect premium.",
    bias: "Bullish/neutral, income + entry below market",
  },
  {
    kind: "bull-put-spread",
    label: "Bull put spread",
    summary: "Sell a put, buy a lower put for a defined-risk bullish credit.",
    bias: "Bullish, defined-risk credit",
  },
];

// Standard-normal CDF (Abramowitz-Stegun) for a rough P(profit) estimate.
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

// Probability the stock is above `target` at horizon T (years), given an annual
// drift implied by the scenario base case and the vol proxy. Lognormal-ish.
function probAbove(
  price: number,
  target: number,
  ivPct: number,
  years: number,
  baseUpsidePct: number | null,
): number {
  if (price <= 0 || target <= 0) return 0;
  const sigma = (ivPct / 100) * Math.sqrt(Math.max(0.05, years));
  if (sigma <= 0) return target <= price ? 1 : 0;
  // Drift toward base-case scenario over the (5y) horizon, scaled to T.
  const annualDrift =
    baseUpsidePct != null ? Math.log(1 + clamp(baseUpsidePct, -50, 300) / 100) / 5 : 0.05;
  const mu = annualDrift * years;
  const z = (Math.log(target / price) - (mu - 0.5 * sigma * sigma)) / sigma;
  return clamp(1 - normCdf(z), 0, 1);
}

function atmPremium(price: number, ivPct: number, years: number): number {
  // ~ATM straddle-leg approximation: 0.4 * S * sigma * sqrt(T).
  return Math.max(0.01, 0.4 * price * (ivPct / 100) * Math.sqrt(Math.max(0.05, years)));
}

// Premium of an option `moneyness` away from ATM (fraction of price; + = OTM
// call / further from spot). Linear decay of the ATM premium with distance,
// floored so deep-OTM still costs something small.
function legPremium(
  atm: number,
  price: number,
  strike: number,
  right: "call" | "put",
): number {
  const dist = Math.abs(strike - price) / price;
  const otm =
    right === "call" ? strike > price : strike < price;
  const decay = otm ? Math.max(0.12, 1 - dist * 2.2) : Math.min(1.8, 1 + dist * 1.6);
  return Math.max(0.02, round(atm * decay, 2));
}

const HORIZON_MONTHS = 6; // headline horizon for V1 structures
const HORIZON_YEARS = HORIZON_MONTHS / 12;
const LONG_LEG_MONTHS = 9; // diagonal long leg

interface OptionBuildResult {
  legs: OptionLeg[];
  netDebit: number | null;
  netCredit: number | null;
  maxRisk: number | null;
  maxReward: number | null;
  breakeven: number | null;
  estProfitProbability: number | null;
  bullPayoffMultiple: number | null;
  scenarioTargetPrice: number | null;
  scenarioTargetLabel: string;
  whySelected: string[];
  whatMustHappen: string[];
  whyNotJustStock: string;
  limitations: string[];
}

function buildStructure(
  kind: OptionStructureKind,
  long: LongWithVol,
): OptionBuildResult | null {
  const price = long.price;
  if (price == null || price <= 0) return null;
  const iv = long.ivProxyForOptions;
  const atm = atmPremium(price, iv, HORIZON_YEARS);
  const baseTarget = long.baseTargetPrice;
  const bullTarget = long.bullTargetPrice;
  const baseUpside = long.baseUpsidePct;

  const fmtPct = (p: number | null) =>
    p == null ? "" : `${p >= 0 ? "+" : ""}${Math.round(p)}%`;

  switch (kind) {
    case "long-call": {
      const strike = round(price * 1.05, 2); // slightly OTM
      const prem = legPremium(atm, price, strike, "call");
      const target = bullTarget ?? round(price * 1.6, 2);
      const breakeven = round(strike + prem, 2);
      const payoffAtTarget = Math.max(0, target - strike) - prem;
      const bullMult = prem > 0 ? round((payoffAtTarget + prem) / prem, 2) : null;
      const pop = probAbove(price, breakeven, iv, HORIZON_YEARS, baseUpside);
      return {
        legs: [{ action: "buy", right: "call", strike, expiryMonths: HORIZON_MONTHS, premium: prem }],
        netDebit: prem,
        netCredit: null,
        maxRisk: prem,
        maxReward: null, // uncapped
        breakeven,
        estProfitProbability: round(pop, 2),
        bullPayoffMultiple: bullMult,
        scenarioTargetPrice: target,
        scenarioTargetLabel: `Bull ${fmtPct(long.bullUpsidePct)}`,
        whySelected: [
          `Convex, defined-risk way to express the ${long.upsideClass} thesis.`,
          `Max loss is the ${prem.toFixed(2)}/sh premium; upside is uncapped toward the bull target ${target}.`,
        ],
        whatMustHappen: [
          `Stock above breakeven ${breakeven} by expiry (~${HORIZON_MONTHS}m).`,
          long.catalysts[0] ?? "A catalyst re-rates the name within the horizon.",
        ],
        whyNotJustStock:
          "Caps capital at risk to the premium while keeping uncapped upside — useful when you want leverage without margin or a hard stop.",
        limitations: [
          "Time decay works against you; a flat stock loses the whole premium.",
          "Modeled premium is a volatility-proxy estimate, not a live quote.",
        ],
      };
    }
    case "bull-call-spread": {
      const longStrike = round(price * 1.02, 2);
      const shortStrike = round(Math.max(baseTarget ?? price * 1.35, longStrike * 1.1), 2);
      const longPrem = legPremium(atm, price, longStrike, "call");
      const shortPrem = legPremium(atm, price, shortStrike, "call");
      const netDebit = round(Math.max(0.02, longPrem - shortPrem), 2);
      const width = round(shortStrike - longStrike, 2);
      const maxReward = round(Math.max(0, width - netDebit), 2);
      const breakeven = round(longStrike + netDebit, 2);
      const bullMult = netDebit > 0 ? round((maxReward + netDebit) / netDebit, 2) : null;
      const pop = probAbove(price, breakeven, iv, HORIZON_YEARS, baseUpside);
      return {
        legs: [
          { action: "buy", right: "call", strike: longStrike, expiryMonths: HORIZON_MONTHS, premium: longPrem },
          { action: "sell", right: "call", strike: shortStrike, expiryMonths: HORIZON_MONTHS, premium: shortPrem },
        ],
        netDebit,
        netCredit: null,
        maxRisk: netDebit,
        maxReward,
        breakeven,
        estProfitProbability: round(pop, 2),
        bullPayoffMultiple: bullMult,
        scenarioTargetPrice: shortStrike,
        scenarioTargetLabel: `Base ${fmtPct(baseUpside)}`,
        whySelected: [
          `Cheaper than a naked call: selling the ${shortStrike} call funds part of the long leg.`,
          `Reward capped at the base-case target — fits a ${long.upsideClass} thesis that grinds rather than explodes.`,
        ],
        whatMustHappen: [
          `Stock above breakeven ${breakeven} (ideally near ${shortStrike}) by ~${HORIZON_MONTHS}m.`,
          long.catalysts[0] ?? "Base-case execution plays out on schedule.",
        ],
        whyNotJustStock:
          "Defined risk AND defined reward for a fraction of the capital — you trade away unlimited upside for a much smaller, fully-known max loss.",
        limitations: [
          "Upside is capped at the short strike — you give up the bull tail.",
          "Both legs are modeled premiums, not live quotes.",
        ],
      };
    }
    case "call-diagonal": {
      const longStrike = round(price * 0.98, 2);
      const shortStrike = round(price * 1.12, 2);
      const longPrem = legPremium(atmPremium(price, iv, LONG_LEG_MONTHS / 12), price, longStrike, "call");
      const shortPrem = legPremium(atm, price, shortStrike, "call");
      const netDebit = round(Math.max(0.05, longPrem - shortPrem), 2);
      const target = baseTarget ?? round(price * 1.3, 2);
      const breakeven = round(longStrike + netDebit, 2);
      // Diagonal payoff is path-dependent; we model the upside at the short
      // strike at the near expiry as a conservative reward proxy.
      const rewardProxy = round(Math.max(0, shortStrike - longStrike - netDebit), 2);
      const bullMult = netDebit > 0 ? round((rewardProxy + netDebit) / netDebit, 2) : null;
      const pop = probAbove(price, breakeven, iv, LONG_LEG_MONTHS / 12, baseUpside);
      return {
        legs: [
          { action: "buy", right: "call", strike: longStrike, expiryMonths: LONG_LEG_MONTHS, premium: longPrem },
          { action: "sell", right: "call", strike: shortStrike, expiryMonths: HORIZON_MONTHS, premium: shortPrem },
        ],
        netDebit,
        netCredit: null,
        maxRisk: netDebit,
        maxReward: rewardProxy,
        breakeven,
        estProfitProbability: round(pop, 2),
        bullPayoffMultiple: bullMult,
        scenarioTargetPrice: target,
        scenarioTargetLabel: `Base ${fmtPct(baseUpside)}`,
        whySelected: [
          `Longer-dated ${longStrike} call gives staying power; the shorter ${shortStrike} call sold against it cuts cost.`,
          "Best when you expect a steady grind toward the base case with periodic premium to roll.",
        ],
        whatMustHappen: [
          `Stock drifts toward ${shortStrike} without blowing through it before the near expiry (~${HORIZON_MONTHS}m).`,
          "You actively manage / roll the short leg.",
        ],
        whyNotJustStock:
          "Finances a long-dated bullish position with recurring short-call premium — lower net cost than owning the stock, but it needs management.",
        limitations: [
          "Path-dependent and requires rolling the short leg; payoff proxy is conservative.",
          "A fast spike above the short strike caps near-term gains.",
        ],
      };
    }
    case "cash-secured-put": {
      const strike = round(price * 0.9, 2); // sell put 10% below
      const prem = legPremium(atm, price, strike, "put");
      const breakeven = round(strike - prem, 2);
      const maxRisk = round(strike - prem, 2); // assigned & stock → 0 (capital secured)
      const bullMult = maxRisk > 0 ? round(prem / maxRisk + 1, 2) : null;
      // Profit if stock stays above the strike (keep premium) — P(above strike).
      const pop = probAbove(price, strike, iv, HORIZON_YEARS, baseUpside);
      return {
        legs: [{ action: "sell", right: "put", strike, expiryMonths: HORIZON_MONTHS, premium: prem }],
        netDebit: null,
        netCredit: prem,
        maxRisk,
        maxReward: prem,
        breakeven,
        estProfitProbability: round(pop, 2),
        bullPayoffMultiple: bullMult,
        scenarioTargetPrice: strike,
        scenarioTargetLabel: `Entry ${fmtPct(((strike - price) / price) * 100)}`,
        whySelected: [
          `Get paid ${prem.toFixed(2)}/sh to commit to buying at ${strike} — a level below market on a name you'd want to own.`,
          "Fits a constructive thesis where you're happy to be assigned on a dip.",
        ],
        whatMustHappen: [
          `Stock stays above ${strike} to keep the full premium, or you accept assignment at an effective ${breakeven}.`,
        ],
        whyNotJustStock:
          "Lets you set a disciplined buy level below market and collect income while you wait — versus chasing the stock here.",
        limitations: [
          "Upside is limited to the premium; a rip higher leaves you behind.",
          "Full assignment risk if the stock collapses — secured by cash for the whole strike.",
        ],
      };
    }
    case "bull-put-spread": {
      const shortStrike = round(price * 0.92, 2);
      const longStrike = round(price * 0.82, 2);
      const shortPrem = legPremium(atm, price, shortStrike, "put");
      const longPrem = legPremium(atm, price, longStrike, "put");
      const netCredit = round(Math.max(0.02, shortPrem - longPrem), 2);
      const width = round(shortStrike - longStrike, 2);
      const maxRisk = round(Math.max(0.02, width - netCredit), 2);
      const breakeven = round(shortStrike - netCredit, 2);
      const bullMult = maxRisk > 0 ? round(netCredit / maxRisk + 1, 2) : null;
      const pop = probAbove(price, shortStrike, iv, HORIZON_YEARS, baseUpside);
      return {
        legs: [
          { action: "sell", right: "put", strike: shortStrike, expiryMonths: HORIZON_MONTHS, premium: shortPrem },
          { action: "buy", right: "put", strike: longStrike, expiryMonths: HORIZON_MONTHS, premium: longPrem },
        ],
        netDebit: null,
        netCredit,
        maxRisk,
        maxReward: netCredit,
        breakeven,
        estProfitProbability: round(pop, 2),
        bullPayoffMultiple: bullMult,
        scenarioTargetPrice: shortStrike,
        scenarioTargetLabel: `Hold ${fmtPct(((shortStrike - price) / price) * 100)}`,
        whySelected: [
          `Defined-risk credit: collect ${netCredit.toFixed(2)}/sh as long as the stock holds above ${shortStrike}.`,
          "Lower capital and risk than a cash-secured put for a similar bullish/neutral lean.",
        ],
        whatMustHappen: [
          `Stock stays above ${shortStrike} through ~${HORIZON_MONTHS}m; max loss below ${longStrike}.`,
        ],
        whyNotJustStock:
          "Profits if the stock merely holds a level — you don't need it to rise. Max loss is capped by the long put, unlike owning shares outright.",
        limitations: [
          "Reward capped at the credit; one bad gap below the long strike is the max loss.",
          "Both legs are modeled premiums, not live quotes.",
        ],
      };
    }
    default:
      return null;
  }
}

// Which structures make sense for a given thesis. Higher-upside, higher-vol
// names lean to calls/spreads/diagonals; steadier names also get the
// put-selling structures (entry-oriented, income).
function structuresFor(long: TradeIdeaLong): OptionStructureKind[] {
  const c = long.scenarioClassification;
  const highUpside = c === "2x potential" || c === "3x potential" || c === "5x potential" || c === "speculative";
  const steady = c === "defensive" || c === "compounder";
  const out: OptionStructureKind[] = ["long-call", "bull-call-spread"];
  if (highUpside) out.push("call-diagonal");
  if (steady || long.riskLevel === "low" || long.riskLevel === "moderate") {
    out.push("cash-secured-put", "bull-put-spread");
  } else {
    out.push("bull-put-spread");
  }
  return out;
}

const STRUCTURE_LABEL: Record<OptionStructureKind, string> = {
  "long-call": "Long call",
  "bull-call-spread": "Bull call spread",
  "call-diagonal": "Call diagonal",
  "cash-secured-put": "Cash-secured put",
  "bull-put-spread": "Bull put spread",
};

// Extend TradeIdeaLong with a scratch field for the vol proxy so buildStructure
// can read it without recomputation. Kept internal to this module.
type LongWithVol = TradeIdeaLong & { ivProxyForOptions: number };

function buildOption(
  kind: OptionStructureKind,
  long: LongWithVol,
  pick: StockPick,
): TradeIdeaOption | null {
  const r = buildStructure(kind, long);
  if (!r) return null;

  const doubleCandidate = (r.bullPayoffMultiple ?? 0) >= 2;
  const tripleCandidate = (r.bullPayoffMultiple ?? 0) >= 3;
  const multipleLabel = tripleCandidate
    ? "3x scenario"
    : doubleCandidate
      ? "2x scenario"
      : null;

  // Payoff-adjusted actionability score: blend the inherited thesis score, the
  // estimated profit probability, and the modeled payoff multiple — but cap the
  // payoff contribution so low-probability lottery tickets can't dominate.
  const popPts = (r.estProfitProbability ?? 0.4) * 100;
  const payoffPts = clamp((r.bullPayoffMultiple ?? 1) * 18, 0, 75);
  const actionability = round(
    long.ideaScore * 0.45 + popPts * 0.35 + payoffPts * 0.2,
    0,
  );

  return {
    id: `${long.ticker}-${kind}`,
    ticker: long.ticker,
    companyName: long.companyName,
    kind,
    structureLabel: STRUCTURE_LABEL[kind],
    thesisScore: long.ideaScore,
    actionabilityScore: actionability,
    tier: tierFromScore(actionability),
    scenarioTargetPrice: r.scenarioTargetPrice,
    scenarioTargetLabel: r.scenarioTargetLabel,
    doubleCandidate,
    tripleCandidate,
    multipleLabel,
    price: long.price,
    priceCurrency: long.priceCurrency,
    legs: r.legs,
    netDebit: r.netDebit,
    netCredit: r.netCredit,
    maxRisk: r.maxRisk,
    maxReward: r.maxReward,
    breakeven: r.breakeven,
    estProfitProbability: r.estProfitProbability,
    bullPayoffMultiple: r.bullPayoffMultiple,
    expiryMonths: kind === "call-diagonal" ? LONG_LEG_MONTHS : HORIZON_MONTHS,
    expiryHorizonLabel:
      kind === "call-diagonal" ? `~${LONG_LEG_MONTHS}m (near leg ~${HORIZON_MONTHS}m)` : `~${HORIZON_MONTHS} months`,
    ivProxyPct: long.ivProxyForOptions,
    whySelected: r.whySelected,
    whatMustHappen: r.whatMustHappen,
    whyNotJustStock: r.whyNotJustStock,
    limitations: r.limitations,
    dataMode: "modeled-fallback" as TradeIdeaDataMode,
    dataConfidence: pick.dataConfidence === "curated" ? "approximate" : pick.dataConfidence,
  };
}

async function buildResponse(): Promise<TradeIdeasResponse> {
  const picksResp = await getStockPicks();
  const picks = picksResp.picks;

  const longs: TradeIdeaLong[] = picks
    .map((p) => buildLong(p))
    .sort((a, b) => b.ideaScore - a.ideaScore);

  // Build options from the strongest long theses. Cap the universe so the table
  // stays high-signal; the top ~36 longs are more than enough for V1.
  const optionPickByTicker = new Map<string, StockPick>();
  for (const p of picks) optionPickByTicker.set(p.ticker, p);

  const options: TradeIdeaOption[] = [];
  for (const long of longs.slice(0, 36)) {
    const pick = optionPickByTicker.get(long.ticker);
    if (!pick || long.price == null) continue;
    const lwv: LongWithVol = { ...long, ivProxyForOptions: ivProxyPct(pick) };
    for (const kind of structuresFor(long)) {
      const opt = buildOption(kind, lwv, pick);
      if (opt) options.push(opt);
    }
  }
  options.sort((a, b) => b.actionabilityScore - a.actionabilityScore);

  return {
    asOf: Date.now(),
    longs,
    options,
    structures: STRUCTURES,
    universeSize: picks.length,
    optionsDataMode: "modeled-fallback",
    metricsStatus: {
      livePricing: picksResp.metricsStatus.livePricing,
      fundamentals: picksResp.metricsStatus.fundamentals,
      optionChain: false,
    },
    methodology: {
      longs:
        "Each long idea reuses the curated conviction score, risk level and the deterministic scenario model (bull/base/bear target multiples and reward/risk) from Stock Picks. Idea score = 40% conviction + 25% scenario reward/risk + 20% entry quality + 15% base-case room. Entry quality is derived from trailing 6m momentum vs remaining base-case upside. Nothing is forecast; ranking is a transparent weighted blend.",
      options:
        "Option structures are MODELED FALLBACKS — no live option chain is wired. Premiums use an ATM proxy (0.4 · price · vol · √T) where vol is a risk-level proxy; strikes are placed off current price and the scenario targets. Max risk/reward, breakeven, an estimated profit probability (lognormal drift toward the base case) and a bull payoff multiple on capital at risk are computed per structure. Ideas are ranked by a payoff-adjusted actionability score (45% thesis score + 35% est. profit probability + 20% capped payoff multiple) so defined-risk, higher-probability structures outrank low-odds long shots. 2x/3x flags mean the modeled bull payoff on risk reaches ≥2x/≥3x — a scenario, not a promise.",
    },
    disclaimer: DISCLAIMER,
  };
}

export async function getTradeIdeas(): Promise<TradeIdeasResponse> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.data;
  const data = await buildResponse();
  cached = { at: now, data };
  return data;
}
