import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Moon,
  Sun,
  Briefcase,
  ShieldAlert,
  Loader2,
  AlertTriangle,
  Info,
  PlusCircle,
  CheckCircle2,
} from "lucide-react";
import { WordMark } from "@/components/Logo";
import { PrimaryNav } from "@/components/PrimaryNav";
import { MobileNav } from "@/components/MobileNav";
import { AllWeatherBody } from "./AllWeather";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTheme } from "@/lib/theme";
import type {
  PortfolioLabRequest,
  PortfolioLabResponse,
  PortfolioSourceKind,
  PortfolioStyleId,
  PortfolioConstraints,
  PortfolioHolding,
  RiskLevel,
} from "@shared/schema";

const SOURCE_LABELS: Record<PortfolioSourceKind, string> = {
  universe: "Whole universe",
  themes: "By theme",
  sections: "By watchlist group",
  manual: "Manual tickers",
};

const RISK_TONE: Record<RiskLevel | "unknown", string> = {
  low: "text-emerald-600 dark:text-emerald-400",
  moderate: "text-sky-600 dark:text-sky-400",
  elevated: "text-amber-600 dark:text-amber-400",
  high: "text-orange-600 dark:text-orange-400",
  "very high": "text-red-600 dark:text-red-400",
  unknown: "text-muted-foreground",
};

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function toneSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "text-muted-foreground";
  if (n > 0) return "text-emerald-600 dark:text-emerald-400";
  if (n < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

// Default constraints mirror the server defaults so the controls start in a
// sensible place before the first build.
const DEFAULT_CONSTRAINTS: PortfolioConstraints = {
  maxHoldings: 12,
  maxPositionPct: 20,
  maxThemePct: 45,
  maxHighRiskPct: 35,
  minModelScore: 40,
  cashBufferPct: 5,
};

const STYLE_ORDER: PortfolioStyleId[] = [
  "equal-weight",
  "model-score-weighted",
  "risk-weighted",
  "core-satellite",
  "high-upside",
  "risk-controlled",
];

export default function PortfolioLab() {
  const { dark, setDark } = useTheme();
  const { toast } = useToast();

  const [mode, setMode] = useState<"builder" | "all-weather">("builder");
  const [styleId, setStyleId] = useState<PortfolioStyleId>("model-score-weighted");
  const [sourceKind, setSourceKind] = useState<PortfolioSourceKind>("universe");
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [manualText, setManualText] = useState("");
  const [constraints, setConstraints] =
    useState<PortfolioConstraints>(DEFAULT_CONSTRAINTS);
  const [result, setResult] = useState<PortfolioLabResponse | null>(null);

  const build = useMutation<PortfolioLabResponse, Error, void>({
    mutationFn: async () => {
      const tickers = manualText
        .split(/[\s,]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
      const body: PortfolioLabRequest = {
        styleId,
        source: {
          kind: sourceKind,
          themes: selectedThemes,
          sections: selectedSections,
          tickers,
        },
        constraints,
      };
      const res = await apiRequest("POST", "/api/portfolio-lab", body);
      return (await res.json()) as PortfolioLabResponse;
    },
    onSuccess: (data) => setResult(data),
    onError: (e) =>
      toast({
        title: "Couldn't build portfolio",
        description: e.message,
        variant: "destructive",
      }),
  });

  const styles = result?.styles ?? [];
  const availableThemes = result?.availableThemes ?? [];
  const availableSections = result?.availableSections ?? [];
  const portfolio = result?.portfolio ?? null;

  const addToWatchlist = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!portfolio || portfolio.holdings.length === 0) return;
      for (const h of portfolio.holdings) {
        await apiRequest("POST", "/api/conviction-ideas", {
          ticker: h.ticker,
          theme: portfolio.name,
        });
      }
    },
    onSuccess: () =>
      toast({
        title: `Added ${portfolio?.holdings.length ?? 0} names to “${portfolio?.name}”`,
        description: "Open the Dashboard watchlist to review the new group.",
      }),
    onError: (e) =>
      toast({
        title: "Couldn't add to watchlist",
        description: e.message,
        variant: "destructive",
      }),
  });

  const toggle = (
    list: string[],
    setList: (v: string[]) => void,
    key: string,
  ) => {
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  };

  const styleInfos = useMemo(() => {
    if (styles.length) return styles;
    // Before the first build we don't have the descriptions, so render the
    // ids as labels; descriptions fill in after the first response.
    return STYLE_ORDER.map((id) => ({ id, name: id, blurb: "" }));
  }, [styles]);

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-background text-foreground pb-16 md:pb-0"
      data-testid="portfolio-lab-page"
    >
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <WordMark />
          <span className="hidden md:inline text-[11px] text-muted-foreground border-l border-border pl-3">
            Portfolio Lab — model / paper portfolio construction
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PrimaryNav className="mr-1" />
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

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-6 py-5 space-y-5">
        <div className="space-y-2.5">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Briefcase className="h-5 w-5 text-primary" aria-hidden />
            Portfolio Lab
          </h1>
          <div
            className="inline-flex rounded-md border border-border/70 overflow-hidden text-[12px]"
            role="tablist"
            data-testid="portfolio-lab-modes"
          >
            <button
              role="tab"
              aria-selected={mode === "builder"}
              data-testid="mode-builder"
              onClick={() => setMode("builder")}
              className={`px-4 py-1.5 transition-colors ${
                mode === "builder"
                  ? "bg-primary/15 text-foreground"
                  : "bg-background/30 text-muted-foreground hover:bg-card/60"
              }`}
            >
              Builder
            </button>
            <button
              role="tab"
              aria-selected={mode === "all-weather"}
              data-testid="mode-all-weather"
              onClick={() => setMode("all-weather")}
              className={`px-4 py-1.5 transition-colors border-l border-border/70 ${
                mode === "all-weather"
                  ? "bg-primary/15 text-foreground"
                  : "bg-background/30 text-muted-foreground hover:bg-card/60"
              }`}
            >
              All-Weather
            </button>
          </div>
          {mode === "builder" && (
            <>
              <p className="text-[12px] text-muted-foreground leading-relaxed max-w-3xl">
                Construct an explainable{" "}
                <span className="font-medium text-foreground/90">
                  model / paper portfolio
                </span>{" "}
                from the model-scored universe. Pick a source and a weighting style,
                set your rules, and the engine sizes positions deterministically with
                the reasoning shown for every name.
              </p>
              <div
                className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 max-w-3xl"
                data-testid="portfolio-lab-disclaimer"
              >
                <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                <span>
                  Research / paper portfolio only — no brokerage, no orders, no
                  trading actions. Weights are hypothetical and assembled from model
                  scores, scenario models and trailing performance. Not personalized
                  financial advice.
                </span>
              </div>
            </>
          )}
        </div>

        {mode === "all-weather" && <AllWeatherBody />}

        {mode === "builder" && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
          {/* Controls */}
          <aside className="space-y-4" data-testid="portfolio-controls">
            {/* Source */}
            <section className="rounded-lg border border-border/70 bg-card/40 p-3 space-y-2">
              <h2 className="text-[12px] font-semibold">Source</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(SOURCE_LABELS) as PortfolioSourceKind[]).map(
                  (k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSourceKind(k)}
                      data-testid={`source-${k}`}
                      className={`rounded-md border px-2 py-1.5 text-[11px] text-left transition-colors ${
                        sourceKind === k
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border/70 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {SOURCE_LABELS[k]}
                    </button>
                  ),
                )}
              </div>

              {sourceKind === "themes" && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] text-muted-foreground">
                    Pick one or more themes
                    {availableThemes.length === 0 &&
                      " (build once to load the list)"}
                  </p>
                  <div className="max-h-44 overflow-y-auto flex flex-wrap gap-1">
                    {availableThemes.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() =>
                          toggle(selectedThemes, setSelectedThemes, t.key)
                        }
                        className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                          selectedThemes.includes(t.key)
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/70 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t.key} ({t.count})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sourceKind === "sections" && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] text-muted-foreground">
                    Pick one or more watchlist groups
                    {availableSections.length === 0 &&
                      " (build once to load the list)"}
                  </p>
                  <div className="max-h-44 overflow-y-auto flex flex-wrap gap-1">
                    {availableSections.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() =>
                          toggle(selectedSections, setSelectedSections, s.key)
                        }
                        className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                          selectedSections.includes(s.key)
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/70 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s.label} ({s.count})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sourceKind === "manual" && (
                <div className="space-y-1 pt-1">
                  <p className="text-[10px] text-muted-foreground">
                    Tickers (space or comma separated). Names not in the universe
                    are skipped with a warning.
                  </p>
                  <textarea
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    data-testid="manual-tickers"
                    rows={3}
                    placeholder="NVDA, AMD, AVGO"
                    className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-[12px] resize-y"
                  />
                </div>
              )}
            </section>

            {/* Style */}
            <section className="rounded-lg border border-border/70 bg-card/40 p-3 space-y-2">
              <h2 className="text-[12px] font-semibold">Weighting style</h2>
              <div className="space-y-1.5">
                {styleInfos.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyleId(s.id)}
                    data-testid={`style-${s.id}`}
                    className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                      styleId === s.id
                        ? "border-primary bg-primary/10"
                        : "border-border/70 hover:border-border"
                    }`}
                  >
                    <div className="text-[12px] font-medium">{s.name}</div>
                    {s.blurb && (
                      <div className="text-[10px] text-muted-foreground leading-snug">
                        {s.blurb}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </section>

            {/* Constraints */}
            <section className="rounded-lg border border-border/70 bg-card/40 p-3 space-y-3">
              <h2 className="text-[12px] font-semibold">Rules &amp; constraints</h2>
              <ConstraintSlider
                label="Max holdings"
                value={constraints.maxHoldings}
                min={3}
                max={25}
                step={1}
                fmt={(v) => `${v}`}
                onChange={(v) =>
                  setConstraints((c) => ({ ...c, maxHoldings: v }))
                }
              />
              <ConstraintSlider
                label="Max position size"
                value={constraints.maxPositionPct}
                min={5}
                max={50}
                step={1}
                fmt={(v) => `${v}%`}
                onChange={(v) =>
                  setConstraints((c) => ({ ...c, maxPositionPct: v }))
                }
              />
              <ConstraintSlider
                label="Max theme exposure"
                value={constraints.maxThemePct}
                min={15}
                max={100}
                step={5}
                fmt={(v) => `${v}%`}
                onChange={(v) =>
                  setConstraints((c) => ({ ...c, maxThemePct: v }))
                }
              />
              <ConstraintSlider
                label="Max high-risk exposure"
                value={constraints.maxHighRiskPct}
                min={0}
                max={100}
                step={5}
                fmt={(v) => `${v}%`}
                onChange={(v) =>
                  setConstraints((c) => ({ ...c, maxHighRiskPct: v }))
                }
              />
              <ConstraintSlider
                label="Min model score"
                value={constraints.minModelScore}
                min={0}
                max={90}
                step={5}
                fmt={(v) => `${v}`}
                onChange={(v) =>
                  setConstraints((c) => ({ ...c, minModelScore: v }))
                }
              />
              <ConstraintSlider
                label="Cash buffer"
                value={constraints.cashBufferPct}
                min={0}
                max={40}
                step={1}
                fmt={(v) => `${v}%`}
                onChange={(v) =>
                  setConstraints((c) => ({ ...c, cashBufferPct: v }))
                }
              />
            </section>

            <Button
              className="w-full"
              onClick={() => build.mutate()}
              disabled={build.isPending}
              data-testid="button-build"
            >
              {build.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Briefcase className="h-4 w-4 mr-1.5" />
              )}
              Build portfolio
            </Button>
          </aside>

          {/* Output */}
          <div className="min-w-0 space-y-4" data-testid="portfolio-output">
            {!result && !build.isPending && (
              <div className="rounded-lg border border-dashed border-border/70 bg-card/30 p-8 text-center text-[12px] text-muted-foreground">
                Choose a source and style, then{" "}
                <span className="text-foreground font-medium">
                  Build portfolio
                </span>{" "}
                to see the holdings, weights and exposure.
              </div>
            )}

            {build.isPending && (
              <div className="space-y-3">
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-64 rounded-lg" />
              </div>
            )}

            {portfolio && !build.isPending && (
              <>
                {portfolio.empty ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-6 text-[12px] text-amber-700 dark:text-amber-300">
                    <div className="flex items-center gap-2 font-medium mb-1">
                      <AlertTriangle className="h-4 w-4" />
                      No portfolio could be built
                    </div>
                    {portfolio.emptyNote}
                  </div>
                ) : (
                  <>
                    {/* Summary */}
                    <section className="rounded-lg border border-border/70 bg-card/40 p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <h2 className="text-base font-semibold">
                            {portfolio.name}
                          </h2>
                          <p className="text-[11px] text-muted-foreground">
                            {portfolio.styleName} ·{" "}
                            {portfolio.holdings.length} holding
                            {portfolio.holdings.length === 1 ? "" : "s"} ·{" "}
                            {pct(portfolio.cashPct, 0)} cash
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => addToWatchlist.mutate()}
                          disabled={addToWatchlist.isPending}
                          data-testid="button-add-watchlist"
                        >
                          {addToWatchlist.isSuccess ? (
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />
                          ) : (
                            <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          {addToWatchlist.isSuccess
                            ? "Added"
                            : "Add to watchlist"}
                        </Button>
                      </div>
                      <p className="text-[12px] text-muted-foreground leading-relaxed">
                        {portfolio.thesis}
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                        <Stat
                          label="Avg model score"
                          value={
                            portfolio.avgModelScore != null
                              ? portfolio.avgModelScore.toFixed(0)
                              : "—"
                          }
                        />
                        <Stat
                          label="Wtd upside"
                          value={pct(portfolio.weightedUpsidePct, 0)}
                          tone="text-emerald-600 dark:text-emerald-400"
                        />
                        <Stat
                          label="Wtd downside"
                          value={pct(portfolio.weightedDownsidePct, 0)}
                          tone="text-red-600 dark:text-red-400"
                        />
                        <Stat label="Cash" value={pct(portfolio.cashPct, 0)} />
                      </div>
                    </section>

                    {/* Warnings */}
                    {portfolio.warnings.length > 0 && (
                      <section className="space-y-1.5">
                        {portfolio.warnings.map((w, i) => (
                          <div
                            key={i}
                            className={`flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] ${
                              w.level === "warn"
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "border-border/70 bg-card/40 text-muted-foreground"
                            }`}
                            data-testid={`warning-${i}`}
                          >
                            {w.level === "warn" ? (
                              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            ) : (
                              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            )}
                            <span>{w.message}</span>
                          </div>
                        ))}
                      </section>
                    )}

                    {/* Holdings */}
                    <HoldingsTable holdings={portfolio.holdings} />

                    {/* Exposure */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <section className="rounded-lg border border-border/70 bg-card/40 p-3">
                        <h3 className="text-[12px] font-semibold mb-2">
                          Theme exposure
                        </h3>
                        <div className="space-y-1.5">
                          {portfolio.themeExposure.slice(0, 8).map((t) => (
                            <ExposureBar
                              key={t.theme}
                              label={`${t.theme} (${t.holdings})`}
                              weightPct={t.weightPct}
                            />
                          ))}
                          {portfolio.themeExposure.length === 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              No theme tags on these names.
                            </p>
                          )}
                        </div>
                      </section>
                      <section className="rounded-lg border border-border/70 bg-card/40 p-3">
                        <h3 className="text-[12px] font-semibold mb-2">
                          Risk exposure
                        </h3>
                        <div className="space-y-1.5">
                          {portfolio.riskExposure.map((r) => (
                            <ExposureBar
                              key={r.riskLevel}
                              label={`${r.riskLevel} (${r.holdings})`}
                              weightPct={r.weightPct}
                              labelClass={RISK_TONE[r.riskLevel]}
                            />
                          ))}
                        </div>
                      </section>
                    </div>

                    {/* How it was built */}
                    {portfolio.howItWasBuilt.length > 0 && (
                      <section className="rounded-lg border border-border/70 bg-card/40 p-3">
                        <h3 className="text-[12px] font-semibold mb-2">
                          How it was built
                        </h3>
                        <ul className="list-disc pl-4 space-y-1 text-[11px] text-muted-foreground">
                          {portfolio.howItWasBuilt.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </>
                )}

                {result?.disclaimer && (
                  <footer className="text-[10px] text-muted-foreground py-2 leading-relaxed">
                    {result.disclaimer}
                  </footer>
                )}
              </>
            )}
          </div>
        </div>
        )}
      </main>

      <MobileNav />
    </div>
  );
}

function ConstraintSlider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[11px] font-medium tabular-nums">
          {fmt(value)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function ExposureBar({
  label,
  weightPct,
  labelClass,
}: {
  label: string;
  weightPct: number;
  labelClass?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className={labelClass ?? "text-muted-foreground"}>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {pct(weightPct, 0)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary/70 rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, weightPct))}%` }}
        />
      </div>
    </div>
  );
}

function HoldingsTable({ holdings }: { holdings: PortfolioHolding[] }) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card/40 overflow-hidden"
      data-testid="holdings-table"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Ticker</th>
              <th className="text-right px-3 py-2 font-medium">Weight</th>
              <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">
                Score
              </th>
              <th className="text-left px-3 py-2 font-medium hidden md:table-cell">
                Risk
              </th>
              <th className="text-right px-3 py-2 font-medium hidden lg:table-cell">
                6m
              </th>
              <th className="text-left px-3 py-2 font-medium hidden xl:table-cell">
                Note
              </th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr
                key={h.ticker}
                className="border-t border-border/50"
                data-testid={`holding-${h.ticker}`}
              >
                <td className="px-3 py-2">
                  <div className="font-semibold">{h.ticker}</div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">
                    {h.companyName}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {pct(h.weightPct)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                  {h.modelScore.toFixed(0)}
                </td>
                <td
                  className={`px-3 py-2 hidden md:table-cell ${
                    h.riskLevel ? RISK_TONE[h.riskLevel] : "text-muted-foreground"
                  }`}
                >
                  {h.riskLevel ?? "—"}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums hidden lg:table-cell ${toneSigned(
                    h.change6mPct,
                  )}`}
                >
                  {pct(h.change6mPct, 0)}
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground hidden xl:table-cell max-w-[260px]">
                  {h.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
