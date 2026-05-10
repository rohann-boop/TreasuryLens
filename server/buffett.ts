import type {
  BuffettCategory,
  BuffettIndex,
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

export function computeBuffettIndex(s: InstrumentSnapshot): BuffettIndex {
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
    };
  }

  const valuation = peScore(s.peRatio);
  const cats = [
    category("moat", "Moat / durability", 0.2, null, [
      "Qualitative input needed: brand, network effects, switching costs, cost advantage.",
    ]),
    category("returns", "Return on capital", 0.2, null, [
      "Needs ROIC/ROE and margin history from a fundamentals provider.",
    ]),
    category("owner_earnings", "Owner earnings / FCF", 0.2, null, [
      "Needs free cash flow, maintenance capex, and FCF conversion.",
    ]),
    category("balance_sheet", "Balance sheet safety", 0.15, null, [
      "Needs debt/EBITDA, interest coverage, and net cash/debt.",
    ]),
    category("capital_allocation", "Capital allocation", 0.15, null, [
      "Needs share count change, buybacks, reinvestment returns, and acquisition history.",
    ]),
    category("valuation", "Valuation discipline", 0.1, valuation, [
      s.peRatio == null
        ? "P/E unavailable — connect fundamentals for a better valuation score."
        : `P/E ${s.peRatio.toFixed(1)} from ${s.peSource ?? "provider"}.`,
    ]),
  ];
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
  };
}
