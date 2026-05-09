// Number formatting helpers for finance UI.

const currencySymbols: Record<string, string> = {
  USD: "$",
  JPY: "¥",
  EUR: "€",
  GBP: "£",
  CAD: "C$",
  AUD: "A$",
  HKD: "HK$",
};

export function fmtPrice(
  value: number | null | undefined,
  currency = "USD",
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sym = currencySymbols[currency] ?? "";
  const abs = Math.abs(value);
  let frac: number;
  if (currency === "JPY") frac = abs >= 100 ? 0 : abs >= 1 ? 1 : 4;
  else if (abs >= 100) frac = 2;
  else if (abs >= 1) frac = 4;
  else frac = 6;
  const num = value.toLocaleString(undefined, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
  return `${sym}${num}`;
}

export function fmtNum(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(
  value: number | null | undefined,
  digits = 2,
  withSign = true,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = withSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function fmtCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

export function fmtCompactCurrency(
  value: number | null | undefined,
  currency = "USD",
): string {
  if (value == null) return "—";
  const sym = currencySymbols[currency] ?? "";
  return `${sym}${fmtCompact(value)}`;
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fmtAgo(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function deltaTone(value: number | null | undefined) {
  if (value == null) return "muted" as const;
  if (value > 0) return "pos" as const;
  if (value < 0) return "neg" as const;
  return "muted" as const;
}
