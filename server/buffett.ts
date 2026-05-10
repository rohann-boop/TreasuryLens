import type {
  BuffettCategory,
  BuffettIndex,
  EquityFundamentals,
  InstrumentSnapshot,
} from "@shared/schema";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function label(score: number | null, coverage: number) {
  if (score == null) return "Not applicable";
  if (coverage < 0.45) return "Incomplete — needs fundamentals";
  if (score >= 85) return "Wonderful business, attractive";
  if (score >= 70) return "High quality, watch valuation";
  if (score >= 55) return "Average or incomplete";
  if (score >= 40) return "Weak quality or too expensive";
  return "Avoid";
}

function category(
  key: BuffettCategory["key"],
  name: string,
  weight: number,
  score: number | null,
  bullets: string[],
): BuffettCategory {
  return {
    key,
    name,
    weight,
    score: score == null ? null : clamp(score),
    available: score != null,
    bullets,
  };
}

function peScore(pe: number | null) {
  if (pe == null) return null;
  if (pe < 0) return 25;
  if (pe < 15) return 82;
  if (pe < 25) return 72;
  if (pe < 40) return 58;
  if (pe < 70) return 42;
  return 28;
}

function mnavScore(m: number | null) {
  if (m == null) return null;
  if (m < 1) return 88;
  if (m < 1.5) return 76;
  if (m < 2.5) return 58;
  if (m < 4) return 38;
  return 22;
}

function btcYieldScore(y: number | null) {
  if (y == null) return null;
  if (y > 20) return 90;
  if (y > 5) return 78;
  if (y > 0) return 65;
  if (y > -5) return 45;
  return 25;
}

function weighted(categories: BuffettCategory[]) {
  const total = categories.reduce((a, c) => a + c.weight, 0);
  const availableWeight = categories
    .filter((c) => c.available)
    .reduce((a, c) => a + c.weight, 0);
  const score = categories.reduce(
    (a, c) => a + (c.score ?? 50) * c.weight,
    0,
  ) / (total || 1);
  return { score: clamp(score), coverage: total ? availableWeight / total : 0 };
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)}%`;
}

// Score moat from gross margin durability + operating margin scale.
function moatScore(f: EquityFundamentals): number | null {
  const gm = f.grossMargin;
  const om = f.operatingMargin;
  if (gm == null && om == null) return null;
  // Moat ≈ pricing power. Use gross margin primarily, operating margin
  // secondarily. These thresholds are deliberately generous.
  const gmScore =
    gm == null
      ? null
      : gm >= 60
      ? 88
      : gm >= 45
      ? 76
      : gm >= 30
      ? 60
      : gm >= 15
      ? 45
      : 30;
  const omScore =
    om == null
      ? null
      : om >= 25
      ? 88
      : om >= 15
      ? 74
      : om >= 8
      ? 60
      : om >= 0
      ? 45
      : 25;
  if (gmScore != null && omScore != null) return (gmScore + omScore) / 2;
  return gmScore ?? omScore ?? null;
}

function returnsScore(f: EquityFundamentals): number | null {
  const roe = f.roe;
  if (roe == null) return null;
  if (roe >= 25) return 90;
  if (roe >= 15) return 78;
  if (roe >= 10) return 65;
  if (roe >= 5) return 50;
  if (roe >= 0) return 38;
  return 20;
}

function ownerEarningsScore(f: EquityFundamentals): number | null {
  const fcfM = f.fcfMargin;
  if (fcfM == null) return null;
  if (fcfM >= 20) return 88;
  if (fcfM >= 12) return 75;
  if (fcfM >= 6) return 62;
  if (fcfM >= 0) return 45;
  return 25;
}

function balanceSheetScore(f: EquityFundamentals): number | null {
  const dte = f.debtToEquity;
  if (dte == null) return null;
  if (dte < 0) return 30; // negative equity → distressed
  if (dte <= 0.3) return 86;
  if (dte <= 0.6) return 74;
  if (dte <= 1.0) return 60;
  if (dte <= 1.5) return 45;
  return 28;
}

function capitalAllocationScore(f: EquityFundamentals): number | null {
  // Reward shrinking share count and growing revenue; penalise dilution.
  const trend = f.shareCountTrend;
  const rev = f.revenueGrowth;
  let s: number | null = null;
  if (trend === "falling") s = 80;
  else if (trend === "flat") s = 65;
  else if (trend === "rising") s = 40;
  if (rev != null) {
    const revBoost =
      rev >= 15 ? 10 : rev >= 5 ? 5 : rev >= 0 ? 0 : rev >= -10 ? -8 : -15;
    if (s == null) s = 55 + revBoost;
    else s = clamp((s + (50 + revBoost)) / 2);
  }
  return s == null ? null : clamp(s);
}

function buildEquityCategories(
  s: InstrumentSnapshot,
  f: EquityFundamentals | null,
): BuffettCategory[] {
  const valuation = peScore(s.peRatio);
  if (!f) {
    return [
      category("moat", "Moat / durability", 0.2, null, [
        "SEC fundamentals not available — unable to score margin durability.",
      ]),
      category("returns", "Return on capital", 0.2, null, [
        "SEC fundamentals not available — ROE/ROIC unscored.",
      ]),
      category("owner_earnings", "Owner earnings / FCF", 0.2, null, [
        "SEC fundamentals not available — FCF unscored.",
      ]),
      category("balance_sheet", "Balance sheet safety", 0.15, null, [
        "SEC fundamentals not available — debt/equity unscored.",
      ]),
      category("capital_allocation", "Capital allocation", 0.15, null, [
        "SEC fundamentals not available — share-count trend unscored.",
      ]),
      category("valuation", "Valuation discipline", 0.1, valuation, [
        s.peRatio == null
          ? "P/E unavailable — connect fundamentals for a better valuation score."
          : `P/E ${s.peRatio.toFixed(1)} from ${s.peSource ?? "provider"}.`,
      ]),
    ];
  }

  const moatBullets: string[] = [];
  if (f.grossMargin != null)
    moatBullets.push(`Gross margin ${fmtPct(f.grossMargin)} (TTM).`);
  if (f.operatingMargin != null)
    moatBullets.push(`Operating margin ${fmtPct(f.operatingMargin)}.`);
  if (!moatBullets.length)
    moatBullets.push("Margin data missing from SEC facts.");

  const returnsBullets: string[] = [];
  if (f.roe != null) returnsBullets.push(`ROE ${fmtPct(f.roe)} (TTM net income / latest equity).`);
  if (f.netMargin != null) returnsBullets.push(`Net margin ${fmtPct(f.netMargin)}.`);
  if (!returnsBullets.length) returnsBullets.push("Return-on-capital data missing.");

  const ownerEarningsBullets: string[] = [];
  if (f.freeCashFlow != null)
    ownerEarningsBullets.push(`Free cash flow ${fmtMoney(f.freeCashFlow.value)} (TTM).`);
  if (f.fcfMargin != null)
    ownerEarningsBullets.push(`FCF margin ${fmtPct(f.fcfMargin)}.`);
  if (f.operatingCashFlow != null)
    ownerEarningsBullets.push(`Operating cash flow ${fmtMoney(f.operatingCashFlow.value)}.`);
  if (!ownerEarningsBullets.length)
    ownerEarningsBullets.push("Cash-flow data missing from SEC facts.");

  const balanceBullets: string[] = [];
  if (f.debtToEquity != null)
    balanceBullets.push(`Debt/equity ${f.debtToEquity.toFixed(2)}.`);
  if (f.totalDebt != null)
    balanceBullets.push(`Total debt ${fmtMoney(f.totalDebt.value)}.`);
  if (f.cashAndEquivalents != null)
    balanceBullets.push(`Cash & equivalents ${fmtMoney(f.cashAndEquivalents.value)}.`);
  if (!balanceBullets.length) balanceBullets.push("Debt/equity data missing.");

  const capitalBullets: string[] = [];
  if (f.shareCountTrend != null) {
    const dir =
      f.shareCountTrend === "falling"
        ? "Buybacks: share count falling"
        : f.shareCountTrend === "rising"
        ? "Dilution: share count rising"
        : "Share count roughly flat";
    capitalBullets.push(
      f.shareCountChangePct != null
        ? `${dir} (${fmtPct(f.shareCountChangePct, 1)} over recent periods).`
        : `${dir}.`,
    );
  }
  if (f.revenueGrowth != null)
    capitalBullets.push(`Revenue growth ${fmtPct(f.revenueGrowth)} YoY (annual).`);
  if (f.epsGrowth != null)
    capitalBullets.push(`Diluted EPS growth ${fmtPct(f.epsGrowth)} YoY.`);
  if (!capitalBullets.length)
    capitalBullets.push("Share-count and growth history missing.");

  const valuationBullets: string[] = [];
  if (s.peRatio != null) valuationBullets.push(`P/E ${s.peRatio.toFixed(1)} from ${s.peSource ?? "provider"}.`);
  if (f.eps != null) valuationBullets.push(`Diluted EPS ${f.eps.value.toFixed(2)} (TTM).`);
  if (!valuationBullets.length)
    valuationBullets.push("P/E unavailable — provider did not return trailing earnings.");

  return [
    category("moat", "Moat / durability", 0.2, moatScore(f), moatBullets),
    category("returns", "Return on capital", 0.2, returnsScore(f), returnsBullets),
    category(
      "owner_earnings",
      "Owner earnings / FCF",
      0.2,
      ownerEarningsScore(f),
      ownerEarningsBullets,
    ),
    category(
      "balance_sheet",
      "Balance sheet safety",
      0.15,
      balanceSheetScore(f),
      balanceBullets,
    ),
    category(
      "capital_allocation",
      "Capital allocation",
      0.15,
      capitalAllocationScore(f),
      capitalBullets,
    ),
    category("valuation", "Valuation discipline", 0.1, valuation, valuationBullets),
  ];
}

export function computeBuffettIndex(
  s: InstrumentSnapshot,
  fundamentals?: EquityFundamentals | null,
): BuffettIndex {
  const notes = [
    "Buffett Index evaluates long-term business quality and price discipline, not short-term trade timing.",
  ];

  if (s.instrument.assetClass === "crypto") {
    return {
      asOf: s.asOf,
      framework: "not_applicable",
      applicable: false,
      overallScore: null,
      label: "Not applicable — Bitcoin has no earnings, ROIC, debt, or management team",
      dataCoverage: 0,
      categories: [],
      strengths: ["Use Signal Lab and Bitcoin-specific risk metrics instead."],
      watchouts: ["Do not apply operating-business valuation ratios to Bitcoin."],
      missingData: [],
      notes,
      fundamentals: null,
    };
  }

  const isTreasury = s.instrument.symbol === "MTPLF" || !!s.treasury;
  if (isTreasury) {
    const t = s.treasury;
    const mNav = t?.mNav ?? null;
    const y = t?.btcYieldPct ?? null;
    const cats = [
      category("treasury_nav", "BTC NAV discipline", 0.25, mnavScore(mNav), [
        mNav == null
          ? "mNAV unavailable — enter BTC holdings and shares."
          : `mNAV ${mNav.toFixed(2)}× versus BTC NAV.`,
      ]),
      category("btc_per_share", "BTC per share", 0.25, btcYieldScore(y), [
        t?.btcPerShare == null
          ? "BTC/share unavailable — enter holdings and shares."
          : `BTC/share ${t.btcPerShare.toExponential(3)}.`,
        y == null
          ? "BTC yield needs at least two historical treasury snapshots."
          : `BTC/share yield ${y.toFixed(2)}% since baseline.`,
      ]),
      category("capital_allocation", "Capital allocation", 0.2, btcYieldScore(y), [
        y == null
          ? "Needs history to judge whether share issuance is accretive."
          : y > 0
          ? "BTC/share has increased — accretive treasury execution."
          : "BTC/share has declined — dilution may be outrunning BTC accumulation.",
      ]),
      category("balance_sheet", "Balance sheet safety", 0.15, null, [
        "Debt, converts, and interest coverage are not connected yet.",
      ]),
      category("valuation", "Valuation", 0.15, mnavScore(mNav), [
        mNav == null
          ? "Needs mNAV to judge premium/discount to BTC holdings."
          : mNav < 1.5
          ? "Premium to BTC NAV is modest."
          : "Premium to BTC NAV requires caution.",
      ]),
    ];
    const w = weighted(cats);
    return {
      asOf: s.asOf,
      framework: "bitcoin_treasury",
      applicable: true,
      overallScore: w.score,
      label: label(w.score, w.coverage),
      dataCoverage: w.coverage,
      categories: cats,
      strengths: cats.filter((c) => (c.score ?? 0) >= 70).map((c) => c.name),
      watchouts: cats.filter((c) => c.score != null && c.score < 45).map((c) => c.name),
      missingData: cats.filter((c) => !c.available).map((c) => c.name),
      notes,
      // Even for treasury equities we keep SEC fundamentals (if any) so the
      // UI can show source metadata; scoring intentionally ignores them.
      fundamentals: fundamentals ?? null,
    };
  }

  const cats = buildEquityCategories(s, fundamentals ?? null);
  const w = weighted(cats);
  return {
    asOf: s.asOf,
    framework: "equity",
    applicable: true,
    overallScore: w.score,
    label: label(w.score, w.coverage),
    dataCoverage: w.coverage,
    categories: cats,
    strengths: cats.filter((c) => (c.score ?? 0) >= 70).map((c) => c.name),
    watchouts: cats.filter((c) => c.score != null && c.score < 45).map((c) => c.name),
    missingData: cats.filter((c) => !c.available).map((c) => c.name),
    notes,
    fundamentals: fundamentals ?? null,
  };
}
