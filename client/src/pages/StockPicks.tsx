import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type {
  MarketCapBucket,
  StockPick,
  StockPickEtf,
  StockPickTheme,
  StockPickThemeInfo,
  StockPicksResponse,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  ArrowUpDown,
  Cpu,
  BrainCircuit,
  Zap,
  Info,
  Sun,
  Moon,
  ShieldAlert,
  AlertTriangle,
  LayoutGrid,
} from "lucide-react";
import { fmtAgo } from "@/lib/format";
import { WordMark } from "@/components/Logo";
import { MobileNav } from "@/components/MobileNav";

function useTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);
  return { dark, setDark };
}

const THEME_ICON: Record<StockPickTheme, typeof Cpu> = {
  "ai-hardware": Cpu,
  "ai-software": BrainCircuit,
  "ai-energy": Zap,
};

const BUCKET_LABEL: Record<MarketCapBucket, string> = {
  micro: "Micro",
  small: "Small",
  mid: "Mid",
  large: "Large",
  mega: "Mega",
};

const BUCKETS: MarketCapBucket[] = ["micro", "small", "mid", "large", "mega"];

type SortDir = "asc" | "desc";
type SortKey =
  | "ticker"
  | "company"
  | "bucket"
  | "price"
  | "marketCap"
  | "pe"
  | "perf1m"
  | "perf6m"
  | "perf12m"
  | "scenario"
  | "conviction"
  | "risk";

const RISK_ORDER = ["low", "moderate", "elevated", "high", "very high"];

function compareStr(a: string, b: string, dir: SortDir): number {
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

function compareNum(a: number, b: number, dir: SortDir): number {
  return dir === "asc" ? a - b : b - a;
}

function compareNullableNum(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDir,
): number {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls last
  if (bNull) return -1;
  return compareNum(a as number, b as number, dir);
}

function compareOrdered(a: string, b: string, order: string[], dir: SortDir): number {
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  return dir === "asc" ? ai - bi : bi - ai;
}

function fmtPrice(p: number | null | undefined, currency?: string | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const sym = currency === "USD" || !currency ? "$" : "";
  return `${sym}${p.toFixed(p < 10 ? 2 : p < 100 ? 2 : 2)}`;
}

function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p.toFixed(digits)}%`;
}

function fmtSignedPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(digits)}%`;
}

function pctTone(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "text-muted-foreground";
  if (p > 0) return "text-pos";
  if (p < 0) return "text-neg";
  return "text-muted-foreground";
}

function fmtRatio(p: number | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return p.toFixed(digits);
}

function SortHeader({
  label,
  k,
  active,
  dir,
  onSort,
  align = "left",
  testId,
}: {
  label: string;
  k: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  testId?: string;
}) {
  const isActive = active === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors ${
        align === "right" ? "justify-end w-full" : ""
      } ${isActive ? "text-foreground" : ""}`}
      data-testid={testId}
    >
      <span>{label}</span>
      <ArrowUpDown className={`h-3 w-3 ${isActive ? "opacity-100" : "opacity-40"}`} />
      {isActive && (
        <span className="text-[9px] tabular-nums opacity-70">
          {dir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </button>
  );
}

function ScenarioBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const tone =
    lower.includes("3x") || lower.includes("5x")
      ? "bg-warn/10 text-warn border-warn/30"
      : lower.includes("2x")
      ? "bg-primary/10 text-primary border-primary/30"
      : lower.includes("speculative")
      ? "bg-neg/10 text-neg border-neg/30"
      : lower.includes("defensive")
      ? "bg-muted/30 text-muted-foreground border-border/60"
      : "bg-pos/10 text-pos border-pos/30";
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${tone}`}
    >
      {value}
    </span>
  );
}

function RiskBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const tone =
    lower === "low"
      ? "bg-pos/10 text-pos border-pos/30"
      : lower === "moderate"
      ? "bg-primary/10 text-primary border-primary/30"
      : lower === "elevated"
      ? "bg-warn/10 text-warn border-warn/30"
      : "bg-neg/10 text-neg border-neg/30";
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${tone}`}
    >
      {value}
    </span>
  );
}

function ConvictionBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const tone =
    clamped >= 70
      ? "bg-pos"
      : clamped >= 50
      ? "bg-primary"
      : clamped >= 30
      ? "bg-warn"
      : "bg-neg";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded bg-muted/40 overflow-hidden">
        <div
          className={`h-full ${tone}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="tabular-nums text-[11px] text-muted-foreground">
        {clamped}
      </span>
    </div>
  );
}

function ThemeSelector({
  themes,
  selectedTheme,
  onSelect,
}: {
  themes: StockPickThemeInfo[];
  selectedTheme: StockPickTheme;
  onSelect: (k: StockPickTheme) => void;
}) {
  return (
    <div className="space-y-2">
      <div
        className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground px-1"
        data-testid="group-header-themes"
      >
        <BrainCircuit className="h-3 w-3" />
        <span>Themes</span>
      </div>
      <div
        className="flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0"
        data-testid="group-list-themes"
      >
        {themes.map((t) => {
          const Icon = THEME_ICON[t.key] ?? BrainCircuit;
          const active = selectedTheme === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onSelect(t.key)}
              data-active={active ? "true" : "false"}
              data-testid={`select-theme-${t.key}`}
              className={`shrink-0 md:shrink min-w-[180px] md:min-w-0 w-full text-left rounded-md border px-3 py-2 transition-colors ${
                active
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/30 text-foreground/90 hover:bg-card/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-primary/80" />
                <div className="text-[12px] font-medium truncate">{t.name}</div>
              </div>
              <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                {t.blurb}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CapBucketFilter({
  selected,
  onChange,
}: {
  selected: MarketCapBucket | "all";
  onChange: (b: MarketCapBucket | "all") => void;
}) {
  const options: Array<{ key: MarketCapBucket | "all"; label: string }> = [
    { key: "all", label: "All" },
    ...BUCKETS.map((b) => ({ key: b, label: BUCKET_LABEL[b] })),
  ];
  return (
    <div className="space-y-2">
      <div
        className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground px-1"
        data-testid="group-header-cap"
      >
        <span>Market Cap</span>
      </div>
      <div
        className="flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0"
        data-testid="group-list-cap"
      >
        {options.map((o) => {
          const active = selected === o.key;
          return (
            <button
              key={o.key}
              onClick={() => onChange(o.key)}
              data-active={active ? "true" : "false"}
              data-testid={`filter-cap-${o.key}`}
              className={`shrink-0 md:shrink min-w-[100px] md:min-w-0 w-full text-left rounded-md border px-3 py-1.5 transition-colors text-[12px] ${
                active
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/30 text-foreground/90 hover:bg-card/60"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type ViewTab = "stocks" | "etfs";

function ViewToggle({
  view,
  onChange,
  stockCount,
  etfCount,
}: {
  view: ViewTab;
  onChange: (v: ViewTab) => void;
  stockCount: number;
  etfCount: number;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-border/70 overflow-hidden text-[12px]"
      role="tablist"
      data-testid="view-toggle"
    >
      <button
        role="tab"
        aria-selected={view === "stocks"}
        data-active={view === "stocks" ? "true" : "false"}
        data-testid="view-toggle-stocks"
        onClick={() => onChange("stocks")}
        className={`px-3 py-1.5 transition-colors ${
          view === "stocks"
            ? "bg-primary/15 text-foreground"
            : "bg-background/30 text-muted-foreground hover:bg-card/60"
        }`}
      >
        Stocks{" "}
        <span className="text-[10px] text-muted-foreground tabular-nums">
          ({stockCount})
        </span>
      </button>
      <button
        role="tab"
        aria-selected={view === "etfs"}
        data-active={view === "etfs" ? "true" : "false"}
        data-testid="view-toggle-etfs"
        onClick={() => onChange("etfs")}
        className={`px-3 py-1.5 border-l border-border/70 transition-colors ${
          view === "etfs"
            ? "bg-primary/15 text-foreground"
            : "bg-background/30 text-muted-foreground hover:bg-card/60"
        }`}
      >
        <span className="inline-flex items-center gap-1">
          <LayoutGrid className="h-3 w-3" />
          ETFs / Indexes{" "}
          <span className="text-[10px] text-muted-foreground tabular-nums">
            ({etfCount})
          </span>
        </span>
      </button>
    </div>
  );
}

function PerformancePanel({ pick }: { pick: StockPick }) {
  const perf = pick.keyMetrics?.performance ?? null;
  const cells: Array<{
    key: string;
    label: string;
    change: number | null | undefined;
    priceAgo: number | null | undefined;
    date: string | null | undefined;
    testId: string;
  }> = [
    {
      key: "1m",
      label: "1 month",
      change: perf?.change1mPct,
      priceAgo: perf?.price1mAgo,
      date: perf?.price1mDate,
      testId: "detail-perf-1m",
    },
    {
      key: "6m",
      label: "6 months",
      change: perf?.change6mPct,
      priceAgo: perf?.price6mAgo,
      date: perf?.price6mDate,
      testId: "detail-perf-6m",
    },
    {
      key: "12m",
      label: "12 months",
      change: perf?.change12mPct,
      priceAgo: perf?.price12mAgo,
      date: perf?.price12mDate,
      testId: "detail-perf-12m",
    },
  ];
  const allMissing = cells.every((c) => c.change == null);
  return (
    <div
      className="rounded-md border border-border/60 bg-background/35 p-3"
      data-testid="detail-performance"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Historical performance
        </div>
        <span className="text-[10px] text-muted-foreground">
          {perf?.source && perf.source !== "unavailable"
            ? perf.source
            : "no history"}
        </span>
      </div>
      {allMissing ? (
        <div
          className="text-[11px] text-muted-foreground"
          data-testid="detail-perf-empty"
        >
          Needs provider — historical bars unavailable for this ticker.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
          {cells.map((c) => (
            <div key={c.key} data-testid={c.testId}>
              <div className="text-muted-foreground">{c.label}</div>
              <div
                className={`tabular-nums font-medium ${pctTone(c.change)}`}
                data-testid={`${c.testId}-change`}
              >
                {fmtSignedPct(c.change)}
              </div>
              <div
                className="text-[10px] text-muted-foreground tabular-nums"
                data-testid={`${c.testId}-detail`}
              >
                {c.priceAgo != null && c.date
                  ? `${fmtPrice(c.priceAgo, pick.keyMetrics?.priceCurrency)} on ${c.date}`
                  : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricsPanel({ pick }: { pick: StockPick }) {
  const m = pick.keyMetrics;
  return (
    <div
      className="rounded-md border border-border/60 bg-background/35 p-3"
      data-testid="detail-key-metrics"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Key metrics
        </div>
        {m?.metricSource && (
          <span className="text-[10px] text-muted-foreground">
            {m.metricSource === "unavailable" ? "no live data" : m.metricSource}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">Price</div>
          <div className="tabular-nums" data-testid="detail-metric-price">
            {fmtPrice(m?.price, m?.priceCurrency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Market cap</div>
          <div className="tabular-nums" data-testid="detail-metric-mcap">
            {m?.marketCapLabel ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">P/E (TTM)</div>
          <div className="tabular-nums" data-testid="detail-metric-pe">
            {fmtRatio(m?.peRatio)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Rev growth (YoY)</div>
          <div className="tabular-nums" data-testid="detail-metric-revgrowth">
            {fmtPct(m?.revenueGrowth)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Gross margin</div>
          <div className="tabular-nums" data-testid="detail-metric-gm">
            {fmtPct(m?.grossMargin)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Op margin</div>
          <div className="tabular-nums" data-testid="detail-metric-om">
            {fmtPct(m?.operatingMargin)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">FCF margin</div>
          <div className="tabular-nums" data-testid="detail-metric-fcfm">
            {fmtPct(m?.fcfMargin)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Debt / Equity</div>
          <div className="tabular-nums" data-testid="detail-metric-de">
            {fmtRatio(m?.debtToEquity)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Confidence</div>
          <div className="capitalize">{m?.metricConfidence ?? "—"}</div>
        </div>
      </div>
      {m?.metricWarnings && m.metricWarnings.length > 0 && (
        <div
          className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground border-t border-border/40 pt-2"
          data-testid="detail-metric-warnings"
        >
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-warn" />
          <ul className="space-y-0.5">
            {m.metricWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PickDetail({ pick }: { pick: StockPick }) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card/40 p-5 space-y-4"
      data-testid="selected-pick-detail"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2
              className="text-base font-semibold"
              data-testid="selected-pick-title"
            >
              {pick.companyName}
            </h2>
            <span className="mono text-xs text-muted-foreground">
              {pick.ticker}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {BUCKET_LABEL[pick.marketCapBucket]} cap · {pick.marketCapLabel}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ScenarioBadge value={pick.scenarioPotential} />
          <RiskBadge value={pick.riskLevel} />
        </div>
      </div>

      <MetricsPanel pick={pick} />

      <PerformancePanel pick={pick} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md border border-border/60 bg-background/35 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Upside case
          </div>
          <div className="text-[12px] leading-relaxed" data-testid="detail-upside">
            {pick.upsideCase}
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-background/35 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Downside guardrail
          </div>
          <div className="text-[12px] leading-relaxed" data-testid="detail-downside">
            {pick.downsideGuardrail}
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
          Thesis
        </div>
        <ul
          className="list-disc list-inside text-[12px] leading-relaxed space-y-1"
          data-testid="detail-thesis"
        >
          {pick.thesis.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
          What would need to be true
        </div>
        <ul
          className="list-disc list-inside text-[12px] leading-relaxed space-y-1"
          data-testid="detail-must-be-true"
        >
          {pick.whatMustBeTrue.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
          Risks
        </div>
        <ul
          className="list-disc list-inside text-[12px] leading-relaxed space-y-1"
          data-testid="detail-risks"
        >
          {pick.risks.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
          Removal triggers
        </div>
        <ul
          className="list-disc list-inside text-[12px] leading-relaxed space-y-1"
          data-testid="detail-removal-triggers"
        >
          {pick.removalTriggers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warn" />
        <p className="leading-relaxed" data-testid="detail-source-note">
          {pick.sourceNote} Scenario potential is hypothetical and not a
          prediction. This is research, not personalized investment advice.
        </p>
      </div>
    </section>
  );
}

function PicksTable({
  picks,
  selectedTicker,
  onSelect,
}: {
  picks: StockPick[];
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("conviction");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(
        k === "ticker" || k === "company" || k === "bucket" ? "asc" : "desc",
      );
    }
  };

  const sorted = useMemo(() => {
    const arr = [...picks];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "ticker":
          return compareStr(a.ticker, b.ticker, sortDir);
        case "company":
          return compareStr(a.companyName, b.companyName, sortDir);
        case "bucket":
          return compareOrdered(
            a.marketCapBucket,
            b.marketCapBucket,
            BUCKETS,
            sortDir,
          );
        case "price":
          return compareNullableNum(
            a.keyMetrics?.price,
            b.keyMetrics?.price,
            sortDir,
          );
        case "marketCap":
          return compareNullableNum(
            a.keyMetrics?.marketCap,
            b.keyMetrics?.marketCap,
            sortDir,
          );
        case "pe":
          return compareNullableNum(
            a.keyMetrics?.peRatio,
            b.keyMetrics?.peRatio,
            sortDir,
          );
        case "perf1m":
          return compareNullableNum(
            a.keyMetrics?.performance?.change1mPct,
            b.keyMetrics?.performance?.change1mPct,
            sortDir,
          );
        case "perf6m":
          return compareNullableNum(
            a.keyMetrics?.performance?.change6mPct,
            b.keyMetrics?.performance?.change6mPct,
            sortDir,
          );
        case "perf12m":
          return compareNullableNum(
            a.keyMetrics?.performance?.change12mPct,
            b.keyMetrics?.performance?.change12mPct,
            sortDir,
          );
        case "scenario":
          return compareStr(a.scenarioPotential, b.scenarioPotential, sortDir);
        case "conviction":
          return compareNum(a.convictionScore, b.convictionScore, sortDir);
        case "risk":
          return compareOrdered(a.riskLevel, b.riskLevel, RISK_ORDER, sortDir);
      }
    });
    return arr;
  }, [picks, sortKey, sortDir]);

  if (!picks.length) {
    return (
      <div
        className="rounded-md border border-border/70 bg-background/35 p-6 text-center text-sm text-muted-foreground"
        data-testid="picks-empty"
      >
        No picks match this theme + market-cap filter.
      </div>
    );
  }

  return (
    <div
      className="overflow-auto rounded-md border border-border/70 bg-background/35"
      data-testid="picks-table"
    >
      <table className="w-full text-[12px]">
        <thead className="border-b border-border/70 bg-card/60">
          <tr>
            <th className="px-3 py-2 text-left">
              <SortHeader
                label="Ticker"
                k="ticker"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="picks-sort-ticker"
              />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader
                label="Company"
                k="company"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="picks-sort-company"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader
                label="Price"
                k="price"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="picks-sort-price"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader
                label="Mkt Cap"
                k="marketCap"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="picks-sort-mcap"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader
                label="P/E"
                k="pe"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="picks-sort-pe"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader
                label="1m %"
                k="perf1m"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="picks-sort-perf1m"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader
                label="6m %"
                k="perf6m"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="picks-sort-perf6m"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader
                label="12m %"
                k="perf12m"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="picks-sort-perf12m"
              />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader
                label="Cap"
                k="bucket"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="picks-sort-bucket"
              />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader
                label="Scenario"
                k="scenario"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="picks-sort-scenario"
              />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader
                label="Conviction"
                k="conviction"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="picks-sort-conviction"
              />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader
                label="Risk"
                k="risk"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="picks-sort-risk"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const active = p.ticker === selectedTicker;
            return (
              <tr
                key={p.ticker}
                className={`border-b border-border/40 last:border-0 cursor-pointer transition-colors ${
                  active ? "bg-primary/10" : "hover:bg-card/40"
                }`}
                onClick={() => onSelect(p.ticker)}
                data-testid={`picks-row-${p.ticker}`}
                data-active={active ? "true" : "false"}
              >
                <td className="px-3 py-2 mono font-medium">{p.ticker}</td>
                <td className="px-3 py-2 max-w-[220px] truncate">
                  {p.companyName}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  data-testid={`picks-cell-price-${p.ticker}`}
                >
                  {fmtPrice(p.keyMetrics?.price, p.keyMetrics?.priceCurrency)}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                  data-testid={`picks-cell-mcap-${p.ticker}`}
                >
                  {p.keyMetrics?.marketCapLabel ?? "—"}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                  data-testid={`picks-cell-pe-${p.ticker}`}
                >
                  {fmtRatio(p.keyMetrics?.peRatio)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${pctTone(p.keyMetrics?.performance?.change1mPct)}`}
                  data-testid={`picks-cell-perf1m-${p.ticker}`}
                >
                  {fmtSignedPct(p.keyMetrics?.performance?.change1mPct)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${pctTone(p.keyMetrics?.performance?.change6mPct)}`}
                  data-testid={`picks-cell-perf6m-${p.ticker}`}
                >
                  {fmtSignedPct(p.keyMetrics?.performance?.change6mPct)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${pctTone(p.keyMetrics?.performance?.change12mPct)}`}
                  data-testid={`picks-cell-perf12m-${p.ticker}`}
                >
                  {fmtSignedPct(p.keyMetrics?.performance?.change12mPct)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {BUCKET_LABEL[p.marketCapBucket]}
                </td>
                <td className="px-3 py-2">
                  <ScenarioBadge value={p.scenarioPotential} />
                </td>
                <td className="px-3 py-2">
                  <ConvictionBar score={p.convictionScore} />
                </td>
                <td className="px-3 py-2">
                  <RiskBadge value={p.riskLevel} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type EtfSortKey =
  | "ticker"
  | "name"
  | "price"
  | "aum"
  | "expense"
  | "perf1m"
  | "perf6m"
  | "perf12m"
  | "risk";

function EtfSortHeader({
  label,
  k,
  active,
  dir,
  onSort,
  align = "left",
  testId,
}: {
  label: string;
  k: EtfSortKey;
  active: EtfSortKey;
  dir: SortDir;
  onSort: (k: EtfSortKey) => void;
  align?: "left" | "right";
  testId?: string;
}) {
  const isActive = active === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors ${
        align === "right" ? "justify-end w-full" : ""
      } ${isActive ? "text-foreground" : ""}`}
      data-testid={testId}
    >
      <span>{label}</span>
      <ArrowUpDown className={`h-3 w-3 ${isActive ? "opacity-100" : "opacity-40"}`} />
      {isActive && (
        <span className="text-[9px] tabular-nums opacity-70">
          {dir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </button>
  );
}

function EtfTable({
  etfs,
  selectedTicker,
  onSelect,
}: {
  etfs: StockPickEtf[];
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
}) {
  const [sortKey, setSortKey] = useState<EtfSortKey>("aum");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSort = (k: EtfSortKey) => {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "ticker" || k === "name" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...etfs];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "ticker":
          return compareStr(a.ticker, b.ticker, sortDir);
        case "name":
          return compareStr(a.name, b.name, sortDir);
        case "price":
          return compareNullableNum(
            a.keyMetrics?.price,
            b.keyMetrics?.price,
            sortDir,
          );
        case "aum":
          return compareNullableNum(
            a.keyMetrics?.aum ?? a.aum,
            b.keyMetrics?.aum ?? b.aum,
            sortDir,
          );
        case "expense":
          return compareNullableNum(a.expenseRatio, b.expenseRatio, sortDir);
        case "perf1m":
          return compareNullableNum(
            a.keyMetrics?.performance?.change1mPct,
            b.keyMetrics?.performance?.change1mPct,
            sortDir,
          );
        case "perf6m":
          return compareNullableNum(
            a.keyMetrics?.performance?.change6mPct,
            b.keyMetrics?.performance?.change6mPct,
            sortDir,
          );
        case "perf12m":
          return compareNullableNum(
            a.keyMetrics?.performance?.change12mPct,
            b.keyMetrics?.performance?.change12mPct,
            sortDir,
          );
        case "risk":
          return compareOrdered(a.riskLevel, b.riskLevel, RISK_ORDER, sortDir);
      }
    });
    return arr;
  }, [etfs, sortKey, sortDir]);

  if (!etfs.length) {
    return (
      <div
        className="rounded-md border border-border/70 bg-background/35 p-6 text-center text-sm text-muted-foreground"
        data-testid="etfs-empty"
      >
        No ETF / index alternatives curated for this theme yet.
      </div>
    );
  }
  return (
    <div
      className="overflow-auto rounded-md border border-border/70 bg-background/35"
      data-testid="etfs-table"
    >
      <table className="w-full text-[12px]">
        <thead className="border-b border-border/70 bg-card/60">
          <tr>
            <th className="px-3 py-2 text-left" data-testid="etfs-header-ticker">
              <EtfSortHeader
                label="Ticker"
                k="ticker"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="etfs-sort-ticker"
              />
            </th>
            <th className="px-3 py-2 text-left" data-testid="etfs-header-name">
              <EtfSortHeader
                label="Name"
                k="name"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="etfs-sort-name"
              />
            </th>
            <th className="px-3 py-2 text-right" data-testid="etfs-header-price">
              <EtfSortHeader
                label="Price"
                k="price"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="etfs-sort-price"
              />
            </th>
            <th className="px-3 py-2 text-right" data-testid="etfs-header-aum">
              <EtfSortHeader
                label="AUM"
                k="aum"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="etfs-sort-aum"
              />
            </th>
            <th className="px-3 py-2 text-right" data-testid="etfs-header-expense">
              <EtfSortHeader
                label="Expense"
                k="expense"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="etfs-sort-expense"
              />
            </th>
            <th className="px-3 py-2 text-right" data-testid="etfs-header-perf1m">
              <EtfSortHeader
                label="1m %"
                k="perf1m"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="etfs-sort-perf1m"
              />
            </th>
            <th className="px-3 py-2 text-right" data-testid="etfs-header-perf6m">
              <EtfSortHeader
                label="6m %"
                k="perf6m"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="etfs-sort-perf6m"
              />
            </th>
            <th className="px-3 py-2 text-right" data-testid="etfs-header-perf12m">
              <EtfSortHeader
                label="12m %"
                k="perf12m"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId="etfs-sort-perf12m"
              />
            </th>
            <th className="px-3 py-2 text-left" data-testid="etfs-header-risk">
              <EtfSortHeader
                label="Risk"
                k="risk"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="etfs-sort-risk"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const active = e.ticker === selectedTicker;
            const m = e.keyMetrics;
            const aumLabel = m?.aumLabel ?? (e.aum != null ? null : "—");
            const aumDisplay =
              m?.aumLabel ??
              (e.aum != null && Number.isFinite(e.aum)
                ? e.aum >= 1e9
                  ? `$${(e.aum / 1e9).toFixed(1)}B`
                  : `$${(e.aum / 1e6).toFixed(0)}M`
                : aumLabel);
            return (
              <tr
                key={e.ticker}
                className={`border-b border-border/40 last:border-0 cursor-pointer transition-colors ${
                  active ? "bg-primary/10" : "hover:bg-card/40"
                }`}
                onClick={() => onSelect(e.ticker)}
                data-testid={`etfs-row-${e.ticker}`}
                data-active={active ? "true" : "false"}
              >
                <td className="px-3 py-2 mono font-medium">
                  <div className="flex items-center gap-1.5">
                    <span>{e.ticker}</span>
                    {e.leveraged && (
                      <span
                        className="text-[9px] px-1 py-0.5 rounded border border-neg/40 bg-neg/10 text-neg uppercase tracking-wider"
                        data-testid={`etfs-leveraged-${e.ticker}`}
                      >
                        Lev
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 max-w-[260px] truncate">{e.name}</td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  data-testid={`etfs-cell-price-${e.ticker}`}
                >
                  {fmtPrice(m?.price, m?.priceCurrency)}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                  data-testid={`etfs-cell-aum-${e.ticker}`}
                >
                  {aumDisplay ?? "—"}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                  data-testid={`etfs-cell-expense-${e.ticker}`}
                >
                  {e.expenseRatio == null ? "—" : `${e.expenseRatio.toFixed(2)}%`}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${pctTone(m?.performance?.change1mPct)}`}
                  data-testid={`etfs-cell-perf1m-${e.ticker}`}
                >
                  {fmtSignedPct(m?.performance?.change1mPct)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${pctTone(m?.performance?.change6mPct)}`}
                  data-testid={`etfs-cell-perf6m-${e.ticker}`}
                >
                  {fmtSignedPct(m?.performance?.change6mPct)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${pctTone(m?.performance?.change12mPct)}`}
                  data-testid={`etfs-cell-perf12m-${e.ticker}`}
                >
                  {fmtSignedPct(m?.performance?.change12mPct)}
                </td>
                <td className="px-3 py-2">
                  <RiskBadge value={e.riskLevel} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EtfMetricsPanel({ etf }: { etf: StockPickEtf }) {
  const m = etf.keyMetrics;
  const aumLabel =
    m?.aumLabel ??
    (etf.aum != null && Number.isFinite(etf.aum)
      ? etf.aum >= 1e9
        ? `$${(etf.aum / 1e9).toFixed(1)}B`
        : `$${(etf.aum / 1e6).toFixed(0)}M`
      : null);
  return (
    <div
      className="rounded-md border border-border/60 bg-background/35 p-3"
      data-testid="etf-detail-key-metrics"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Key metrics
        </div>
        {m?.metricSource && (
          <span className="text-[10px] text-muted-foreground">
            {m.metricSource === "unavailable" ? "no live data" : m.metricSource}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">Price</div>
          <div className="tabular-nums" data-testid="etf-detail-metric-price">
            {fmtPrice(m?.price, m?.priceCurrency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">AUM</div>
          <div className="tabular-nums" data-testid="etf-detail-metric-aum">
            {aumLabel ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Expense ratio</div>
          <div className="tabular-nums" data-testid="etf-detail-metric-expense">
            {etf.expenseRatio == null
              ? "—"
              : `${etf.expenseRatio.toFixed(2)}%`}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Confidence</div>
          <div className="capitalize">{m?.metricConfidence ?? "—"}</div>
        </div>
      </div>
      {m?.metricWarnings && m.metricWarnings.length > 0 && (
        <div
          className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground border-t border-border/40 pt-2"
          data-testid="etf-detail-metric-warnings"
        >
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-warn" />
          <ul className="space-y-0.5">
            {m.metricWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EtfPerformancePanel({ etf }: { etf: StockPickEtf }) {
  const m = etf.keyMetrics;
  const perf = m?.performance ?? null;
  const cells: Array<{
    key: string;
    label: string;
    change: number | null | undefined;
    priceAgo: number | null | undefined;
    date: string | null | undefined;
    testId: string;
  }> = [
    {
      key: "1m",
      label: "1 month",
      change: perf?.change1mPct,
      priceAgo: perf?.price1mAgo,
      date: perf?.price1mDate,
      testId: "etf-detail-perf-1m",
    },
    {
      key: "6m",
      label: "6 months",
      change: perf?.change6mPct,
      priceAgo: perf?.price6mAgo,
      date: perf?.price6mDate,
      testId: "etf-detail-perf-6m",
    },
    {
      key: "12m",
      label: "12 months",
      change: perf?.change12mPct,
      priceAgo: perf?.price12mAgo,
      date: perf?.price12mDate,
      testId: "etf-detail-perf-12m",
    },
  ];
  const allMissing = cells.every((c) => c.change == null);
  return (
    <div
      className="rounded-md border border-border/60 bg-background/35 p-3"
      data-testid="etf-detail-performance"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Historical performance
        </div>
        <span className="text-[10px] text-muted-foreground">
          {perf?.source && perf.source !== "unavailable"
            ? perf.source
            : "no history"}
        </span>
      </div>
      {allMissing ? (
        <div
          className="text-[11px] text-muted-foreground"
          data-testid="etf-detail-perf-empty"
        >
          Needs provider — historical bars unavailable for this ETF.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
          {cells.map((c) => (
            <div key={c.key} data-testid={c.testId}>
              <div className="text-muted-foreground">{c.label}</div>
              <div
                className={`tabular-nums font-medium ${pctTone(c.change)}`}
                data-testid={`${c.testId}-change`}
              >
                {fmtSignedPct(c.change)}
              </div>
              <div
                className="text-[10px] text-muted-foreground tabular-nums"
                data-testid={`${c.testId}-detail`}
              >
                {c.priceAgo != null && c.date
                  ? `${fmtPrice(c.priceAgo, m?.priceCurrency)} on ${c.date}`
                  : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EtfDetail({ etf }: { etf: StockPickEtf }) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card/40 p-5 space-y-4"
      data-testid="selected-etf-detail"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold" data-testid="selected-etf-title">
              {etf.name}
            </h2>
            <span className="mono text-xs text-muted-foreground">
              {etf.ticker}
            </span>
            {etf.leveraged && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded border border-neg/40 bg-neg/10 text-neg uppercase tracking-wider"
                data-testid="etf-leveraged-badge"
              >
                Leveraged
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {etf.exposureType}
            {etf.expenseRatio != null
              ? ` · ${etf.expenseRatio.toFixed(2)}% expense ratio`
              : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RiskBadge value={etf.riskLevel} />
        </div>
      </div>

      <EtfMetricsPanel etf={etf} />

      <EtfPerformancePanel etf={etf} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md border border-border/60 bg-background/35 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Why use it
          </div>
          <div className="text-[12px] leading-relaxed" data-testid="etf-why">
            {etf.whyUseIt}
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-background/35 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Tradeoffs
          </div>
          <div className="text-[12px] leading-relaxed" data-testid="etf-tradeoffs">
            {etf.tradeoffs}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {etf.concentrationNote && (
          <div className="rounded-md border border-border/60 bg-background/35 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Concentration
            </div>
            <div
              className="text-[12px] leading-relaxed"
              data-testid="etf-concentration"
            >
              {etf.concentrationNote}
            </div>
          </div>
        )}
        {etf.topHoldingsNote && (
          <div className="rounded-md border border-border/60 bg-background/35 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Top holdings (approximate)
            </div>
            <div
              className="text-[12px] leading-relaxed"
              data-testid="etf-top-holdings"
            >
              {etf.topHoldingsNote}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warn" />
        <p className="leading-relaxed" data-testid="etf-source-note">
          {etf.sourceNote} Diversified exposure alternative — not a
          recommendation. Verify expense ratios, holdings, and prospectus on the
          issuer's site before acting.
        </p>
      </div>
    </section>
  );
}

export default function StockPicksPage() {
  const { dark, setDark } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<StockPickTheme>(
    "ai-hardware",
  );
  const [capBucket, setCapBucket] = useState<MarketCapBucket | "all">("all");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedEtfTicker, setSelectedEtfTicker] = useState<string | null>(
    null,
  );
  const [view, setView] = useState<ViewTab>("stocks");

  const query = useQuery<StockPicksResponse>({
    queryKey: ["/api/stock-picks"],
  });

  const themes = query.data?.themes ?? [];
  const allPicks = query.data?.picks ?? [];
  const allEtfs = query.data?.etfs ?? [];

  const filtered = useMemo(() => {
    return allPicks.filter((p) => {
      if (!p.themes.includes(selectedTheme)) return false;
      if (capBucket !== "all" && p.marketCapBucket !== capBucket) return false;
      return true;
    });
  }, [allPicks, selectedTheme, capBucket]);

  const filteredEtfs = useMemo(() => {
    return allEtfs.filter((e) => e.themes.includes(selectedTheme));
  }, [allEtfs, selectedTheme]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedTicker(null);
      return;
    }
    if (!selectedTicker || !filtered.find((p) => p.ticker === selectedTicker)) {
      setSelectedTicker(filtered[0].ticker);
    }
  }, [filtered, selectedTicker]);

  useEffect(() => {
    if (!filteredEtfs.length) {
      setSelectedEtfTicker(null);
      return;
    }
    if (
      !selectedEtfTicker ||
      !filteredEtfs.find((e) => e.ticker === selectedEtfTicker)
    ) {
      setSelectedEtfTicker(filteredEtfs[0].ticker);
    }
  }, [filteredEtfs, selectedEtfTicker]);

  const selectedPick = useMemo(() => {
    if (!selectedTicker) return null;
    return allPicks.find((p) => p.ticker === selectedTicker) ?? null;
  }, [allPicks, selectedTicker]);

  const selectedEtf = useMemo(() => {
    if (!selectedEtfTicker) return null;
    return allEtfs.find((e) => e.ticker === selectedEtfTicker) ?? null;
  }, [allEtfs, selectedEtfTicker]);

  const lastUpdated = query.data?.lastUpdated ?? null;
  const isLoading = query.isLoading;
  const isError = query.isError;

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-background text-foreground"
      data-testid="page-stock-picks"
    >
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-back-dashboard"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <span className="text-muted-foreground">·</span>
          <WordMark />
          <span className="text-muted-foreground hidden md:inline">·</span>
          <h1
            className="hidden md:inline text-base font-semibold"
            data-testid="text-page-title"
          >
            Stock Picks &amp; Themes
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span
              className="hidden lg:inline text-[11px] text-muted-foreground"
              data-testid="text-last-updated"
            >
              Updated {fmtAgo(lastUpdated)}
            </span>
          )}
          <Link
            href="/superinvestors"
            className="hidden sm:inline-flex items-center gap-1 h-8 px-2 rounded text-[12px] text-muted-foreground hover:text-foreground"
            data-testid="link-superinvestors"
          >
            SuperInvestors
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDark(!dark)}
            aria-label="Toggle theme"
            data-testid="button-theme"
          >
            {dark ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto"
        style={{ overscrollBehavior: "contain" }}
      >
        <div className="px-4 md:px-6 py-5 space-y-5 max-w-[1600px] mx-auto pb-20 md:pb-5">
          <div className="md:hidden">
            <h1 className="text-lg font-semibold">Stock Picks &amp; Themes</h1>
          </div>

          <div
            className="flex items-start gap-2 rounded-md border border-border/70 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground"
            data-testid="page-disclaimer"
          >
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/80" />
            <p className="leading-relaxed">
              <span className="text-foreground">
                Research watchlist, not personalized investment advice.
              </span>{" "}
              These are curated theme-based scenario models. Scenario potentials
              (e.g. "2x" or "3x") are hypothetical, not predictions. ETFs are
              listed as diversified exposure alternatives, not recommendations.
              Investments can lose value. Consult a qualified financial
              professional before acting on anything you see here.
            </p>
          </div>

          {isError && (
            <div
              className="rounded-md border border-neg/30 bg-neg/5 px-3 py-3 text-sm text-neg"
              data-testid="error-banner"
            >
              Failed to load stock picks:{" "}
              {(query.error as Error)?.message ?? "unknown"}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-4">
            <aside
              className="md:sticky md:top-[72px] md:self-start space-y-4"
              data-testid="picks-selector"
            >
              {isLoading && !themes.length ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 rounded-md" />
                  ))}
                </div>
              ) : (
                <ThemeSelector
                  themes={themes}
                  selectedTheme={selectedTheme}
                  onSelect={setSelectedTheme}
                />
              )}
              {view === "stocks" && (
                <CapBucketFilter selected={capBucket} onChange={setCapBucket} />
              )}
            </aside>

            <div className="min-w-0 space-y-4" data-testid="picks-pane">
              {isLoading && !allPicks.length && (
                <Skeleton className="h-64 rounded-lg" />
              )}

              {!isLoading && themes.length > 0 && (
                <section
                  className="rounded-lg border border-border/70 bg-card/40 p-4"
                  data-testid="theme-summary"
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {(() => {
                      const Icon = THEME_ICON[selectedTheme] ?? BrainCircuit;
                      return (
                        <Icon className="h-3.5 w-3.5 text-primary/80" />
                      );
                    })()}
                    <h2 className="text-base font-semibold">
                      {themes.find((t) => t.key === selectedTheme)?.name}
                    </h2>
                    <span className="text-[11px] text-muted-foreground">
                      · {filtered.length} stock{filtered.length === 1 ? "" : "s"}
                      {capBucket !== "all" && view === "stocks"
                        ? ` · ${BUCKET_LABEL[capBucket]} cap`
                        : ""}{" "}
                      · {filteredEtfs.length} ETF
                      {filteredEtfs.length === 1 ? "" : "s"}
                    </span>
                    <div className="ml-auto">
                      <ViewToggle
                        view={view}
                        onChange={setView}
                        stockCount={filtered.length}
                        etfCount={filteredEtfs.length}
                      />
                    </div>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    {themes.find((t) => t.key === selectedTheme)?.blurb}
                  </p>
                </section>
              )}

              {view === "stocks" ? (
                <>
                  <PicksTable
                    picks={filtered}
                    selectedTicker={selectedTicker}
                    onSelect={setSelectedTicker}
                  />
                  {selectedPick && <PickDetail pick={selectedPick} />}
                </>
              ) : (
                <section data-testid="etf-exposure-section" className="space-y-4">
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
                    <LayoutGrid className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/80" />
                    <p className="leading-relaxed">
                      <span className="text-foreground">
                        Diversified exposure alternatives.
                      </span>{" "}
                      For users who want theme exposure without picking
                      individual stocks. Expense ratios and holdings are
                      curated/approximate — verify on the issuer's site.
                    </p>
                  </div>
                  <EtfTable
                    etfs={filteredEtfs}
                    selectedTicker={selectedEtfTicker}
                    onSelect={setSelectedEtfTicker}
                  />
                  {selectedEtf && <EtfDetail etf={selectedEtf} />}
                </section>
              )}
            </div>
          </div>

          {query.data?.disclaimer && (
            <footer
              className="text-[10px] text-muted-foreground py-3 leading-relaxed"
              data-testid="page-footer-disclaimer"
            >
              {query.data.disclaimer} {query.data.notes}
            </footer>
          )}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
