import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type {
  MarketCapBucket,
  StockPick,
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
} from "lucide-react";
import { fmtAgo } from "@/lib/format";
import { WordMark } from "@/components/Logo";

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
  | "scenario"
  | "conviction"
  | "risk"
  | "confidence";

const RISK_ORDER = ["low", "moderate", "elevated", "high", "very high"];
const CONFIDENCE_ORDER = ["curated", "approximate", "low"];

function compareStr(a: string, b: string, dir: SortDir): number {
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

function compareNum(a: number, b: number, dir: SortDir): number {
  return dir === "asc" ? a - b : b - a;
}

function compareOrdered(a: string, b: string, order: string[], dir: SortDir): number {
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  return dir === "asc" ? ai - bi : bi - ai;
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
        case "scenario":
          return compareStr(a.scenarioPotential, b.scenarioPotential, sortDir);
        case "conviction":
          return compareNum(a.convictionScore, b.convictionScore, sortDir);
        case "risk":
          return compareOrdered(a.riskLevel, b.riskLevel, RISK_ORDER, sortDir);
        case "confidence":
          return compareOrdered(
            a.dataConfidence,
            b.dataConfidence,
            CONFIDENCE_ORDER,
            sortDir,
          );
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
            <th className="px-3 py-2 text-left">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Downside guardrail
              </span>
            </th>
            <th className="px-3 py-2 text-left">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Upside case
              </span>
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader
                label="Data"
                k="confidence"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId="picks-sort-confidence"
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
                <td className="px-3 py-2 max-w-[260px]">
                  <div className="text-[11px] text-muted-foreground line-clamp-2">
                    {p.downsideGuardrail}
                  </div>
                </td>
                <td className="px-3 py-2 max-w-[260px]">
                  <div className="text-[11px] text-muted-foreground line-clamp-2">
                    {p.upsideCase}
                  </div>
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground capitalize">
                  {p.dataConfidence}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function StockPicksPage() {
  const { dark, setDark } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<StockPickTheme>(
    "ai-hardware",
  );
  const [capBucket, setCapBucket] = useState<MarketCapBucket | "all">("all");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const query = useQuery<StockPicksResponse>({
    queryKey: ["/api/stock-picks"],
  });

  const themes = query.data?.themes ?? [];
  const allPicks = query.data?.picks ?? [];

  const filtered = useMemo(() => {
    return allPicks.filter((p) => {
      if (!p.themes.includes(selectedTheme)) return false;
      if (capBucket !== "all" && p.marketCapBucket !== capBucket) return false;
      return true;
    });
  }, [allPicks, selectedTheme, capBucket]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedTicker(null);
      return;
    }
    if (!selectedTicker || !filtered.find((p) => p.ticker === selectedTicker)) {
      setSelectedTicker(filtered[0].ticker);
    }
  }, [filtered, selectedTicker]);

  const selectedPick = useMemo(() => {
    if (!selectedTicker) return null;
    return allPicks.find((p) => p.ticker === selectedTicker) ?? null;
  }, [allPicks, selectedTicker]);

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
        <div className="px-4 md:px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
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
              (e.g. "2x" or "3x") are hypothetical, not predictions. Investments
              can lose value. Consult a qualified financial professional before
              acting on anything you see here.
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
              <CapBucketFilter selected={capBucket} onChange={setCapBucket} />
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
                  <div className="flex items-center gap-2 mb-1">
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
                      · {filtered.length} pick{filtered.length === 1 ? "" : "s"}
                      {capBucket !== "all" && ` · ${BUCKET_LABEL[capBucket]} cap`}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    {themes.find((t) => t.key === selectedTheme)?.blurb}
                  </p>
                </section>
              )}

              <PicksTable
                picks={filtered}
                selectedTicker={selectedTicker}
                onSelect={setSelectedTicker}
              />

              {selectedPick && <PickDetail pick={selectedPick} />}
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
    </div>
  );
}
