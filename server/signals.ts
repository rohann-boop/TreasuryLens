// Deterministic signal engine. Pure functions — no I/O, no provider calls.
// Consumes an InstrumentSnapshot (already cached) and returns a ModelSignal
// describing entry/exit levels, sub-model scores, and a composite signal.
//
// IMPORTANT (UX/legal): outputs are labelled "model signal" / "research
// signal" in the UI. Never present as personalised advice. Pure heuristics
// over publicly-available technicals.

import type {
  InstrumentSnapshot,
  ModelSignal,
  SignalConfig,
  SubModelOutput,
  SignalLabel,
  ConfidenceLabel,
  ModelProfile,
} from "@shared/schema";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export const DEFAULT_CONFIG: SignalConfig = {
  downsidePct: 5,
  upsidePct: 20,
  horizonDays: 30,
  profile: "balanced",
  confidenceThreshold: 60,
};

export function parseSignalConfig(q: Record<string, unknown>): SignalConfig {
  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const downsidePct = clamp(num(q.downside, DEFAULT_CONFIG.downsidePct), 0.1, 95);
  const upsidePct = clamp(num(q.upside, DEFAULT_CONFIG.upsidePct), 0.1, 500);
  const horizonRaw = num(q.horizon, DEFAULT_CONFIG.horizonDays);
  const horizonDays: 7 | 30 | 90 =
    horizonRaw <= 14 ? 7 : horizonRaw <= 60 ? 30 : 90;
  const profileRaw = String(q.profile ?? DEFAULT_CONFIG.profile).toLowerCase();
  const profile: ModelProfile =
    profileRaw === "conservative" || profileRaw === "aggressive"
      ? profileRaw
      : "balanced";
  const confidenceThreshold = clamp(
    num(q.threshold, DEFAULT_CONFIG.confidenceThreshold),
    0,
    100,
  );
  return { downsidePct, upsidePct, horizonDays, profile, confidenceThreshold };
}

// -------------------- sub-model scorers --------------------

function trendModel(s: InstrumentSnapshot): SubModelOutput {
  const bullets: string[] = [];
  const px = s.price;
  let score = 50;
  let available = true;
  if (px == null) {
    return {
      key: "trend",
      name: "Trend",
      score: 50,
      weight: 0,
      bullets: ["Price unavailable — neutral."],
      available: false,
    };
  }
  // Price vs SMAs (each contributes 10pts when above, -10 when below)
  const above = (sma: number | null) =>
    sma == null ? null : px > sma ? 1 : px < sma ? -1 : 0;
  const a20 = above(s.sma20);
  const a50 = above(s.sma50);
  const a200 = above(s.sma200);
  if (a20 != null) score += a20 * 8;
  if (a50 != null) score += a50 * 10;
  if (a200 != null) score += a200 * 12;
  bullets.push(
    `Price ${px.toFixed(2)} vs SMA20 ${s.sma20?.toFixed(2) ?? "—"} / SMA50 ${
      s.sma50?.toFixed(2) ?? "—"
    } / SMA200 ${s.sma200?.toFixed(2) ?? "—"}.`,
  );

  // MA alignment: 20>50>200 = bullish stack
  if (s.sma20 != null && s.sma50 != null && s.sma200 != null) {
    if (s.sma20 > s.sma50 && s.sma50 > s.sma200) {
      score += 10;
      bullets.push("Bullish MA stack (20 > 50 > 200).");
    } else if (s.sma20 < s.sma50 && s.sma50 < s.sma200) {
      score -= 10;
      bullets.push("Bearish MA stack (20 < 50 < 200).");
    } else {
      bullets.push("MA alignment mixed.");
    }
  } else {
    available = false;
    bullets.push("Insufficient SMA history — alignment skipped.");
  }

  // SMA50 trend direction
  if (s.sma50Trend === "up") {
    score += 5;
    bullets.push("SMA50 sloping up.");
  } else if (s.sma50Trend === "down") {
    score -= 5;
    bullets.push("SMA50 sloping down.");
  }

  return {
    key: "trend",
    name: "Trend",
    score: clamp(score),
    weight: 0,
    bullets,
    available,
  };
}

function momentumModel(s: InstrumentSnapshot): SubModelOutput {
  const bullets: string[] = [];
  let score = 50;
  let available = true;
  // RSI: 30..70 sweet zone; below 30 = oversold (slight bull edge),
  // above 70 = overbought (bearish for entry)
  if (s.rsi14 != null) {
    if (s.rsi14 < 30) {
      score += 8;
      bullets.push(`RSI ${s.rsi14.toFixed(1)} — oversold (mean-reversion edge).`);
    } else if (s.rsi14 > 70) {
      score -= 12;
      bullets.push(`RSI ${s.rsi14.toFixed(1)} — overheated; entry risk.`);
    } else if (s.rsi14 >= 50 && s.rsi14 <= 65) {
      score += 6;
      bullets.push(`RSI ${s.rsi14.toFixed(1)} — healthy momentum.`);
    } else {
      bullets.push(`RSI ${s.rsi14.toFixed(1)} — neutral.`);
    }
  } else {
    available = false;
    bullets.push("RSI unavailable.");
  }
  // 7d return
  if (s.return7d != null) {
    score += clamp(s.return7d, -10, 10);
    bullets.push(`7d return ${s.return7d.toFixed(2)}%.`);
  }
  // 30d return — wider band
  if (s.return30d != null) {
    score += clamp(s.return30d / 2, -12, 12);
    bullets.push(`30d return ${s.return30d.toFixed(2)}%.`);
  }
  // Distance from 52w high
  if (s.distFrom52wHigh != null) {
    if (s.distFrom52wHigh > -5) {
      score += 6;
      bullets.push(
        `Within ${Math.abs(s.distFrom52wHigh).toFixed(1)}% of 52w high.`,
      );
    } else if (s.distFrom52wHigh < -30) {
      score -= 8;
      bullets.push(
        `${Math.abs(s.distFrom52wHigh).toFixed(1)}% below 52w high — deep correction.`,
      );
    } else {
      bullets.push(`${Math.abs(s.distFrom52wHigh).toFixed(1)}% off 52w high.`);
    }
  }
  return {
    key: "momentum",
    name: "Momentum",
    score: clamp(score),
    weight: 0,
    bullets,
    available,
  };
}

function riskModel(s: InstrumentSnapshot): SubModelOutput {
  const bullets: string[] = [];
  let score = 50;
  let available = true;
  // 30d annualised vol — higher vol = more risk for fixed downside
  if (s.vol30dAnnualized != null) {
    if (s.vol30dAnnualized > 100) {
      score -= 12;
      bullets.push(`Vol ${s.vol30dAnnualized.toFixed(0)}% (very high).`);
    } else if (s.vol30dAnnualized > 60) {
      score -= 6;
      bullets.push(`Vol ${s.vol30dAnnualized.toFixed(0)}% (elevated).`);
    } else if (s.vol30dAnnualized < 25) {
      score += 6;
      bullets.push(`Vol ${s.vol30dAnnualized.toFixed(0)}% (calm).`);
    } else {
      bullets.push(`Vol ${s.vol30dAnnualized.toFixed(0)}% (normal).`);
    }
  } else {
    available = false;
    bullets.push("Volatility unavailable.");
  }
  // Max drawdown
  if (s.maxDrawdownPct != null) {
    if (s.maxDrawdownPct < -50) {
      score -= 8;
      bullets.push(`Max drawdown ${s.maxDrawdownPct.toFixed(1)}% — severe.`);
    } else if (s.maxDrawdownPct > -15) {
      score += 6;
      bullets.push(`Max drawdown ${s.maxDrawdownPct.toFixed(1)}% — shallow.`);
    } else {
      bullets.push(`Max drawdown ${s.maxDrawdownPct.toFixed(1)}%.`);
    }
  }
  // Sharpe-like
  if (s.sharpeLike30d != null) {
    if (s.sharpeLike30d > 1.5) {
      score += 8;
      bullets.push(`Sharpe-like 30d ${s.sharpeLike30d.toFixed(2)} — strong.`);
    } else if (s.sharpeLike30d < -1) {
      score -= 8;
      bullets.push(`Sharpe-like 30d ${s.sharpeLike30d.toFixed(2)} — negative.`);
    } else {
      bullets.push(`Sharpe-like 30d ${s.sharpeLike30d.toFixed(2)}.`);
    }
  }
  // Beta to BTC — high beta in choppy regime is a risk drag
  if (!s.relIsSelf && s.betaToBtc90d != null) {
    if (Math.abs(s.betaToBtc90d) > 2) {
      score -= 6;
      bullets.push(
        `Beta to BTC ${s.betaToBtc90d.toFixed(2)} — amplified swings.`,
      );
    } else {
      bullets.push(`Beta to BTC ${s.betaToBtc90d.toFixed(2)}.`);
    }
    if (s.corrToBtc90d != null) {
      bullets.push(`Corr(BTC) 90d ${s.corrToBtc90d.toFixed(2)}.`);
    }
  } else if (s.relIsSelf) {
    bullets.push("Self is benchmark (BTC).");
  }
  // Demo data — knock confidence down
  if (s.status === "demo") {
    score -= 4;
    available = false;
    bullets.push("Demo data — interpret with caution.");
  } else if (s.status === "error") {
    score = 50;
    available = false;
    bullets.push("Provider error — model neutral.");
  }
  return {
    key: "risk",
    name: "Risk / Relative",
    score: clamp(score),
    weight: 0,
    bullets,
    available,
  };
}

function valuationModel(s: InstrumentSnapshot): SubModelOutput | null {
  // Optional fourth model — only attaches when we have meaningful inputs.
  const bullets: string[] = [];
  let score = 50;
  let available = false;

  if (s.treasury && s.treasury.mNav != null) {
    available = true;
    const m = s.treasury.mNav;
    if (m < 1) {
      score += 18;
      bullets.push(`mNAV ${m.toFixed(2)} — trading below BTC NAV (deep value).`);
    } else if (m < 1.5) {
      score += 10;
      bullets.push(`mNAV ${m.toFixed(2)} — moderate premium.`);
    } else if (m < 2.5) {
      bullets.push(`mNAV ${m.toFixed(2)} — rich premium to BTC NAV.`);
    } else {
      score -= 12;
      bullets.push(`mNAV ${m.toFixed(2)} — very rich premium.`);
    }
    if (s.treasury.btcYieldPct != null) {
      if (s.treasury.btcYieldPct > 0) {
        score += 6;
        bullets.push(
          `BTC/share yield +${s.treasury.btcYieldPct.toFixed(2)}% since baseline.`,
        );
      } else {
        bullets.push(
          `BTC/share yield ${s.treasury.btcYieldPct.toFixed(2)}% since baseline.`,
        );
      }
    }
    return {
      key: "valuation",
      name: "Valuation / Treasury",
      score: clamp(score),
      weight: 0,
      bullets,
      available,
    };
  }

  if (s.peRatio != null && s.instrument.assetClass === "equity") {
    available = true;
    if (s.peRatio < 0) {
      score -= 6;
      bullets.push(`P/E ${s.peRatio.toFixed(1)} — earnings negative.`);
    } else if (s.peRatio < 15) {
      score += 8;
      bullets.push(`P/E ${s.peRatio.toFixed(1)} — value range.`);
    } else if (s.peRatio < 30) {
      bullets.push(`P/E ${s.peRatio.toFixed(1)} — fair range.`);
    } else if (s.peRatio < 60) {
      score -= 4;
      bullets.push(`P/E ${s.peRatio.toFixed(1)} — premium.`);
    } else {
      score -= 10;
      bullets.push(`P/E ${s.peRatio.toFixed(1)} — extreme.`);
    }
    return {
      key: "valuation",
      name: "Valuation",
      score: clamp(score),
      weight: 0,
      bullets,
      available,
    };
  }
  return null;
}

// -------------------- composition --------------------

function profileWeights(profile: ModelProfile, hasValuation: boolean) {
  // Base allocation across (trend, momentum, risk, valuation).
  // Conservative leans on risk + valuation; aggressive leans on momentum.
  let trend: number, momentum: number, risk: number, valuation: number;
  switch (profile) {
    case "conservative":
      trend = 0.25; momentum = 0.15; risk = 0.4; valuation = 0.2;
      break;
    case "aggressive":
      trend = 0.35; momentum = 0.4; risk = 0.15; valuation = 0.1;
      break;
    case "balanced":
    default:
      trend = 0.3; momentum = 0.3; risk = 0.25; valuation = 0.15;
  }
  if (!hasValuation) {
    // Redistribute valuation weight evenly across the other three.
    const add = valuation / 3;
    trend += add; momentum += add; risk += add;
    valuation = 0;
  }
  return { trend, momentum, risk, valuation };
}

function labelForScore(score: number, threshold: number): SignalLabel {
  if (score >= Math.max(80, threshold + 15)) return "Strong Buy";
  if (score >= threshold) return "Buy";
  if (score >= 50) return "Watch";
  if (score >= 40) return "Hold";
  if (score >= 25) return "Trim";
  return "Sell";
}

function confidenceLabel(score: number, available: number, total: number): ConfidenceLabel {
  const dataFrac = total > 0 ? available / total : 0;
  if (dataFrac < 0.5) return "Low";
  // Distance from 50 indicates conviction either way
  const conviction = Math.abs(score - 50);
  if (conviction >= 25 && dataFrac >= 0.75) return "High";
  if (conviction >= 12) return "Medium";
  return "Low";
}

// Suggested entry zone: a few percent below current toward the stop.
// Suggested exit zone: 0.7..1.0 of upside target (scale into target).
function buildZones(price: number, stop: number, target: number) {
  const entryHigh = price; // up to spot
  // Entry low slightly above stop (don't dip into stop range): halfway
  // between price and stop, but capped at -2% from price for tight setups.
  const entryLow = Math.max(
    stop * 1.005,
    price - (price - stop) * 0.45,
  );
  const exitLow = price + (target - price) * 0.7;
  const exitHigh = target;
  return { entryLow, entryHigh, exitLow, exitHigh };
}

export function computeSignal(
  s: InstrumentSnapshot,
  cfg: SignalConfig = DEFAULT_CONFIG,
): ModelSignal {
  const invalidReasons: string[] = [];
  const notes: string[] = [];

  if (cfg.downsidePct <= 0)
    invalidReasons.push("Downside risk must be greater than 0%.");
  if (cfg.upsidePct <= 0)
    invalidReasons.push("Upside target must be greater than 0%.");
  if (cfg.upsidePct < cfg.downsidePct)
    invalidReasons.push(
      "Upside target is smaller than downside risk — reward/risk < 1.",
    );

  const px = s.price;
  const stopPrice = px != null ? px * (1 - cfg.downsidePct / 100) : null;
  const targetPrice = px != null ? px * (1 + cfg.upsidePct / 100) : null;
  const rewardRisk =
    cfg.downsidePct > 0 ? cfg.upsidePct / cfg.downsidePct : null;

  // Sub-models
  const trend = trendModel(s);
  const momentum = momentumModel(s);
  const risk = riskModel(s);
  const valuation = valuationModel(s);

  const w = profileWeights(cfg.profile, !!valuation);
  trend.weight = w.trend;
  momentum.weight = w.momentum;
  risk.weight = w.risk;
  if (valuation) valuation.weight = w.valuation;

  const subs: SubModelOutput[] = [trend, momentum, risk, ...(valuation ? [valuation] : [])];
  const composite = clamp(
    subs.reduce((acc, m) => acc + m.score * m.weight, 0) /
      (subs.reduce((acc, m) => acc + m.weight, 0) || 1),
  );

  // Penalise composite slightly if reward/risk too tight (e.g. < 2:1).
  let adjusted = composite;
  if (rewardRisk != null && rewardRisk < 2) adjusted -= 8;
  else if (rewardRisk != null && rewardRisk >= 4) adjusted += 5;
  adjusted = clamp(adjusted);

  // Horizon nudges (short horizon = lean on momentum/trend; long = risk/valuation)
  if (cfg.horizonDays === 7) {
    adjusted = clamp(adjusted * 0.6 + momentum.score * 0.4);
  } else if (cfg.horizonDays === 90) {
    adjusted = clamp(
      adjusted * 0.7 +
        risk.score * 0.15 +
        (valuation ? valuation.score : 50) * 0.15,
    );
  }

  const availableCount = subs.filter((m) => m.available).length;
  const confidence = confidenceLabel(adjusted, availableCount, subs.length);

  // Invalid: too tight reward/risk OR demo with insufficient data
  if (rewardRisk != null && rewardRisk < 1) {
    invalidReasons.push(`Reward/risk ${rewardRisk.toFixed(2)} below 1.`);
  }
  if (px == null) {
    invalidReasons.push("Current price unavailable — cannot derive levels.");
  }

  const isInvalid = invalidReasons.length > 0;
  let signal: SignalLabel = isInvalid
    ? "Invalid Setup"
    : labelForScore(adjusted, cfg.confidenceThreshold);

  // Force "Watch"/below if trend strongly down and signal would be Buy
  if (
    !isInvalid &&
    (signal === "Buy" || signal === "Strong Buy") &&
    trend.score < 35
  ) {
    signal = "Watch";
    notes.push("Buy gated: trend score weak — wait for trend confirmation.");
  }
  // Overbought RSI gates Strong Buy
  if (!isInvalid && signal === "Strong Buy" && s.rsi14 != null && s.rsi14 > 75) {
    signal = "Buy";
    notes.push("Downgraded from Strong Buy: RSI overbought.");
  }

  // Zones
  let entryZoneLow: number | null = null,
    entryZoneHigh: number | null = null,
    exitZoneLow: number | null = null,
    exitZoneHigh: number | null = null,
    maxChasePrice: number | null = null;
  if (px != null && stopPrice != null && targetPrice != null) {
    const z = buildZones(px, stopPrice, targetPrice);
    entryZoneLow = z.entryLow;
    entryZoneHigh = z.entryHigh;
    exitZoneLow = z.exitLow;
    exitZoneHigh = z.exitHigh;
    // Max chase: 2% above current (don't chase further than that)
    maxChasePrice = px * 1.02;
  }

  // Entry conditions (transparent to user)
  const entryConditions = [
    {
      label: `Composite >= ${cfg.confidenceThreshold} (current ${adjusted.toFixed(0)})`,
      pass: adjusted >= cfg.confidenceThreshold,
    },
    {
      label: `Trend score positive (current ${trend.score.toFixed(0)})`,
      pass: trend.score >= 50,
    },
    {
      label: `RSI not overheated (current ${
        s.rsi14 != null ? s.rsi14.toFixed(0) : "—"
      })`,
      pass: s.rsi14 == null || s.rsi14 <= 70,
    },
    {
      label: `Reward/risk >= 3 (current ${rewardRisk != null ? rewardRisk.toFixed(2) : "—"})`,
      pass: rewardRisk != null && rewardRisk >= 3,
    },
    {
      label: `Price at/below max chase (${
        maxChasePrice != null ? maxChasePrice.toFixed(2) : "—"
      })`,
      pass: px != null && maxChasePrice != null && px <= maxChasePrice,
    },
  ];

  const sma50 = s.sma50;
  const exitConditions = [
    {
      label: `Price reaches target (${targetPrice != null ? targetPrice.toFixed(2) : "—"})`,
      trigger: px != null && targetPrice != null && px >= targetPrice,
    },
    {
      label: `Stop breached (${stopPrice != null ? stopPrice.toFixed(2) : "—"})`,
      trigger: px != null && stopPrice != null && px <= stopPrice,
    },
    {
      label: `Trend break: close below SMA50 (${sma50 != null ? sma50.toFixed(2) : "—"})`,
      trigger: px != null && sma50 != null && px < sma50 && (s.sma50Trend === "down"),
    },
    {
      label: `Composite drops below ${Math.max(40, cfg.confidenceThreshold - 20)} (current ${adjusted.toFixed(0)})`,
      trigger: adjusted < Math.max(40, cfg.confidenceThreshold - 20),
    },
    {
      label: `RSI > 80 (overbought take-profit, current ${s.rsi14 != null ? s.rsi14.toFixed(0) : "—"})`,
      trigger: s.rsi14 != null && s.rsi14 > 80,
    },
  ];

  return {
    config: cfg,
    asOf: s.asOf,
    currentPrice: px,
    stopPrice,
    targetPrice,
    maxChasePrice,
    entryZoneLow,
    entryZoneHigh,
    exitZoneLow,
    exitZoneHigh,
    rewardRiskRatio: rewardRisk,
    compositeScore: adjusted,
    confidence,
    signal,
    models: subs,
    entryConditions,
    exitConditions,
    invalidReasons,
    notes,
  };
}
