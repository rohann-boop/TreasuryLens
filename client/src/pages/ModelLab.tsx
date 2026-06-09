import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import type {
  ModelLabBacktestResponse,
  ModelStrategyPreset,
  ModelWeights,
  QuantBacktestVerdict,
  QuantBacktestWindow,
  QuantFactorKey,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FlaskConical,
  Sun,
  Moon,
  RotateCcw,
  Play,
  ShieldAlert,
  Layers,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { WordMark } from "@/components/Logo";
import { MobileNav } from "@/components/MobileNav";
import { PrimaryNav } from "@/components/PrimaryNav";
import { useTheme } from "@/lib/theme";

const FACTOR_KEYS: QuantFactorKey[] = [
  "momentum",
  "analyst",
  "valuation",
  "growth",
  "quality",
  "risk",
];

const FACTOR_LABELS: Record<QuantFactorKey, string> = {
  momentum: "Momentum / Trend",
  analyst: "Analyst Sentiment",
  valuation: "Valuation",
  growth: "Growth",
  quality: "Quality / Financial Strength",
  risk: "Risk / Volatility",
};

// The two factors the technical backtest can actually validate point-in-time.
const TECHNICAL_FACTORS = new Set<QuantFactorKey>(["momentum", "risk"]);

// Quant Score v1 base weights — the reset-to-default target. Kept in sync with
// the server's BASE_WEIGHTS; the server is authoritative and will re-normalise.
const DEFAULT_WEIGHTS: ModelWeights = {
  momentum: 0.26,
  analyst: 0.2,
  valuation: 0.16,
  growth: 0.14,
  quality: 0.14,
  risk: 0.1,
};

function normalise(weights: ModelWeights): ModelWeights {
  const total = FACTOR_KEYS.reduce((a, k) => a + (weights[k] || 0), 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as ModelWeights;
  for (const k of FACTOR_KEYS) out[k] = (weights[k] || 0) / total;
  return out;
}

function fmtPctVal(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function toneClass(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground";
  return n > 0 ? "text-pos" : n < 0 ? "text-neg" : "text-foreground/90";
}

function verdictTone(v: QuantBacktestVerdict): string {
  switch (v) {
    case "edge":
      return "border-pos/40 bg-pos/10 text-pos";
    case "no-edge":
      return "border-neg/40 bg-neg/10 text-neg";
    case "mixed":
      return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function verdictLabel(v: QuantBacktestVerdict): string {
  switch (v) {
    case "edge":
      return "Edge";
    case "no-edge":
      return "No edge";
    case "mixed":
      return "Mixed";
    default:
      return "Thin";
  }
}

function runBacktest(body: {
  weights?: ModelWeights;
  presetId?: string;
}): Promise<ModelLabBacktestResponse> {
  return apiRequest("POST", "/api/model-lab/backtest", body).then((r) =>
    r.json(),
  );
}

// One window's cohorts rendered as a compact table (mirrors Backtest v1).
function WindowCard({
  w,
  benchmarkSymbol,
}: {
  w: QuantBacktestWindow;
  benchmarkSymbol: string;
}) {
  if (!w.available) {
    return (
      <div
        className="rounded border border-border/60 bg-background/40 px-2.5 py-2"
        data-testid={`model-lab-window-${w.key}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-foreground/90">
            {w.label}
          </span>
          <span className="inline-flex items-center rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Unavailable
          </span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
          {w.status}
        </p>
      </div>
    );
  }
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-2.5 py-2 space-y-1.5"
      data-testid={`model-lab-window-${w.key}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-foreground/90">
          {w.label}
          <span className="ml-1.5 font-normal text-[10px] text-muted-foreground">
            {w.decisionDate ?? "?"} → {w.asOfDate ?? "?"}
          </span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          {w.evaluated} scored · {benchmarkSymbol} {fmtPctVal(w.benchmarkReturnPct)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] tabular-nums">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="font-medium pr-2 py-0.5">Cohort</th>
              <th className="font-medium px-1 py-0.5 text-right">N</th>
              <th className="font-medium px-1 py-0.5 text-right">Sel</th>
              <th className="font-medium px-1 py-0.5 text-right">Rest</th>
              <th className="font-medium px-1 py-0.5 text-right">vs rest</th>
              <th className="font-medium px-1 py-0.5 text-right">vs bmk</th>
              <th className="font-medium px-1 py-0.5 text-right">Hit</th>
              <th className="font-medium px-1 py-0.5 text-right">MaxDD</th>
              <th className="font-medium pl-1 py-0.5 text-right">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {w.thresholds.map((t) => (
              <tr
                key={t.key}
                className="border-t border-border/40"
                data-testid={`model-lab-cohort-${w.key}-${t.key}`}
              >
                <td className="pr-2 py-0.5 text-foreground/90 whitespace-nowrap">
                  {t.label}
                </td>
                <td className="px-1 py-0.5 text-right text-muted-foreground">
                  {t.selectedCount}
                </td>
                <td className="px-1 py-0.5 text-right">
                  {fmtPctVal(t.selectedAvgReturnPct)}
                </td>
                <td className="px-1 py-0.5 text-right text-muted-foreground">
                  {fmtPctVal(t.restAvgReturnPct)}
                </td>
                <td
                  className={cn(
                    "px-1 py-0.5 text-right",
                    toneClass(t.excessVsRestPct),
                  )}
                >
                  {fmtPctVal(t.excessVsRestPct)}
                </td>
                <td
                  className={cn(
                    "px-1 py-0.5 text-right",
                    toneClass(t.excessVsBenchmarkPct),
                  )}
                >
                  {fmtPctVal(t.excessVsBenchmarkPct)}
                </td>
                <td className="px-1 py-0.5 text-right text-muted-foreground">
                  {t.hitRatePct == null ? "—" : `${t.hitRatePct.toFixed(0)}%`}
                </td>
                <td className="px-1 py-0.5 text-right text-neg/90">
                  {fmtPctVal(t.selectedMaxDrawdownPct)}
                </td>
                <td className="pl-1 py-0.5 text-right">
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide",
                      verdictTone(t.verdict),
                    )}
                  >
                    {verdictLabel(t.verdict)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Investment group templates — these are now live on the Investment Groups
// page; this strip is a teaser that links across to build them.
const PLANNED_GROUPS: { name: string; blurb: string }[] = [
  {
    name: "Core Compounders",
    blurb: "High-quality, durable names with steady trend and lower volatility.",
  },
  {
    name: "High-Upside Speculative",
    blurb: "Higher-momentum, higher-risk names with asymmetric potential.",
  },
  {
    name: "AI Infrastructure",
    blurb: "Compute, networking and semis powering the AI build-out.",
  },
  {
    name: "Energy / Power",
    blurb: "Generation and grid exposure to AI-driven electricity demand.",
  },
  {
    name: "Risk-Controlled Watchlist",
    blurb: "Lower-volatility, risk-weighted candidates for a calmer book.",
  },
];

export default function ModelLab() {
  const { dark, setDark } = useTheme();
  const [weights, setWeights] = useState<ModelWeights>({ ...DEFAULT_WEIGHTS });
  // The last result the user explicitly ran, plus a small map of preset → run so
  // the comparison strip can show each strategy's headline once fetched.
  const [result, setResult] = useState<ModelLabBacktestResponse | null>(null);
  const [comparison, setComparison] = useState<
    Record<string, ModelLabBacktestResponse>
  >({});

  const norm = useMemo(() => normalise(weights), [weights]);

  const runMutation = useMutation({
    mutationFn: runBacktest,
    onSuccess: (data) => {
      setResult(data);
      // Seed the comparison strip with this run keyed by its strategy id so a
      // preset run (e.g. the initial "default") fills its comparison row.
      if (data.result.strategyId !== "custom") {
        setComparison((prev) => ({ ...prev, [data.result.strategyId]: data }));
      }
    },
  });

  const compareMutation = useMutation({
    mutationFn: (preset: ModelStrategyPreset) =>
      runBacktest({ presetId: preset.id }).then((d) => ({ id: preset.id, data: d })),
    onSuccess: ({ id, data }) =>
      setComparison((prev) => ({ ...prev, [id]: data })),
  });

  const presets = result?.presets ?? [];

  const setFactor = (k: QuantFactorKey, v: number) =>
    setWeights((prev) => ({ ...prev, [k]: v }));

  const applyPreset = (p: ModelStrategyPreset) =>
    setWeights(normalise(p.weights));

  const reset = () => setWeights({ ...DEFAULT_WEIGHTS });

  const runCustom = () => runMutation.mutate({ weights: norm });

  const runComparison = () => {
    for (const p of presets) compareMutation.mutate(p);
  };

  // Kick off a single default run on first mount so presets + a baseline result
  // are available without the user having to click first.
  useEffect(() => {
    runMutation.mutate({ presetId: "default" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const techCoverage = Math.round((norm.momentum + norm.risk) * 100);

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-background text-foreground pb-16 md:pb-0"
      data-testid="model-lab-page"
    >
      {/* Header */}
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <WordMark />
          <span className="hidden md:inline text-[11px] text-muted-foreground border-l border-border pl-3">
            Model Lab — quant weight sandbox
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
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-6 py-5 space-y-5">
        {/* Intro / sandbox framing */}
        <div className="space-y-1.5">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FlaskConical className="h-5 w-5 text-primary" aria-hidden />
            Model Lab
          </h1>
          <p className="text-[12px] text-muted-foreground leading-relaxed max-w-3xl">
            Inspect and tune the Quant Score v1 factor weights, then see how the{" "}
            <span className="font-medium text-foreground/90">
              technically-validatable
            </span>{" "}
            portion of those weights would have behaved historically. This is a
            modeling sandbox for research — not personalized financial advice.
          </p>
          <div
            className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 max-w-3xl"
            data-testid="model-lab-disclaimer"
          >
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>
              Only Momentum/Trend and Risk/Volatility are validated against price
              history. Valuation, Growth, Quality and Analyst weights shape the
              live Quant Score but are excluded from the backtest to avoid
              look-ahead bias.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-5">
          {/* Weight controls */}
          <section
            className="rounded-md border border-border/70 bg-card/40 p-4 space-y-4 h-fit"
            data-testid="model-lab-weights"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Factor weights
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={reset}
                data-testid="button-reset-weights"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset to default
              </Button>
            </div>

            <div className="space-y-3.5">
              {FACTOR_KEYS.map((k) => {
                const pct = Math.round(norm[k] * 100);
                const technical = TECHNICAL_FACTORS.has(k);
                return (
                  <div key={k} className="space-y-1" data-testid={`weight-row-${k}`}>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[12px] font-medium text-foreground/90 flex items-center gap-1.5">
                        {FACTOR_LABELS[k]}
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide",
                            technical
                              ? "bg-primary/10 text-primary"
                              : "bg-muted/60 text-muted-foreground",
                          )}
                          title={
                            technical
                              ? "Applied point-in-time in the technical backtest"
                              : "Informational — not used in the technical backtest"
                          }
                        >
                          {technical ? "Tested" : "Info"}
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={pct}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v))
                              setFactor(k, Math.max(0, v) / 100);
                          }}
                          className="w-12 h-6 rounded border border-border bg-background px-1 text-right text-[11px] tabular-nums"
                          data-testid={`weight-input-${k}`}
                          aria-label={`${FACTOR_LABELS[k]} weight percent`}
                        />
                        <span className="text-[11px] text-muted-foreground w-3">
                          %
                        </span>
                      </div>
                    </div>
                    <Slider
                      value={[pct]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(v) => setFactor(k, (v[0] ?? 0) / 100)}
                      data-testid={`weight-slider-${k}`}
                      aria-label={`${FACTOR_LABELS[k]} weight`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="rounded border border-border/60 bg-background/40 px-2.5 py-2 text-[11px] text-muted-foreground">
              Weights are normalised to 100%. Technically-validated coverage:{" "}
              <span className="font-semibold text-foreground/90">
                {techCoverage}%
              </span>{" "}
              (momentum + risk).
            </div>

            <Button
              className="w-full"
              size="sm"
              onClick={runCustom}
              disabled={runMutation.isPending}
              data-testid="button-run-backtest"
            >
              <Play className="h-3.5 w-3.5 mr-1.5" />
              {runMutation.isPending ? "Running…" : "Apply & run backtest"}
            </Button>

            {/* Preset shortcuts */}
            {presets.length > 0 && (
              <div className="space-y-1.5" data-testid="model-lab-preset-buttons">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Load a preset
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className="rounded border border-border bg-background/60 px-2 py-1 text-[11px] hover-elevate"
                      title={p.description}
                      data-testid={`preset-${p.id}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Results */}
          <section className="space-y-4" data-testid="model-lab-results">
            {runMutation.isPending && !result ? (
              <Skeleton className="h-[260px] rounded-md" />
            ) : runMutation.isError ? (
              <div
                className="rounded-md border border-neg/40 bg-neg/10 p-3 text-xs text-neg"
                data-testid="model-lab-error"
              >
                Backtest failed:{" "}
                {(runMutation.error as Error)?.message ?? "unknown error"}
              </div>
            ) : result ? (
              <>
                <div className="rounded-md border border-border/70 bg-card/40 p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold flex items-center gap-1.5">
                      Backtest under{" "}
                      <span className="text-primary">
                        {result.result.strategyLabel}
                      </span>
                    </h2>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                        {result.validationBadge}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Universe {result.universeSize} · {result.benchmarkSymbol}
                      </span>
                    </div>
                  </div>

                  {result.result.headline && (
                    <div
                      className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                      data-testid="model-lab-headline"
                    >
                      <HeadlineStat
                        label={`Top cohort (${result.result.headline.windowKey})`}
                        value={fmtPctVal(
                          result.result.headline.selectedAvgReturnPct,
                        )}
                      />
                      <HeadlineStat
                        label="vs benchmark"
                        value={fmtPctVal(
                          result.result.headline.excessVsBenchmarkPct,
                        )}
                        tone={toneClass(
                          result.result.headline.excessVsBenchmarkPct,
                        )}
                      />
                      <HeadlineStat
                        label="Hit rate"
                        value={
                          result.result.headline.hitRatePct == null
                            ? "—"
                            : `${result.result.headline.hitRatePct.toFixed(0)}%`
                        }
                      />
                      <HeadlineStat
                        label="Verdict"
                        value={verdictLabel(result.result.headline.verdict)}
                      />
                    </div>
                  )}

                  {result.result.tested ? (
                    <div className="space-y-2" data-testid="model-lab-windows">
                      {result.result.windows.map((w) => (
                        <WindowCard
                          key={w.key}
                          w={w}
                          benchmarkSymbol={result.benchmarkSymbol}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      No window had enough historical price coverage to evaluate.
                    </p>
                  )}

                  <details className="text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer select-none">
                      Methodology &amp; limitations
                    </summary>
                    <p className="mt-1 leading-relaxed">{result.methodology}</p>
                    <ul className="mt-1 space-y-0.5 list-disc pl-4">
                      {result.limitations.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                    <p className="mt-1 italic">{result.disclaimer}</p>
                  </details>
                </div>

                {/* Strategy comparison */}
                <div
                  className="rounded-md border border-border/70 bg-card/40 p-4 space-y-3"
                  data-testid="model-lab-comparison"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-primary/80" aria-hidden />
                      Strategy comparison
                    </h2>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={runComparison}
                      disabled={compareMutation.isPending || presets.length === 0}
                      data-testid="button-run-comparison"
                    >
                      {compareMutation.isPending
                        ? "Comparing…"
                        : "Run all presets"}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Headline = top-cohort forward return at the 1Y window (or the
                    deepest available). Technical-only; tilts differ mainly in
                    their momentum vs. risk blend.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] tabular-nums">
                      <thead>
                        <tr className="text-muted-foreground text-left">
                          <th className="font-medium pr-2 py-1">Strategy</th>
                          <th className="font-medium px-1 py-1 text-right">Mom</th>
                          <th className="font-medium px-1 py-1 text-right">Risk</th>
                          <th className="font-medium px-1 py-1 text-right">
                            Top ret
                          </th>
                          <th className="font-medium px-1 py-1 text-right">
                            vs bmk
                          </th>
                          <th className="font-medium pl-1 py-1 text-right">
                            Verdict
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {presets.map((p) => {
                          const r = comparison[p.id];
                          const h = r?.result.headline ?? null;
                          const w = r?.result.weights;
                          return (
                            <tr
                              key={p.id}
                              className="border-t border-border/40"
                              data-testid={`comparison-row-${p.id}`}
                            >
                              <td className="pr-2 py-1 text-foreground/90 whitespace-nowrap">
                                {p.label}
                              </td>
                              <td className="px-1 py-1 text-right text-muted-foreground">
                                {w ? `${Math.round(w.momentum * 100)}%` : "—"}
                              </td>
                              <td className="px-1 py-1 text-right text-muted-foreground">
                                {w ? `${Math.round(w.risk * 100)}%` : "—"}
                              </td>
                              <td className="px-1 py-1 text-right">
                                {fmtPctVal(h?.selectedAvgReturnPct)}
                              </td>
                              <td
                                className={cn(
                                  "px-1 py-1 text-right",
                                  toneClass(h?.excessVsBenchmarkPct),
                                )}
                              >
                                {fmtPctVal(h?.excessVsBenchmarkPct)}
                              </td>
                              <td className="pl-1 py-1 text-right">
                                {h ? (
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded border px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide",
                                      verdictTone(h.verdict),
                                    )}
                                  >
                                    {verdictLabel(h.verdict)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </div>

        {/* Investment groups — now live; this strip links across to build them. */}
        <section
          className="rounded-md border border-border bg-card/30 p-4 space-y-3"
          data-testid="model-lab-next-groups"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <ArrowRight className="h-4 w-4 text-primary" aria-hidden />
              Build investment groups
            </h2>
            <span className="inline-flex items-center rounded border border-pos/40 bg-pos/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-pos">
              Live
            </span>
            <Link
              href="/investment-groups"
              className="ml-auto text-[11px] font-medium text-primary hover:underline"
              data-testid="link-investment-groups"
            >
              Open Investment Groups →
            </Link>
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed max-w-3xl">
            Model outputs now turn into explainable groups / baskets on the
            Investment Groups page: pick a template, set min score / max risk /
            max holdings, and the model ranks the universe into a named group you
            can save to your watchlist. These are the available templates:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {PLANNED_GROUPS.map((g) => (
              <div
                key={g.name}
                className="rounded border border-border/60 bg-background/40 px-3 py-2"
                data-testid={`planned-group-${g.name}`}
              >
                <p className="text-[12px] font-medium text-foreground/90">
                  {g.name}
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {g.blurb}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <MobileNav />
    </div>
  );
}

function HeadlineStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-border/60 bg-background/40 px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-[13px] font-semibold tabular-nums", tone)}>
        {value}
      </p>
    </div>
  );
}
