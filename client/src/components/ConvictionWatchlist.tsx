import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ConvictionBreakoutStatus,
  ConvictionChartRange,
  ConvictionChartResponse,
  ConvictionIdea,
  ConvictionIdeasResponse,
  ConvictionRole,
  ConvictionRoleInfo,
  EquityRevenueResponse,
  RevenueBridge,
  RevenueBridgeSource,
  RevenueBridgeYear,
  ScenarioModel,
  SegmentBreakdownResponse,
  SegmentRow,
} from "@shared/schema";
import { CONVICTION_CHART_RANGES } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Anchor,
  Scale,
  Sparkles,
  Info,
  Target,
  ShieldAlert,
  AlertTriangle,
  ListChecks,
  CheckCircle2,
  Plus,
  Trash2,
  LineChart as LineChartIcon,
  DollarSign,
  Rocket,
  LayoutGrid,
  Cpu,
  Star,
  Eye,
  PanelLeft,
  Table2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Building2,
  Gauge,
  Beaker,
  Users,
} from "lucide-react";
import { fmtPrice, fmtCompactCurrency, fmtPct } from "@/lib/format";
import { ScenarioDerivation } from "@/components/ScenarioDerivation";
import {
  BuffettConvictionPanel,
  SignalConvictionPanel,
  RiskConvictionPanel,
  ActionSignalPanel,
  AnalystConsensusPanel,
  QuantBacktestPanel,
  QuantScoreBlock,
  SignalSection,
  ModelActionHeadline,
  QuantScoreHeadline,
  ScenarioHeadline,
  BuffettHeadline,
  AnalystHeadline,
  BacktestHeadline,
  useIdeaSignal,
  useIdeaBuffett,
  useIdeaActionSignal,
  useIdeaAnalystConsensus,
  deriveRisk,
  buffettScoreIsMeaningful,
  type DerivedRiskLevel,
} from "@/components/IdeaInsights";

const ROLE_ICON: Record<ConvictionRole, typeof Anchor> = {
  "core-compounder": Anchor,
  "asymmetric-candidate": Scale,
  "high-variance-optionality": Sparkles,
};

const SIZING_LABEL: Record<string, string> = {
  watchlist: "Watchlist band",
  starter: "Starter band",
  core: "Core band",
};

const REVIEW_LABEL: Record<string, string> = {
  fresh: "Fresh",
  monitoring: "Monitoring",
  "needs-review": "Needs review",
};

function perfTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-muted-foreground";
  return v >= 0 ? "text-pos" : "text-neg";
}

// Deterministic, template-driven research summary for the selected ticker.
// Built entirely from the already-loaded idea fields (scenario model,
// classification, key metrics) so it renders the instant a ticker is clicked —
// no LLM call and no extra network request. Framed as model/research context,
// never as a prediction or recommendation. Returns 2-3 short sentences, or a
// graceful pending line when the idea is too sparse to summarise.
function buildTickerNarrative(idea: ConvictionIdea): {
  sentences: string[];
  pending: boolean;
} {
  const name = idea.companyName && idea.companyName !== idea.ticker
    ? idea.companyName
    : idea.ticker;
  const theme = idea.themes?.[0] ?? idea.sectionLabel ?? null;
  const sm = idea.scenarioModel ?? null;
  const km = idea.keyMetrics ?? null;

  const sentences: string[] = [];

  // Sentence 1 — what it is and how the model frames it.
  const lead = theme
    ? `${idea.ticker} (${name}) sits in the ${theme} theme`
    : `${idea.ticker} (${name})`;
  if (sm) {
    sentences.push(
      `${lead}; TreasuryLens classifies it as a ${sm.classification} idea over a ${sm.horizonYears}-year horizon.`,
    );
  } else {
    sentences.push(`${lead}.`);
  }

  // Sentence 2 — scenario band (base / bull / bear) with explicit framing.
  if (sm) {
    const base = sm.base?.outputs?.impliedReturnPct;
    const bull = sm.bullUpsidePct;
    const bear = sm.bearDownsidePct;
    const parts: string[] = [];
    if (base != null && Number.isFinite(base)) parts.push(`base ${fmtPct(base, 0)}`);
    if (bull != null && Number.isFinite(bull)) parts.push(`bull ${fmtPct(bull, 0)}`);
    if (bear != null && Number.isFinite(bear)) parts.push(`bear ${fmtPct(bear, 0)}`);
    if (parts.length > 0) {
      const conf = sm.coverageConfidence ?? sm.modelConfidence;
      sentences.push(
        `The hypothetical scenario model spans ${parts.join(" / ")} implied return (${conf ?? "approximate"} data coverage).`,
      );
    }
  }

  // Sentence 3 — revenue growth context where available, else outcome framing.
  const rev = km?.revenueGrowth;
  if (rev != null && Number.isFinite(rev)) {
    const dir = rev >= 0 ? "growing" : "contracting";
    sentences.push(
      `Reported revenue is ${dir} about ${fmtPct(rev, 0)} year-over-year; ${idea.targetOutcome.toLowerCase()}.`,
    );
  } else if (idea.targetOutcome) {
    sentences.push(`Target framing: ${idea.targetOutcome}.`);
  }

  // Sparse idea (e.g. freshly added custom ticker with no scenario/metrics).
  if (!sm && !km && idea.thesisPending) {
    return {
      sentences: [
        `${idea.ticker} (${name}) was just added; market data, scenario model and analyst context load automatically. A fuller research summary will appear once that data resolves.`,
      ],
      pending: true,
    };
  }

  return { sentences, pending: false };
}

// The research-context narrative card. Renders at the top of the detail pane,
// immediately under the snapshot, so the model's read on the ticker is the
// first prose a user sees on click. Deterministic; no network call.
function TickerNarrative({ idea }: { idea: ConvictionIdea }) {
  const { sentences, pending } = buildTickerNarrative(idea);
  if (sentences.length === 0) return null;
  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-1.5"
      data-testid="idea-narrative"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary/80" aria-hidden />
        Research summary
        <span className="ml-1 rounded-sm bg-muted px-1 py-px text-[9px] font-medium normal-case tracking-normal text-muted-foreground">
          {pending ? "Pending" : "Model context"}
        </span>
      </div>
      <p
        className="text-sm leading-relaxed text-foreground/90"
        data-testid="idea-narrative-text"
      >
        {sentences.join(" ")}
      </p>
      <p className="text-[10px] text-muted-foreground italic">
        Deterministic summary of model inputs — not a prediction, target, or
        recommendation.
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: string;
  testId: string;
}) {
  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 px-3 py-2"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm font-semibold ${tone ?? "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function BulletSection({
  heading,
  icon: Icon,
  items,
  testId,
  tone,
}: {
  heading: string;
  icon: typeof Target;
  items: string[];
  testId: string;
  tone?: string;
}) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${tone ?? "text-primary/80"}`} aria-hidden />
        {heading}
      </div>
      <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/90">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

// Compact breakout status badge. Shows the latest 20D/50D breakout state with
// a volume-confirmation hint, or "No recent breakout" / unavailable. Kept tiny
// and wrappable so it sits cleanly in the chart header on mobile.
function BreakoutBadge({ breakout }: { breakout: ConvictionBreakoutStatus | undefined }) {
  if (!breakout || breakout.status === "unavailable") return null;

  if (breakout.status === "none") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        data-testid="breakout-badge"
        data-breakout-status="none"
        title={breakout.note}
      >
        No recent breakout
      </span>
    );
  }

  const isFresh = breakout.status === "breakout";
  const windowLabel = breakout.latestWindow != null ? `${breakout.latestWindow}D` : "";
  const tone = isFresh
    ? "border-pos/40 bg-pos/10 text-pos"
    : "border-amber-500/40 bg-amber-500/10 text-amber-500";
  const vol =
    breakout.volumeConfirmed === true
      ? "vol✓"
      : breakout.volumeConfirmed === false
        ? "vol↓"
        : null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}
      data-testid="breakout-badge"
      data-breakout-status={breakout.status}
      data-breakout-window={breakout.latestWindow ?? ""}
      title={breakout.note}
    >
      <Rocket className="h-3 w-3" aria-hidden />
      {isFresh ? "Breakout" : "Recent breakout"} · {windowLabel}
      {vol && (
        <span className="font-normal opacity-80" data-testid="breakout-volume">
          {vol}
        </span>
      )}
    </span>
  );
}

// Compact price + moving-average chart for the selected idea. Fetches a
// downsampled close series plus 50-/200-day SMAs from the server (deployment-
// safe via the shared query client). Mobile-friendly height + responsive.
const RANGE_LABELS: Record<ConvictionChartRange, string> = {
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  "6M": "6M",
  "1Y": "1Y",
  "5Y": "5Y",
  MAX: "Max",
};

function ConvictionChart({ ticker }: { ticker: string }) {
  const [range, setRange] = useState<ConvictionChartRange>("1Y");
  const query = useQuery<ConvictionChartResponse>({
    queryKey: ["/api/conviction-ideas/chart", `${ticker}?range=${range}`],
    enabled: !!ticker,
  });

  const data = query.data;
  const points = data?.points ?? [];
  const hasData = points.length > 0;
  const showMa50 = (data?.availableMaWindows ?? []).includes(50);
  const showMa200 = (data?.availableMaWindows ?? []).includes(200);
  const currency = data?.currency ?? "USD";
  const fmt = (v: number) => fmtPrice(v, currency);
  // Short ranges span days, not months — switch the axis label granularity so
  // the ticks stay meaningful (e.g. "Apr 12" instead of repeated "Apr 25").
  const intradayAxis = range === "1D" || range === "1W" || range === "1M";
  const axisFormat: Intl.DateTimeFormatOptions = intradayAxis
    ? { month: "short", day: "numeric" }
    : { month: "short", year: "2-digit" };

  // Only mark breakouts that fall inside the rendered (downsampled) window so
  // a ReferenceDot never floats off the visible axis.
  const domainMin = points.length ? points[0].t : 0;
  const domainMax = points.length ? points[points.length - 1].t : 0;
  const breakoutMarkers = (data?.breakout?.points ?? []).filter(
    (b) => b.t >= domainMin && b.t <= domainMax,
  );

  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-2"
      data-testid="idea-chart-card"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <LineChartIcon className="h-3.5 w-3.5 text-primary/80" aria-hidden />
            Price &amp; moving averages
          </div>
          <BreakoutBadge breakout={data?.breakout} />
        </div>
        <div
          className="inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-background/50 p-0.5"
          role="group"
          aria-label="Chart time range"
          data-testid="chart-range-selector"
        >
          {CONVICTION_CHART_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              data-testid={`chart-range-${r}`}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                range === r
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-0.5 rounded" style={{ background: "hsl(var(--chart-1))" }} />
            Price
          </span>
          {showMa50 && (
            <span className="inline-flex items-center gap-1" data-testid="chart-legend-ma50">
              <span className="inline-block w-2.5 h-0.5 rounded" style={{ background: "hsl(var(--chart-3))" }} />
              50-day
            </span>
          )}
          {showMa200 && (
            <span className="inline-flex items-center gap-1" data-testid="chart-legend-ma200">
              <span className="inline-block w-2.5 h-0.5 rounded" style={{ background: "hsl(var(--chart-5))" }} />
              200-day
            </span>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-[200px] sm:h-[240px] rounded-md" data-testid="chart-loading" />
      ) : query.isError ? (
        <div className="h-[200px] sm:h-[240px] flex items-center justify-center text-xs text-muted-foreground" data-testid="chart-error">
          Chart unavailable: {(query.error as Error)?.message ?? "unknown"}
        </div>
      ) : !hasData ? (
        <div className="h-[200px] sm:h-[240px] flex items-center justify-center text-xs text-muted-foreground" data-testid="chart-empty">
          {data?.note ?? "No price history available for this ticker."}
        </div>
      ) : (
        <div className="h-[200px] sm:h-[240px]" data-testid="idea-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="convictionPriceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t) =>
                  new Date(t).toLocaleDateString(undefined, axisFormat)
                }
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickFormatter={(v) => fmt(v)}
                domain={["auto", "auto"]}
                tickLine={false}
                width={58}
                orientation="right"
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--popover-border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={(t) =>
                  new Date(t as number).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                }
                formatter={(v: number, name: string) => [fmt(v), name]}
              />
              <Area
                type="monotone"
                dataKey="c"
                name="Price"
                stroke="hsl(var(--chart-1))"
                strokeWidth={1.5}
                fill="url(#convictionPriceFill)"
                isAnimationActive={false}
                dot={false}
              />
              {showMa50 && (
                <Line
                  type="monotone"
                  dataKey="ma50"
                  name="50-day MA"
                  stroke="hsl(var(--chart-3))"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              )}
              {showMa200 && (
                <Line
                  type="monotone"
                  dataKey="ma200"
                  name="200-day MA"
                  stroke="hsl(var(--chart-5))"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  strokeDasharray="3 3"
                  connectNulls
                />
              )}
              {breakoutMarkers.map((b) => (
                <ReferenceDot
                  key={b.t}
                  x={b.t}
                  y={b.c}
                  r={4}
                  fill={b.window === 50 ? "hsl(var(--chart-5))" : "hsl(var(--chart-2))"}
                  stroke="hsl(var(--background))"
                  strokeWidth={1.5}
                  isFront
                  ifOverflow="hidden"
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasData && data?.breakout && data.breakout.status !== "unavailable" && (
        <div
          className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground"
          data-testid="breakout-status"
          data-breakout-status={data.breakout.status}
        >
          <span>{data.breakout.note}</span>
          {breakoutMarkers.length > 0 && (
            <span className="flex items-center gap-2" data-testid="breakout-legend">
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: "hsl(var(--chart-2))" }}
                />
                20D
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: "hsl(var(--chart-5))" }}
                />
                50D
              </span>
            </span>
          )}
        </div>
      )}

      {data?.note && hasData && (
        <p className="text-[10px] text-muted-foreground" data-testid="chart-note">
          {data.note}
          {data.source && data.source !== "unavailable" ? ` · source: ${data.source}` : ""}
        </p>
      )}
    </div>
  );
}

// Current + historical revenue for the selected idea. Sourced from SEC EDGAR
// companyfacts via the shared query client. Renders a compact, mobile-friendly
// panel: TTM headline, a mini annual bar chart, a small quarterly table, and a
// projections row. Graceful "not available / not meaningful" states for
// ETFs/funds/foreign/ambiguous tickers.
// Compact at-a-glance headline for the collapsed Revenue accordion row — shows
// TTM revenue and YoY growth without expanding. Reuses the same query cache.
function RevenueHeadline({ ticker }: { ticker: string }) {
  const { data, isLoading, isError } = useQuery<EquityRevenueResponse>({
    queryKey: ["/api/conviction-ideas/revenue", ticker],
    enabled: !!ticker,
  });
  if (isLoading)
    return <span className="text-[11px] text-muted-foreground tabular-nums">Loading…</span>;
  const currency = data?.currency ?? "USD";
  const hasSeries = (data?.annual?.length ?? 0) > 0 || (data?.quarterly?.length ?? 0) > 0;
  const available = data?.status === "available" && hasSeries;
  if (isError || !available || data?.ttmRevenue == null)
    return <span className="text-[11px] text-muted-foreground tabular-nums">N/A</span>;
  return (
    <span className="text-[11px] text-muted-foreground" data-testid="revenue-headline">
      TTM{" "}
      <span className="font-semibold text-foreground tabular-nums">
        {fmtCompactCurrency(data.ttmRevenue, currency)}
      </span>
      {data.annualGrowthPct != null && (
        <span className={`ml-2 tabular-nums ${perfTone(data.annualGrowthPct)}`}>
          YoY {fmtPct(data.annualGrowthPct, 0)}
        </span>
      )}
    </span>
  );
}

// Per-row provenance badge for the revenue bridge. Light/dark friendly; uses
// theme tokens so the four sources are visually distinct without hard-coded
// colors. Labels are deliberately short to fit the table cell.
const BRIDGE_SOURCE_META: Record<
  RevenueBridgeSource,
  { label: string; cls: string }
> = {
  "sec-actual": {
    label: "SEC actual",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  "analyst-estimate": {
    label: "Analyst est.",
    cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
  },
  "treasurylens-model": {
    label: "TL model",
    cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
  },
  unavailable: {
    label: "Unavailable",
    cls: "bg-muted text-muted-foreground border-border/60",
  },
};

function BridgeSourceBadge({
  source,
  analystCount,
}: {
  source: RevenueBridgeSource;
  analystCount?: number | null;
}) {
  const meta = BRIDGE_SOURCE_META[source] ?? BRIDGE_SOURCE_META.unavailable;
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1 py-px text-[9px] font-medium ${meta.cls}`}
      data-testid={`bridge-source-${source}`}
    >
      {meta.label}
      {source === "analyst-estimate" && analystCount != null && analystCount > 0
        ? ` · ${analystCount}`
        : ""}
    </span>
  );
}

// A compact KPI card for the Revenue Intelligence header strip. Renders a
// transparent "—" when the value is unavailable rather than fabricating one.
function RevenueKpi({
  label,
  value,
  sub,
  tone,
  testId,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: string;
  testId: string;
}) {
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-2 py-2"
      data-testid={testId}
    >
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm font-semibold tabular-nums ${tone ?? "text-foreground"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// A small labelled section header used inside the Revenue Intelligence body so
// the panel reads as discrete blocks (KPIs / growth-came-from / growth-going)
// rather than one cramped scroll. Optional trailing slot for a source note.
function RevenueSectionHeader({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
          {title}
        </span>
        {hint && (
          <span className="text-[10px] text-muted-foreground truncate">{hint}</span>
        )}
      </div>
      {right}
    </div>
  );
}

// "Where growth came from" — built strictly from the real, reported portion of
// the revenue bridge (sec-actual rows). Each year is rendered as a horizontal
// contribution bar: the YoY dollar change and its share of the period's total
// added revenue. No fabricated segment attribution — this is the truthful
// total-revenue growth bridge the task calls for when segments are unavailable.
function GrowthCameFrom({
  bridge,
  currency,
}: {
  bridge: RevenueBridge;
  currency: string;
}) {
  // Reported actuals only, ascending. We need ≥2 to compute a YoY delta.
  const actuals = useMemo(
    () =>
      bridge.years
        .filter((y) => y.source === "sec-actual" && y.value != null)
        .sort((a, b) => a.fy - b.fy),
    [bridge.years],
  );

  const deltas = useMemo(() => {
    const out: {
      label: string;
      delta: number;
      growthPct: number | null;
    }[] = [];
    for (let i = 1; i < actuals.length; i++) {
      const prev = actuals[i - 1].value!;
      const cur = actuals[i].value!;
      out.push({
        label: actuals[i].label,
        delta: cur - prev,
        growthPct: prev !== 0 ? ((cur - prev) / prev) * 100 : null,
      });
    }
    return out;
  }, [actuals]);

  if (deltas.length === 0) return null;

  // Scale bars to the largest absolute delta so positive/negative years are
  // comparable within the panel.
  const maxAbs = Math.max(...deltas.map((d) => Math.abs(d.delta)), 1);

  return (
    <div className="space-y-2" data-testid="revenue-growth-came-from">
      <RevenueSectionHeader
        title="Where growth came from"
        hint="Reported YoY revenue change"
        right={<BridgeSourceBadge source="sec-actual" />}
      />
      <div className="space-y-1.5">
        {deltas.map((d) => {
          const pct = Math.min(100, (Math.abs(d.delta) / maxAbs) * 100);
          const up = d.delta >= 0;
          return (
            <div
              key={d.label}
              className="grid grid-cols-[3.2rem_1fr_5rem] items-center gap-2"
              data-testid={`growth-came-row-${d.label}`}
            >
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {d.label}
              </span>
              <div className="h-3 rounded-sm bg-muted/50 overflow-hidden">
                <div
                  className={`h-full rounded-sm ${up ? "bg-emerald-500/70" : "bg-rose-500/70"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={`text-[10px] text-right tabular-nums ${perfTone(d.delta)}`}
              >
                {up ? "+" : "−"}
                {fmtCompactCurrency(Math.abs(d.delta), currency)}
                {d.growthPct != null && (
                  <span className="text-muted-foreground">
                    {" "}
                    ({fmtPct(d.growthPct, 0)})
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Where growth is going · next 3–5 years ──────────────────────────────────
// A forward, year-by-year revenue bridge with a Bear / Base / Bull toggle and
// client-side tweakable assumptions. Everything is derived deterministically
// from data already on the page — no new API calls, no LLM:
//
//   • The base (FY0) anchor is the latest reported annual revenue (SEC actual).
//   • Near-term years reuse analyst-estimate years from the revenue bridge when
//     present (badged "Analyst est."); they are kept SEPARATE from user tweaks.
//   • Remaining years compound the selected scenario's revenue CAGR (the
//     TreasuryLens model assumption from the scenario model), badged "TL model".
//   • When the user tweaks the growth assumption, projected years switch to a
//     "User scenario" badge so model/analyst vs. user-driven is always explicit.
//   • Tweaks are client-side only (no persistence) and reset to model defaults.
//
// Tweak granularity: if real multi-year segment data exists we expose a slider
// per major segment (top segments by revenue) and roll the company total up
// from the segment projections. Otherwise we expose a single total-revenue
// growth slider. Either way the displayed bridge + target + CAGR update live.

type ForwardScenarioKey = "bear" | "base" | "bull";

const FORWARD_CASE_META: Record<
  ForwardScenarioKey,
  { label: string; tone: string; activeCls: string }
> = {
  bear: {
    label: "Bear",
    tone: "text-neg",
    activeCls: "bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400",
  },
  base: {
    label: "Base",
    tone: "text-foreground",
    activeCls: "bg-sky-500/15 border-sky-500/40 text-sky-600 dark:text-sky-400",
  },
  bull: {
    label: "Bull",
    tone: "text-pos",
    activeCls:
      "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  },
};

// One projected forward year for the rendered bridge.
interface ForwardYear {
  label: string;
  fy: number;
  value: number;
  growthPct: number | null;
  source: RevenueBridgeSource | "user-scenario";
  analystCount?: number | null;
}

const FORWARD_SOURCE_META: Record<
  RevenueBridgeSource | "user-scenario",
  { label: string; cls: string }
> = {
  ...BRIDGE_SOURCE_META,
  "user-scenario": {
    label: "User scenario",
    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
};

function ForwardSourceBadge({
  source,
  analystCount,
}: {
  source: RevenueBridgeSource | "user-scenario";
  analystCount?: number | null;
}) {
  const meta = FORWARD_SOURCE_META[source] ?? FORWARD_SOURCE_META.unavailable;
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1 py-px text-[9px] font-medium ${meta.cls}`}
      data-testid={`forward-source-${source}`}
    >
      {meta.label}
      {source === "analyst-estimate" && analystCount != null && analystCount > 0
        ? ` · ${analystCount}`
        : ""}
    </span>
  );
}

function ForwardGrowthScenario({
  model,
  revenue,
  segments,
  currency,
}: {
  model: ScenarioModel;
  revenue: EquityRevenueResponse;
  segments?: SegmentBreakdownResponse | null;
  currency: string;
}) {
  const horizon = Math.max(1, Math.min(model.horizonYears || 5, 7));
  const [activeCase, setActiveCase] = useState<ForwardScenarioKey>("base");

  // FY0 anchor: latest reported annual revenue (SEC actual). This is what we
  // compound forward. Falls back to TTM revenue when no annual point resolved.
  const annual = revenue.annual ?? [];
  const baseRevenue =
    annual.length > 0
      ? annual[annual.length - 1].value
      : (revenue.ttmRevenue ?? null);
  const baseFy =
    annual.length > 0 && annual[annual.length - 1].fy != null
      ? annual[annual.length - 1].fy!
      : new Date().getFullYear();
  const baseLabel =
    annual.length > 0 ? annual[annual.length - 1].label : `FY${baseFy}`;

  // Analyst-estimate forward years from the revenue bridge (total revenue only).
  // These anchor the near-term years and are kept separate from user tweaks.
  const analystForwardYears = useMemo(() => {
    const b = revenue.bridge;
    if (!b || b.status !== "available") return [];
    return b.years
      .filter(
        (y) =>
          y.source === "analyst-estimate" &&
          y.value != null &&
          (baseFy == null || y.fy > baseFy),
      )
      .sort((a, b) => a.fy - b.fy);
  }, [revenue.bridge, baseFy]);

  // Default per-case revenue CAGR (TreasuryLens model assumption).
  const caseCagr: Record<ForwardScenarioKey, number> = {
    bear: model.bear.assumptions.revenueCagrPct,
    base: model.base.assumptions.revenueCagrPct,
    bull: model.bull.assumptions.revenueCagrPct,
  };

  // Do we have real, tweakable segment data? Require ≥2 segments with revenue.
  const segRows =
    segments?.status === "available"
      ? (segments.segments ?? []).filter((s) => s.revenue != null)
      : [];
  const segmentMode = segRows.length >= 2 && baseRevenue != null;
  // Cap the number of sliders to keep the UI tidy; remainder folds into "Other".
  const MAJOR_SEG_LIMIT = 4;
  const majorSegments = useMemo(
    () =>
      [...segRows]
        .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
        .slice(0, MAJOR_SEG_LIMIT),
    [segRows],
  );

  // ── Tweak state ───────────────────────────────────────────────────────────
  // Total-revenue growth override (non-segment mode): one CAGR % per case.
  const [totalCagrOverride, setTotalCagrOverride] = useState<
    Record<ForwardScenarioKey, number | null>
  >({ bear: null, base: null, bull: null });
  // Segment-mode: per-segment CAGR override keyed by segment name, per case.
  const [segCagrOverride, setSegCagrOverride] = useState<
    Record<ForwardScenarioKey, Record<string, number | null>>
  >({ bear: {}, base: {}, bull: {} });

  // Default per-segment CAGR seed: the segment's reported YoY where available,
  // otherwise the case's total CAGR. This makes the segment sliders start from a
  // sensible, data-anchored position rather than zero.
  const segDefaultCagr = (segName: string, c: ForwardScenarioKey): number => {
    const row = majorSegments.find((s) => s.name === segName);
    const reported = row?.revenueYoYPct;
    if (reported != null && Number.isFinite(reported)) {
      // Blend reported YoY toward the case CAGR so bear/bull still differentiate.
      const blend =
        c === "base"
          ? reported
          : c === "bull"
            ? Math.max(reported, caseCagr.bull)
            : Math.min(reported, caseCagr.bear);
      return round1(blend);
    }
    return caseCagr[c];
  };

  const effectiveTotalCagr = (c: ForwardScenarioKey): number =>
    totalCagrOverride[c] ?? caseCagr[c];

  const effectiveSegCagr = (segName: string, c: ForwardScenarioKey): number =>
    segCagrOverride[c]?.[segName] ?? segDefaultCagr(segName, c);

  // Whether the active case has any user tweak (drives the source badge).
  const userTweaked = segmentMode
    ? Object.values(segCagrOverride[activeCase] ?? {}).some((v) => v != null)
    : totalCagrOverride[activeCase] != null;

  // ── Build the forward year-by-year bridge for the active case ─────────────
  const forward = useMemo<ForwardYear[]>(() => {
    if (baseRevenue == null) return [];
    const out: ForwardYear[] = [];
    let prev = baseRevenue;

    if (segmentMode && userTweaked) {
      // Segment-driven projection: compound each major segment independently
      // plus an "Other" remainder held at the case total CAGR, then sum.
      const majorBase = majorSegments.reduce(
        (acc, s) => acc + (s.revenue ?? 0),
        0,
      );
      const otherBase = Math.max(0, baseRevenue - majorBase);
      const segState = majorSegments.map((s) => ({
        name: s.name,
        value: s.revenue ?? 0,
        cagr: effectiveSegCagr(s.name, activeCase),
      }));
      let otherVal = otherBase;
      const otherCagr = effectiveTotalCagr(activeCase);
      for (let i = 1; i <= horizon; i++) {
        for (const st of segState) st.value *= 1 + st.cagr / 100;
        otherVal *= 1 + otherCagr / 100;
        const total =
          segState.reduce((acc, st) => acc + st.value, 0) + otherVal;
        out.push({
          label: `FY${baseFy + i}`,
          fy: baseFy + i,
          value: total,
          growthPct: prev !== 0 ? ((total - prev) / prev) * 100 : null,
          source: "user-scenario",
        });
        prev = total;
      }
      return out;
    }

    // Total-revenue projection. Near-term years use analyst estimates (unless
    // the user has overridden the total growth); later years compound the
    // effective case CAGR (model default OR user override).
    const cagr = effectiveTotalCagr(activeCase);
    const useAnalyst = !userTweaked && analystForwardYears.length > 0;
    for (let i = 1; i <= horizon; i++) {
      const fy = baseFy + i;
      const analystMatch = useAnalyst
        ? analystForwardYears.find((y) => y.fy === fy)
        : undefined;
      let value: number;
      let source: ForwardYear["source"];
      let analystCount: number | null | undefined;
      if (analystMatch && analystMatch.value != null) {
        value = analystMatch.value;
        source = "analyst-estimate";
        analystCount = analystMatch.analystCount;
      } else {
        value = prev * (1 + cagr / 100);
        source = userTweaked ? "user-scenario" : "treasurylens-model";
      }
      out.push({
        label: `FY${fy}`,
        fy,
        value,
        growthPct: prev !== 0 ? ((value - prev) / prev) * 100 : null,
        source,
        analystCount,
      });
      prev = value;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    baseRevenue,
    baseFy,
    horizon,
    activeCase,
    segmentMode,
    userTweaked,
    analystForwardYears,
    majorSegments,
    totalCagrOverride,
    segCagrOverride,
  ]);

  // Summary: target revenue at the horizon and implied CAGR over the full span.
  const target = forward.length > 0 ? forward[forward.length - 1].value : null;
  const impliedCagr =
    target != null && baseRevenue != null && baseRevenue > 0 && forward.length > 0
      ? (Math.pow(target / baseRevenue, 1 / forward.length) - 1) * 100
      : null;

  const analystAnchored = analystForwardYears.length > 0;
  const maxVal = Math.max(baseRevenue ?? 0, ...forward.map((f) => f.value), 1);

  const resetTweaks = () => {
    setTotalCagrOverride({ bear: null, base: null, bull: null });
    setSegCagrOverride({ bear: {}, base: {}, bull: {} });
  };

  if (baseRevenue == null) {
    return (
      <>
        <RevenueSectionHeader
          title="Where growth is going · next 3–5 years"
          right={<ForwardSourceBadge source="unavailable" />}
        />
        <p className="text-[11px] text-muted-foreground">
          A forward revenue scenario needs a reported revenue anchor, which did
          not resolve for this ticker.
        </p>
      </>
    );
  }

  return (
    <div className="space-y-3" data-testid="revenue-forward-scenario">
      <RevenueSectionHeader
        title="Where growth is going · next 3–5 years"
        hint={`${forward.length}y forward · ${model.classification}`}
        right={
          <ForwardSourceBadge
            source={
              userTweaked
                ? "user-scenario"
                : analystAnchored
                  ? "analyst-estimate"
                  : "treasurylens-model"
            }
          />
        }
      />

      {/* Scenario toggle: Bear / Base / Bull */}
      <div
        className="inline-flex rounded-md border border-border/60 bg-background/40 p-0.5"
        role="tablist"
        data-testid="forward-case-toggle"
      >
        {(["bear", "base", "bull"] as ForwardScenarioKey[]).map((k) => {
          const meta = FORWARD_CASE_META[k];
          const active = activeCase === k;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveCase(k)}
              data-testid={`forward-case-${k}`}
              className={`px-3 py-1 text-[11px] font-medium rounded-[5px] transition-colors ${
                active
                  ? `border ${meta.activeCls}`
                  : "border border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Summary strip: base → target, implied CAGR */}
      <div className="grid grid-cols-3 gap-2" data-testid="forward-summary">
        <div className="rounded border border-border/60 bg-background/40 px-2 py-2">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
            {baseLabel} base
          </div>
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {fmtCompactCurrency(baseRevenue, currency)}
          </div>
        </div>
        <div className="rounded border border-border/60 bg-background/40 px-2 py-2">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
            FY{baseFy + forward.length} target
          </div>
          <div
            className={`text-sm font-semibold tabular-nums ${FORWARD_CASE_META[activeCase].tone}`}
            data-testid="forward-target"
          >
            {target != null ? fmtCompactCurrency(target, currency) : "—"}
          </div>
        </div>
        <div className="rounded border border-border/60 bg-background/40 px-2 py-2">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
            Implied CAGR
          </div>
          <div
            className={`text-sm font-semibold tabular-nums ${impliedCagr != null ? perfTone(impliedCagr) : "text-foreground"}`}
            data-testid="forward-cagr"
          >
            {impliedCagr != null ? fmtPct(impliedCagr, 1, false) : "—"}
          </div>
        </div>
      </div>

      {/* Year-by-year forward bridge with per-year source badges */}
      <div className="overflow-x-auto" data-testid="forward-bridge">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-1 pr-2">Year</th>
              <th className="text-right font-medium py-1 pr-2">Revenue</th>
              <th className="text-right font-medium py-1 pr-2">YoY</th>
              <th className="text-right font-medium py-1">Source</th>
            </tr>
          </thead>
          <tbody>
            {/* FY0 reported anchor */}
            <tr className="border-t border-border/50" data-testid="forward-row-base">
              <td className="py-1 pr-2 text-foreground/90">{baseLabel}</td>
              <td className="py-1 pr-2 text-right font-medium text-foreground tabular-nums">
                {fmtCompactCurrency(baseRevenue, currency)}
              </td>
              <td className="py-1 pr-2 text-right text-muted-foreground">—</td>
              <td className="py-1 text-right">
                <ForwardSourceBadge source="sec-actual" />
              </td>
            </tr>
            {forward.map((y, i) => (
              <tr
                key={`${y.fy}-${i}`}
                className="border-t border-border/50"
                data-testid={`forward-row-${y.fy}`}
              >
                <td className="py-1 pr-2 text-foreground/90">{y.label}</td>
                <td className="py-1 pr-2 text-right font-medium text-foreground tabular-nums">
                  {fmtCompactCurrency(y.value, currency)}
                </td>
                <td
                  className={`py-1 pr-2 text-right tabular-nums ${y.growthPct != null ? perfTone(y.growthPct) : "text-muted-foreground"}`}
                >
                  {y.growthPct != null ? fmtPct(y.growthPct, 0, true) : "—"}
                </td>
                <td className="py-1 text-right">
                  <ForwardSourceBadge
                    source={y.source}
                    analystCount={y.analystCount}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mini bar chart of the projected path (base + forward years) */}
      <div className="flex items-end gap-1 h-16" data-testid="forward-bars" aria-hidden>
        {[
          { label: baseLabel, value: baseRevenue, base: true },
          ...forward.map((f) => ({ label: f.label, value: f.value, base: false })),
        ].map(
          (b, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div className="w-full flex items-end justify-center h-12">
                <div
                  className={`w-full rounded-sm ${b.base ? "bg-foreground/30" : FORWARD_CASE_META[activeCase].tone === "text-neg" ? "bg-rose-500/60" : FORWARD_CASE_META[activeCase].tone === "text-pos" ? "bg-emerald-500/60" : "bg-sky-500/60"}`}
                  style={{ height: `${Math.max(4, (b.value / maxVal) * 100)}%` }}
                />
              </div>
              <span className="text-[8px] text-muted-foreground tabular-nums">
                {b.label.replace("FY", "'").replace("20", "")}
              </span>
            </div>
          ),
        )}
      </div>

      {/* Tweakable assumptions */}
      <div
        className="rounded border border-border/60 bg-background/40 p-2.5 space-y-2.5"
        data-testid="forward-tweaks"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tweak assumptions
            <span className="ml-1.5 font-normal normal-case text-muted-foreground/80">
              {segmentMode
                ? "segment growth (CAGR %)"
                : "total-revenue growth (CAGR %)"}
            </span>
          </span>
          <button
            type="button"
            onClick={resetTweaks}
            disabled={!userTweaked}
            data-testid="forward-reset"
            className="text-[10px] text-primary disabled:text-muted-foreground/50 hover:underline"
          >
            Reset to model
          </button>
        </div>

        {segmentMode ? (
          <div className="space-y-2.5">
            {majorSegments.map((s) => {
              const val = effectiveSegCagr(s.name, activeCase);
              return (
                <div key={s.name} className="space-y-1" data-testid={`forward-seg-slider-${s.name}`}>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-foreground/80 truncate max-w-[12rem]" title={s.name}>
                      {s.name}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtPct(val, 1, true)}
                    </span>
                  </div>
                  <Slider
                    min={-20}
                    max={60}
                    step={0.5}
                    value={[val]}
                    onValueChange={([v]) =>
                      setSegCagrOverride((prev) => ({
                        ...prev,
                        [activeCase]: { ...prev[activeCase], [s.name]: v },
                      }))
                    }
                    aria-label={`${s.name} growth assumption`}
                  />
                </div>
              );
            })}
            <p className="text-[9px] text-muted-foreground">
              Remaining revenue (other/unsegmented) compounds at the {FORWARD_CASE_META[activeCase].label.toLowerCase()}-case
              total CAGR ({fmtPct(effectiveTotalCagr(activeCase), 1, false)}). Sliders seed from
              reported segment YoY; edits become a User scenario.
            </p>
          </div>
        ) : (
          <div className="space-y-1" data-testid="forward-total-slider">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-foreground/80">
                {FORWARD_CASE_META[activeCase].label}-case revenue CAGR
              </span>
              <span className="tabular-nums text-muted-foreground">
                {fmtPct(effectiveTotalCagr(activeCase), 1, true)}
              </span>
            </div>
            <Slider
              min={-20}
              max={60}
              step={0.5}
              value={[effectiveTotalCagr(activeCase)]}
              onValueChange={([v]) =>
                setTotalCagrOverride((prev) => ({ ...prev, [activeCase]: v }))
              }
              aria-label="Total revenue growth assumption"
            />
            <p className="text-[9px] text-muted-foreground">
              {analystAnchored && !userTweaked
                ? "Near-term years are anchored to analyst consensus; later years use this model CAGR. Moving the slider switches projected years to a User scenario."
                : "Default is the TreasuryLens model CAGR. Moving the slider creates a User scenario."}
            </p>
          </div>
        )}
      </div>

      {model.methodology && (
        <p
          className="text-[10px] text-muted-foreground leading-relaxed"
          data-testid="forward-method"
        >
          {model.methodology}
        </p>
      )}
    </div>
  );
}

// Round to one decimal — small local helper for slider seeds.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Tiny inline sparkline for a segment's multi-year revenue history. Renders a
// single polyline scaled to the segment's own min/max. Returns a transparent
// "trend unavailable" dash when fewer than 2 points exist — never fabricated.
function SegmentSparkline({
  values,
  up,
}: {
  values: number[];
  up: boolean | null;
}) {
  if (values.length < 2) {
    return (
      <span className="text-[10px] text-muted-foreground" title="Trend needs ≥2 reported years">
        —
      </span>
    );
  }
  const w = 56;
  const h = 16;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 2) + 1;
      const y = h - 1 - ((v - min) / span) * (h - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = up == null ? "currentColor" : up ? "#10b981" : "#f43f5e";
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Source badge for the segment breakdown, mirroring the bridge source badges so
// provenance reads consistently across the Revenue Intelligence section.
const SEGMENT_SOURCE_META: Record<string, { label: string; cls: string }> = {
  "finance-segments": {
    label: "Finance segments",
    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  "sec-segments": {
    label: "SEC segments",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  "treasurylens-normalized": {
    label: "TL normalized",
    cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
  },
  unavailable: {
    label: "Unavailable",
    cls: "bg-muted text-muted-foreground border-border/60",
  },
};

function SegmentSourceBadge({ source }: { source: string }) {
  const meta = SEGMENT_SOURCE_META[source] ?? SEGMENT_SOURCE_META.unavailable;
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1 py-px text-[9px] font-medium ${meta.cls}`}
      data-testid={`segment-source-${source}`}
    >
      {meta.label}
    </span>
  );
}

// Segment Breakdown — the Hybrid artifact table: Segment, Revenue, Mix, YoY,
// OP Margin, Profit Mix, Punch, 3-Yr Trend. Replaces the old "unavailable"
// state when real segment data resolves; otherwise renders a polished
// unavailable note. Never fabricates: unavailable fields render as "—".
function SegmentBreakdown({
  ticker,
  currency,
}: {
  ticker: string;
  currency: string;
}) {
  const { data, isLoading, isError } = useQuery<SegmentBreakdownResponse>({
    queryKey: ["/api/conviction-ideas/segments", ticker],
    enabled: !!ticker,
  });

  if (isLoading) {
    return <Skeleton className="h-[120px] rounded-md" data-testid="segments-loading" />;
  }

  const available =
    !isError && data?.status === "available" && (data.segments?.length ?? 0) > 0;

  if (!available) {
    return (
      <div
        className="rounded border border-dashed border-border/60 bg-background/30 px-3 py-2 text-[11px] text-muted-foreground"
        data-testid="revenue-segments-unavailable"
      >
        <span className="font-semibold text-foreground/90">Segment breakdown:</span>{" "}
        {data?.note ??
          "Segment-level revenue split is unavailable for this ticker. The bridge above reflects total reported revenue, not illustrative segment data."}
      </div>
    );
  }

  const cur = data!.currency || currency;
  const fmtMoney = (v: number | null) =>
    v != null ? fmtCompactCurrency(v, cur) : "—";
  const fmtPctCell = (v: number | null) => (v != null ? fmtPct(v, 0) : "—");

  return (
    <div className="space-y-2" data-testid="revenue-segments-table">
      <RevenueSectionHeader
        title="Segment breakdown"
        hint={
          data!.fiscalYear != null
            ? `Latest FY${data!.fiscalYear} reported segments`
            : "Reported segments"
        }
        right={<SegmentSourceBadge source={data!.source} />}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] tabular-nums" data-testid="segments-grid">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="py-1 pr-2 font-medium">Segment</th>
              <th className="py-1 px-1.5 font-medium text-right">Revenue</th>
              <th className="py-1 px-1.5 font-medium text-right">Mix</th>
              <th className="py-1 px-1.5 font-medium text-right">YoY</th>
              <th className="py-1 px-1.5 font-medium text-right">OP Margin</th>
              <th className="py-1 px-1.5 font-medium text-right">Profit Mix</th>
              <th className="py-1 px-1.5 font-medium text-right">Punch</th>
              <th className="py-1 pl-1.5 font-medium text-right">3-Yr Trend</th>
            </tr>
          </thead>
          <tbody>
            {data!.segments.map((s: SegmentRow) => {
              const revHist = s.history
                .map((p) => p.revenue)
                .filter((v): v is number => v != null);
              const trendUp =
                s.revenueYoYPct != null ? s.revenueYoYPct >= 0 : null;
              return (
                <tr
                  key={s.rawMember ?? s.name}
                  className="border-t border-border/40"
                  data-testid={`segment-row-${s.name}`}
                >
                  <td className="py-1 pr-2 text-foreground/90 whitespace-nowrap max-w-[10rem] truncate" title={s.name}>
                    {s.name}
                  </td>
                  <td className="py-1 px-1.5 text-right font-semibold text-foreground">
                    {fmtMoney(s.revenue)}
                  </td>
                  <td className="py-1 px-1.5 text-right text-muted-foreground">
                    {fmtPctCell(s.revenueMixPct)}
                  </td>
                  <td className={`py-1 px-1.5 text-right ${s.revenueYoYPct != null ? perfTone(s.revenueYoYPct) : "text-muted-foreground"}`}>
                    {fmtPctCell(s.revenueYoYPct)}
                  </td>
                  <td className="py-1 px-1.5 text-right text-muted-foreground">
                    {fmtPctCell(s.operatingMarginPct)}
                  </td>
                  <td className="py-1 px-1.5 text-right text-muted-foreground">
                    {fmtPctCell(s.profitMixPct)}
                  </td>
                  <td className={`py-1 px-1.5 text-right ${s.punchPpts != null ? perfTone(s.punchPpts) : "text-muted-foreground"}`}>
                    {s.punchPpts != null
                      ? `${s.punchPpts >= 0 ? "+" : ""}${s.punchPpts.toFixed(1)}`
                      : "—"}
                  </td>
                  <td className="py-1 pl-1.5 text-right">
                    <div className="flex justify-end">
                      <SegmentSparkline values={revHist} up={trendUp} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground" data-testid="segments-note">
        {data!.note}
        {data!.confidence ? ` · Confidence: ${data!.confidence}` : ""}
        {!data!.hasMultiYear ? " · Trend unavailable (single year reported)" : ""}
      </p>
    </div>
  );
}

// "Where growth came from" — segment attribution variant. When reliable
// multi-year segment history exists, attribute the latest-year revenue change
// to each segment's YoY dollar delta. Renders the same horizontal-bar layout as
// the total-revenue fallback so the section reads consistently.
function GrowthCameFromSegments({
  segments,
  currency,
}: {
  segments: SegmentRow[];
  currency: string;
}) {
  const deltas = useMemo(() => {
    const out: { label: string; delta: number; growthPct: number | null }[] = [];
    for (const s of segments) {
      const hist = s.history.filter((p) => p.revenue != null);
      if (hist.length < 2) continue;
      const cur = hist[hist.length - 1].revenue!;
      const prev = hist[hist.length - 2].revenue!;
      out.push({
        label: s.name,
        delta: cur - prev,
        growthPct: prev !== 0 ? ((cur - prev) / prev) * 100 : null,
      });
    }
    // Largest absolute contribution first.
    out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return out;
  }, [segments]);

  if (deltas.length === 0) return null;
  const maxAbs = Math.max(...deltas.map((d) => Math.abs(d.delta)), 1);

  return (
    <div className="space-y-2" data-testid="revenue-growth-came-from-segments">
      <RevenueSectionHeader
        title="Where growth came from"
        hint="Latest-FY revenue change by segment"
        right={<SegmentSourceBadge source="sec-segments" />}
      />
      <div className="space-y-1.5">
        {deltas.map((d) => {
          const pct = Math.min(100, (Math.abs(d.delta) / maxAbs) * 100);
          const up = d.delta >= 0;
          return (
            <div
              key={d.label}
              className="grid grid-cols-[7rem_1fr_5rem] items-center gap-2"
              data-testid={`growth-came-seg-${d.label}`}
            >
              <span className="text-[10px] text-muted-foreground truncate" title={d.label}>
                {d.label}
              </span>
              <div className="h-3 rounded-sm bg-muted/50 overflow-hidden">
                <div
                  className={`h-full rounded-sm ${up ? "bg-emerald-500/70" : "bg-rose-500/70"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`text-[10px] text-right tabular-nums ${perfTone(d.delta)}`}>
                {up ? "+" : "−"}
                {fmtCompactCurrency(Math.abs(d.delta), currency)}
                {d.growthPct != null && (
                  <span className="text-muted-foreground"> ({fmtPct(d.growthPct, 0)})</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Revenue Story ───────────────────────────────────────────────────────────
// A deterministic, source-aware narrative built ENTIRELY from already-resolved
// structured data (revenue response, key metrics, segment breakdown, scenario
// model). No LLM call, no fabricated analyst commentary. Every clause is gated
// on the underlying data actually existing, and source-aware wording is used so
// the reader always knows whether a figure is reported (SEC filing), an analyst
// estimate/consensus, or a TreasuryLens model assumption.
//
// Returns an array of paragraph strings (1–2 paragraphs). Empty array when not
// enough structured data resolved to say anything truthful.
function buildRevenueStory({
  data,
  keyMetrics,
  segments,
  scenarioModel,
  currency,
  ticker,
}: {
  data: EquityRevenueResponse;
  keyMetrics?: ConvictionIdea["keyMetrics"] | null;
  segments?: SegmentBreakdownResponse | null;
  scenarioModel?: ScenarioModel | null;
  currency: string;
  ticker: string;
}): string[] {
  const annual = data.annual ?? [];
  const latest = annual.length > 0 ? annual[annual.length - 1] : null;
  if (!latest) return [];

  const name = data.entityName ?? ticker;
  const paras: string[] = [];

  // ── Paragraph 1: reported revenue, growth, margin, top segment ────────────
  const s1: string[] = [];
  s1.push(
    `${name} reported ${fmtCompactCurrency(latest.value, currency)} of revenue in ${latest.label} (SEC filing).`,
  );
  if (data.annualGrowthPct != null) {
    const dir = data.annualGrowthPct >= 0 ? "up" : "down";
    s1.push(
      `That is ${dir} ${fmtPct(Math.abs(data.annualGrowthPct), 0, false)} year over year.`,
    );
  }
  // Operating income / margin where available (key metrics, TTM basis).
  if (keyMetrics?.operatingMargin != null) {
    const opInc = keyMetrics.operatingIncomeTtm;
    s1.push(
      opInc != null
        ? `Trailing operating income runs about ${fmtCompactCurrency(opInc, currency)}, a ${fmtPct(keyMetrics.operatingMargin, 0, false)} operating margin (SEC filing).`
        : `Trailing operating margin is about ${fmtPct(keyMetrics.operatingMargin, 0, false)} (SEC filing).`,
    );
  }

  // Top segment by revenue, with mix, and — only when profit data exists —
  // profit mix / margin. Gated on real segment data.
  const segRows =
    segments?.status === "available" ? (segments.segments ?? []) : [];
  const topByRev =
    segRows.length > 0
      ? [...segRows]
          .filter((s) => s.revenue != null)
          .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0]
      : null;
  const segSourceWord =
    segments?.source === "sec-segments"
      ? "SEC filing"
      : segments?.source === "finance-segments"
        ? "segment data"
        : "reported segments";
  if (topByRev) {
    const mix =
      topByRev.revenueMixPct != null
        ? ` — about ${fmtPct(topByRev.revenueMixPct, 0, false)} of revenue`
        : "";
    s1.push(
      `${topByRev.name} is the largest reported segment${mix} (${segSourceWord}).`,
    );
    // Profit-mix / punch claim ONLY when segment profit data exists.
    if (
      topByRev.profitMixPct != null &&
      topByRev.revenueMixPct != null
    ) {
      const punch = topByRev.punchPpts;
      if (punch != null && Math.abs(punch) >= 1) {
        s1.push(
          punch > 0
            ? `It punches above its weight on profit, contributing ${fmtPct(topByRev.profitMixPct, 0, false)} of segment operating profit${topByRev.operatingMarginPct != null ? ` at a ${fmtPct(topByRev.operatingMarginPct, 0, false)} margin` : ""}.`
            : `It carries a lighter profit share (${fmtPct(topByRev.profitMixPct, 0, false)} of segment operating profit) than its revenue weight.`,
        );
      } else {
        s1.push(
          `Its profit share (${fmtPct(topByRev.profitMixPct, 0, false)}) tracks its revenue weight.`,
        );
      }
    }
  }
  paras.push(s1.join(" "));

  // ── Paragraph 2: growth attribution + forward outlook ─────────────────────
  const s2: string[] = [];

  // Which segment drove last year's growth — ONLY when multi-year segment
  // history exists for ≥2 segments (so the attribution is real, not guessed).
  if (segments?.status === "available" && segments.hasMultiYear) {
    const deltas = segRows
      .map((s) => {
        const hist = s.history.filter((p) => p.revenue != null);
        if (hist.length < 2) return null;
        const cur = hist[hist.length - 1].revenue!;
        const prev = hist[hist.length - 2].revenue!;
        return { name: s.name, delta: cur - prev };
      })
      .filter((d): d is { name: string; delta: number } => d != null);
    const totalAdded = deltas.reduce(
      (acc, d) => acc + (d.delta > 0 ? d.delta : 0),
      0,
    );
    const topDriver = [...deltas].sort(
      (a, b) => b.delta - a.delta,
    )[0];
    if (topDriver && topDriver.delta > 0 && totalAdded > 0) {
      const share = (topDriver.delta / totalAdded) * 100;
      s2.push(
        `Most of last year's revenue gain came from ${topDriver.name}, which drove roughly ${fmtPct(share, 0, false)} of the added revenue (${segSourceWord}).`,
      );
    }
  }

  // Forward outlook: prefer analyst consensus for TOTAL revenue when present in
  // the bridge; otherwise TreasuryLens model language. Never attribute
  // segment-specific commentary to analysts.
  const bridge = data.bridge;
  const analystYears =
    bridge?.years.filter(
      (y) => y.source === "analyst-estimate" && y.value != null,
    ) ?? [];
  const modelYears =
    bridge?.years.filter(
      (y) => y.source === "treasurylens-model" && y.value != null,
    ) ?? [];
  if (analystYears.length > 0) {
    const lastEst = analystYears[analystYears.length - 1];
    const cov =
      lastEst.analystCount != null && lastEst.analystCount > 0
        ? ` (${lastEst.analystCount} analysts)`
        : "";
    s2.push(
      `Analyst consensus for total revenue${cov} points to about ${fmtCompactCurrency(lastEst.value!, currency)} by ${lastEst.label}${bridge?.estimateSource ? `, via ${bridge.estimateSource}` : ""}.`,
    );
    if (modelYears.length > 0) {
      s2.push(
        `Years beyond consensus are filled by the TreasuryLens growth-fade model (assumption, not analyst commentary).`,
      );
    }
  } else if (scenarioModel) {
    const baseCagr = scenarioModel.base.assumptions.revenueCagrPct;
    const baseRev = scenarioModel.base.derivation?.futureRevenue ?? null;
    s2.push(
      baseRev != null
        ? `No analyst revenue consensus is available, so the forward view is a TreasuryLens model assumption: a ${fmtPct(baseCagr, 0, false)} base-case revenue CAGR implies about ${fmtCompactCurrency(baseRev, currency)} in revenue by FY+${scenarioModel.horizonYears}.`
        : `No analyst revenue consensus is available; the forward view uses a TreasuryLens model assumption of a ${fmtPct(baseCagr, 0, false)} base-case revenue CAGR.`,
    );
  } else if (modelYears.length > 0) {
    s2.push(
      `Forward years are TreasuryLens model estimates — no analyst revenue consensus is available for this name.`,
    );
  }

  if (s2.length > 0) paras.push(s2.join(" "));
  return paras;
}

function RevenueStoryBlock({
  paragraphs,
}: {
  paragraphs: string[];
}) {
  if (paragraphs.length === 0) return null;
  return (
    <div
      className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 space-y-2"
      data-testid="revenue-story-block"
    >
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-primary/80" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Revenue story
        </span>
      </div>
      {paragraphs.map((p, i) => (
        <p
          key={i}
          className="text-xs leading-relaxed text-foreground/90"
          data-testid={`revenue-story-para-${i}`}
        >
          {p}
        </p>
      ))}
    </div>
  );
}

function RevenuePanel({
  ticker,
  keyMetrics,
  scenarioModel,
}: {
  ticker: string;
  keyMetrics?: ConvictionIdea["keyMetrics"] | null;
  scenarioModel?: ScenarioModel | null;
}) {
  const query = useQuery<EquityRevenueResponse>({
    queryKey: ["/api/conviction-ideas/revenue", ticker],
    enabled: !!ticker,
  });
  // Segment breakdown shares one query for both the table and the
  // "Where growth came from" attribution decision (single network round-trip).
  const segmentsQuery = useQuery<SegmentBreakdownResponse>({
    queryKey: ["/api/conviction-ideas/segments", ticker],
    enabled: !!ticker,
  });
  const segments = segmentsQuery.data;
  // Use segment attribution only when reliable multi-year segment history
  // exists; otherwise fall back to the truthful total-revenue YoY bridge.
  const segmentAttributionRows = useMemo(() => {
    if (
      segments?.status !== "available" ||
      !segments.hasMultiYear ||
      (segments.segments?.length ?? 0) < 2
    ) {
      return null;
    }
    const usable = segments.segments.filter(
      (s) => s.history.filter((p) => p.revenue != null).length >= 2,
    );
    return usable.length >= 2 ? usable : null;
  }, [segments]);
  const data = query.data;
  const currency = data?.currency ?? "USD";
  const annual = data?.annual ?? [];
  const quarterly = data?.quarterly ?? [];
  const hasSeries = annual.length > 0 || quarterly.length > 0;
  const available = data?.status === "available" && hasSeries;
  const bridge = data?.bridge;

  // Latest reported annual revenue (annual is ascending → last is newest).
  const latestAnnual = annual.length > 0 ? annual[annual.length - 1] : null;

  // Top growth year across the bridge — the highest YoY growth row, used as the
  // "growth driver" KPI when no segment-level driver is available. Honest: it is
  // labelled as the fastest-growth year, not a fabricated segment.
  const topGrowthYear = useMemo(() => {
    if (!bridge || bridge.years.length === 0) return null;
    let best: RevenueBridgeYear | null = null;
    for (const y of bridge.years) {
      if (y.growthPct == null) continue;
      if (best == null || (best.growthPct ?? -Infinity) < y.growthPct) best = y;
    }
    return best;
  }, [bridge]);

  // Deterministic, source-aware Revenue Story built from already-resolved
  // structured data (revenue, key metrics, segments, scenario model). No LLM.
  const revenueStory = useMemo(() => {
    if (!available || !data) return [];
    return buildRevenueStory({
      data,
      keyMetrics,
      segments,
      scenarioModel,
      currency,
      ticker,
    });
  }, [available, data, keyMetrics, segments, scenarioModel, currency, ticker]);

  return (
    <div className="space-y-3" data-testid="idea-revenue-card">
      {query.isLoading ? (
        <Skeleton className="h-[160px] rounded-md" data-testid="revenue-loading" />
      ) : query.isError ? (
        <div className="text-xs text-muted-foreground" data-testid="revenue-error">
          Revenue unavailable: {(query.error as Error)?.message ?? "unknown"}
        </div>
      ) : !available ? (
        <div
          className="rounded border border-border/60 bg-background/40 px-3 py-3 text-xs text-muted-foreground"
          data-testid="revenue-status"
        >
          {data?.status === "not-meaningful"
            ? "Not meaningful — "
            : "Not available — "}
          {data?.note ??
            "Historical revenue is not available from free SEC data for this ticker."}
        </div>
      ) : (
        <div className="space-y-4" data-testid="revenue-body">
          {/* Revenue Story — a deterministic, source-aware narrative (1–2
              paragraphs) built from the resolved structured data. Opens the
              section the way the Hybrid artifact leads. */}
          <RevenueStoryBlock paragraphs={revenueStory} />

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="revenue-kpis">
            <RevenueKpi
              label="Latest FY rev."
              value={
                latestAnnual ? fmtCompactCurrency(latestAnnual.value, currency) : "—"
              }
              sub={latestAnnual?.label ?? null}
              testId="kpi-latest-annual"
            />
            <RevenueKpi
              label={data?.ttmIsAnnualFallback ? "Revenue (FY)" : "TTM rev."}
              value={
                data?.ttmRevenue != null
                  ? fmtCompactCurrency(data.ttmRevenue, currency)
                  : "—"
              }
              sub={
                data?.annualGrowthPct != null
                  ? `YoY ${fmtPct(data.annualGrowthPct, 0)}`
                  : null
              }
              tone={data?.annualGrowthPct != null ? perfTone(data.annualGrowthPct) : undefined}
              testId="kpi-ttm"
            />
            <RevenueKpi
              label="Op. margin"
              value={
                keyMetrics?.operatingMargin != null
                  ? fmtPct(keyMetrics.operatingMargin, 0)
                  : "—"
              }
              sub={
                keyMetrics?.operatingIncomeTtm != null
                  ? fmtCompactCurrency(keyMetrics.operatingIncomeTtm, currency)
                  : keyMetrics?.operatingMargin == null
                    ? "unavailable"
                    : null
              }
              testId="kpi-op-margin"
            />
            <RevenueKpi
              label="Fastest growth yr"
              value={
                topGrowthYear && topGrowthYear.growthPct != null
                  ? fmtPct(topGrowthYear.growthPct, 0)
                  : "—"
              }
              sub={topGrowthYear?.label ?? "unavailable"}
              tone={
                topGrowthYear?.growthPct != null
                  ? perfTone(topGrowthYear.growthPct)
                  : undefined
              }
              testId="kpi-top-driver"
            />
          </div>

          {/* ── Where growth came from ──────────────────────────────────
              Real reported history: the annual revenue chart, a YoY
              contribution view, and the full year-by-year bridge table with
              source badges. Grouped into one card for clear hierarchy. */}
          <div
            className="rounded-md border border-border/60 bg-background/30 p-3 space-y-3"
            data-testid="revenue-history-card"
          >
          {/* YoY contribution: prefer real segment attribution when reliable
              multi-year segment history exists; otherwise fall back to the
              truthful total-revenue YoY bridge. */}
          {segmentAttributionRows ? (
            <GrowthCameFromSegments
              segments={segmentAttributionRows}
              currency={currency}
            />
          ) : (
            bridge &&
            bridge.status === "available" && (
              <GrowthCameFrom bridge={bridge} currency={currency} />
            )
          )}

          {/* Annual revenue chart (actual reported series). */}
          {annual.length > 0 && (
            <div className="h-[140px]" data-testid="revenue-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={annual} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid
                    stroke="hsl(var(--border))"
                    strokeOpacity={0.4}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickFormatter={(v) => fmtCompactCurrency(v, currency)}
                    tickLine={false}
                    width={52}
                    orientation="right"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--popover-border))",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [fmtCompactCurrency(v, currency), "Revenue"]}
                  />
                  <Bar
                    dataKey="value"
                    name="Revenue"
                    fill="hsl(var(--chart-1))"
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Year-by-year revenue bridge: actuals → analyst estimates → model,
              with a source badge and YoY growth on every row. */}
          {bridge && bridge.status === "available" && bridge.years.length > 0 ? (
            <div className="space-y-1" data-testid="revenue-bridge">
              <RevenueSectionHeader
                title="Year-by-year bridge"
                hint="Actuals → estimates → model"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-medium py-1 pr-2">Year</th>
                      <th className="text-right font-medium py-1 pr-2">Revenue</th>
                      <th className="text-right font-medium py-1 pr-2">YoY</th>
                      <th className="text-right font-medium py-1">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bridge.years.map((y, i) => (
                      <tr
                        key={`${y.fy}-${y.source}-${i}`}
                        className="border-t border-border/50"
                        data-testid={`bridge-row-${y.fy}-${i}`}
                      >
                        <td className="py-1 pr-2 text-foreground/90">{y.label}</td>
                        <td className="py-1 pr-2 text-right font-medium text-foreground tabular-nums">
                          {y.value != null ? fmtCompactCurrency(y.value, currency) : "—"}
                        </td>
                        <td
                          className={`py-1 pr-2 text-right tabular-nums ${y.growthPct != null ? perfTone(y.growthPct) : "text-muted-foreground"}`}
                        >
                          {y.growthPct != null ? fmtPct(y.growthPct, 0, true) : "—"}
                        </td>
                        <td className="py-1 text-right">
                          <BridgeSourceBadge
                            source={y.source}
                            analystCount={y.analystCount}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {bridge.modelNote && (
                <p className="text-[10px] text-muted-foreground italic" data-testid="bridge-model-note">
                  {bridge.modelNote}
                </p>
              )}
            </div>
          ) : (
            <div
              className="rounded border border-dashed border-border/60 bg-background/30 px-3 py-2 text-[11px] text-muted-foreground"
              data-testid="revenue-bridge-unavailable"
            >
              <span className="font-semibold text-foreground/90">Year-by-year bridge:</span>{" "}
              {bridge?.note ??
                data?.projections?.note ??
                "Year-by-year revenue bridge unavailable with current data sources."}
            </div>
          )}

          {/* Quarterly detail (reported) — kept inside the history card. */}
          {quarterly.length > 0 && (
            <details className="group" data-testid="revenue-quarterly">
              <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground">
                Quarterly detail
              </summary>
              <div className="overflow-x-auto pt-1" data-testid="revenue-table">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left font-medium py-1 pr-2">Quarter</th>
                      <th className="text-right font-medium py-1">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...quarterly].reverse().map((p) => (
                      <tr
                        key={p.end}
                        className="border-t border-border/50"
                        data-testid={`revenue-row-${p.end}`}
                      >
                        <td className="py-1 pr-2 text-foreground/90">{p.label}</td>
                        <td className="py-1 text-right font-medium text-foreground tabular-nums">
                          {fmtCompactCurrency(p.value, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          </div>
          {/* end Where-growth-came-from card */}

          {/* ── Where growth is going · next 3–5 years ──────────────────
              Forward Bear/Base/Bull year-by-year revenue bridge with per-year
              source badges and client-side tweakable growth assumptions
              (segment sliders when real segment data exists, else a single
              total-revenue slider). Reuses the scenario model + revenue bridge
              + segments already on the page — no new compute or API calls.
              Falls back to a truthful unavailable note when no scenario or
              revenue anchor resolved. */}
          <div
            className="rounded-md border border-border/60 bg-background/30 p-3 space-y-2"
            data-testid="revenue-forward-card"
          >
            {scenarioModel && data ? (
              <ForwardGrowthScenario
                model={scenarioModel}
                revenue={data}
                segments={segments}
                currency={currency}
              />
            ) : (
              <>
                <RevenueSectionHeader
                  title="Where growth is going · next 3–5 years"
                  right={<ForwardSourceBadge source="unavailable" />}
                />
                <p className="text-[11px] text-muted-foreground">
                  A forward Bear/Base/Bull revenue scenario is unavailable for
                  this ticker — the scenario model has not resolved (no analyst
                  estimates or sufficient fundamentals).
                </p>
              </>
            )}
          </div>

          {/* Segment breakdown — real per-segment revenue / operating income
              extracted from the issuer's 10-K XBRL segment axis (Hybrid-artifact
              table). Falls back to a polished unavailable state for
              ETFs/funds/foreign/single-segment issuers. No fabricated data. */}
          <div
            className="rounded-md border border-border/60 bg-background/30 p-3"
            data-testid="revenue-segments-card"
          >
            <SegmentBreakdown ticker={ticker} currency={currency} />
          </div>
        </div>
      )}

      {available && (
        <p className="text-[10px] text-muted-foreground" data-testid="revenue-source-note">
          {data?.note} {data?.entityName ? `· ${data.entityName}` : ""}
        </p>
      )}
    </div>
  );
}

// Revenue rendered as a default-collapsed accordion row matching the signal
// stack. Owns its own open state; expands only on user click/tap. Preserves all
// revenue content (TTM, annual bar chart, quarterly table, projections).
function RevenueSection({
  ticker,
  keyMetrics,
  scenarioModel,
}: {
  ticker: string;
  keyMetrics?: ConvictionIdea["keyMetrics"] | null;
  scenarioModel?: ScenarioModel | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SignalSection
      icon={DollarSign}
      title="Revenue Intelligence"
      testId="signal-row-revenue"
      open={open}
      onToggle={() => setOpen((o) => !o)}
      headline={<RevenueHeadline ticker={ticker} />}
    >
      <RevenuePanel
        ticker={ticker}
        keyMetrics={keyMetrics}
        scenarioModel={scenarioModel}
      />
    </SignalSection>
  );
}

function ScenarioCard({ model }: { model: ScenarioModel }) {
  const km = (c: ScenarioModel["bear"]) => c.outputs;
  const cases = [
    { c: model.bear, color: "text-neg" },
    { c: model.base, color: "text-foreground" },
    { c: model.bull, color: "text-pos" },
  ];
  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="idea-scenario-card"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Target className="h-3.5 w-3.5 text-primary/80" aria-hidden />
          Scenario model ({model.horizonYears}y, {model.classification})
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {cases.map(({ c, color }) => (
          <div
            key={c.key}
            className="rounded border border-border/60 bg-background/40 px-2 py-2 text-center"
            data-testid={`scenario-case-${c.key}`}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
            <div className={`text-sm font-semibold ${color}`}>
              {fmtPct(km(c).impliedReturnPct, 0)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {km(c).targetPrice != null
                ? fmtPrice(km(c).targetPrice)
                : `${km(c).targetMultipleOfCurrent}×`}
            </div>
          </div>
        ))}
      </div>
      {model.modelWarnings.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {model.modelWarnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500/80" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      <ScenarioDerivation
        method={model.method}
        coverage={model.coverageConfidence}
        methodology={model.methodology}
        horizonYears={model.horizonYears}
        inputs={model.derivationInputs}
        missingInputs={model.missingInputs}
        bull={model.bull.derivation}
        base={model.base.derivation}
        bear={model.bear.derivation}
        analystEstimates={model.analystEstimates}
      />
      <p className="text-[10px] text-muted-foreground italic">{model.disclaimer}</p>
    </div>
  );
}

function ChecklistRow({
  label,
  score,
  note,
}: {
  label: string;
  score: number;
  note: string;
}) {
  const tone =
    score >= 70 ? "bg-pos" : score >= 45 ? "bg-amber-500" : "bg-neg";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{score}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{note}</p>
    </div>
  );
}

// Lightweight, derived-only badges for a watchlist ticker row. Everything here
// comes from already-loaded idea fields (custom flag, review status, and the
// short-term performance already attached to keyMetrics), so rendering a row
// never triggers a per-ticker provider call.
function RowBadges({ idea }: { idea: ConvictionIdea }) {
  const change1d = idea.keyMetrics?.performance?.change1dPct;
  const hasPerf = change1d != null && Number.isFinite(change1d);
  return (
    <div className="flex items-center gap-1 shrink-0" data-testid={`row-badges-${idea.id}`}>
      {idea.custom && (
        <span
          className="rounded-sm bg-amber-500/15 text-amber-500 px-1 py-px text-[9px] font-semibold uppercase tracking-wide"
          title="Custom idea you added"
          data-testid={`row-badge-custom-${idea.id}`}
        >
          Custom
        </span>
      )}
      {idea.reviewStatus === "needs-review" && (
        <span
          className="rounded-sm bg-amber-500/15 text-amber-500 px-1 py-px text-[9px] font-semibold uppercase tracking-wide"
          title="Flagged for review"
          data-testid={`row-badge-review-${idea.id}`}
        >
          Review
        </span>
      )}
      {hasPerf ? (
        <span
          className={`inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums ${perfTone(change1d)}`}
          title="Day-over-day change (today vs prior close)"
          data-testid={`row-perf-${idea.id}`}
        >
          {(change1d as number) >= 0 ? (
            <TrendingUp className="h-3 w-3" aria-hidden />
          ) : (
            <TrendingDown className="h-3 w-3" aria-hidden />
          )}
          {fmtPct(change1d, 1)}
          <span className="text-[8px] uppercase tracking-wide text-muted-foreground">
            1D
          </span>
        </span>
      ) : (
        <span
          className="text-[9px] uppercase tracking-wide text-muted-foreground"
          title="Day-over-day change unavailable"
          data-testid={`row-perf-pending-${idea.id}`}
        >
          1D —
        </span>
      )}
    </div>
  );
}

// A single ticker row in the grouped watchlist. Shows symbol, short name and
// the derived badges; clicking selects it and drives the detail pane.
function TickerRow({
  idea,
  selectedId,
  onSelect,
}: {
  idea: ConvictionIdea;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const active = idea.id === selectedId;
  return (
    <li>
      <button
        type="button"
        data-testid={`watchlist-row-${idea.id}`}
        data-selected={active ? "true" : "false"}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(idea.id)}
        className={`w-full text-left rounded-md border px-2.5 py-1.5 transition-colors ${
          active
            ? "border-primary bg-primary/10"
            : "border-transparent hover:bg-muted/60"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm text-foreground shrink-0">
            {idea.ticker}
          </span>
          <RowBadges idea={idea} />
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {idea.companyName}
        </div>
      </button>
    </li>
  );
}

// A collapsible section group inside the grouped watchlist. Renders a heading
// with the section label, a count, and a chevron toggle, then the ticker rows.
// Collapse state is owned by the parent (React state only; not persisted).
function WatchlistGroup({
  groupKey,
  label,
  icon: Icon,
  ideas,
  roles,
  collapsed,
  onToggle,
  selectedId,
  onSelect,
}: {
  groupKey: string;
  label: string;
  icon: typeof Anchor;
  ideas: ConvictionIdea[];
  roles: ConvictionRoleInfo[];
  collapsed: boolean;
  onToggle: (key: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const roleOrder = roles.map((r) => r.key);
  const sorted = [...ideas].sort(
    (a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role),
  );
  const regionId = `watchlist-group-body-${groupKey}`;
  return (
    <div data-testid={`watchlist-group-${groupKey}`} className="space-y-1">
      <button
        type="button"
        onClick={() => onToggle(groupKey)}
        aria-expanded={!collapsed}
        aria-controls={regionId}
        data-testid={`watchlist-group-toggle-${groupKey}`}
        className="w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate flex-1 min-w-0">
          {label}
        </span>
        <span
          className="text-[10px] text-muted-foreground shrink-0 tabular-nums"
          data-testid={`watchlist-group-count-${groupKey}`}
        >
          {ideas.length}
        </span>
      </button>
      {!collapsed && (
        <ul className="space-y-0.5 pl-1" id={regionId} data-testid={`watchlist-group-list-${groupKey}`}>
          {sorted.map((idea) => (
            <TickerRow
              key={idea.id}
              idea={idea}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// A resolved group for the grouped watchlist: a thematic section (or "Other")
// with its label, icon and the ideas that fall under it after search/filter.
interface WatchlistGroupData {
  key: string;
  label: string;
  icon: typeof Anchor;
  ideas: ConvictionIdea[];
}

// The six expandable signal rows for the selected ticker. Each row reads the
// same shared per-ticker query cache as its headline (no duplicate fetches) and
// owns its own open/closed state. Model Action and Scenario default open; the
// rest start collapsed so the stack reads as a compact summary first.
type SignalRowKey =
  | "action"
  | "quant"
  | "scenario"
  | "buffett"
  | "analyst"
  | "backtest";

// Quant Score body — pulls the quant block out of the shared action-signal
// payload so it can live in its own row without re-fetching.
function QuantScoreRowBody({ ticker }: { ticker: string }) {
  const { data, isLoading, isError } = useIdeaActionSignal(ticker);
  if (isLoading) {
    return (
      <Skeleton className="h-[160px] rounded-md" data-testid="quant-score-row-loading" />
    );
  }
  if (isError || !data || !data.quantScore) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="quant-score-row-empty">
        Quant score unavailable for this ticker.
      </p>
    );
  }
  return <QuantScoreBlock q={data.quantScore} />;
}

function SignalStack({ idea }: { idea: ConvictionIdea }) {
  const [open, setOpen] = useState<Record<SignalRowKey, boolean>>({
    action: false,
    quant: false,
    scenario: false,
    buffett: false,
    analyst: false,
    backtest: false,
  });
  const toggle = (key: SignalRowKey) =>
    setOpen((o) => ({ ...o, [key]: !o[key] }));

  const ticker = idea.ticker;

  return (
    <div className="space-y-2" data-testid="idea-signal-stack">
      {/* Model Action — the single consolidated final-decision row. Folds the
          legacy buy/sell timing signal and the risk read into its body via the
          panel's `supporting` slot so there are no competing action rows. */}
      <SignalSection
        icon={Sparkles}
        title="Model Action"
        testId="signal-row-action"
        open={open.action}
        onToggle={() => toggle("action")}
        headline={<ModelActionHeadline ticker={ticker} />}
      >
        <ActionSignalPanel
          ticker={ticker}
          headless
          include={{ quantScore: false, conviction: false, backtest: false }}
          supporting={
            <div className="space-y-3 pt-1">
              <SignalConvictionPanel ticker={ticker} headless />
              <RiskConvictionPanel ticker={ticker} headless />
            </div>
          }
        />
      </SignalSection>

      {/* Quant Score — score + band, factor breakdown in the body. */}
      <SignalSection
        icon={Gauge}
        title="Quant Score"
        testId="signal-row-quant"
        open={open.quant}
        onToggle={() => toggle("quant")}
        headline={<QuantScoreHeadline ticker={ticker} />}
      >
        <QuantScoreRowBody ticker={ticker} />
      </SignalSection>

      {/* Scenario upside / downside — bear/base/bull plus the full "How this
          was derived" derivation UI inside the body. */}
      <SignalSection
        icon={Target}
        title="Scenario Upside / Downside"
        testId="signal-row-scenario"
        open={open.scenario}
        onToggle={() => toggle("scenario")}
        headline={<ScenarioHeadline model={idea.scenarioModel} />}
      >
        {idea.scenarioModel ? (
          <ScenarioCard model={idea.scenarioModel} />
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="idea-scenario-card"
          >
            Scenario model unavailable for this idea.
          </p>
        )}
      </SignalSection>

      {/* Buffett quality check — kept as a separate quality lens, not a trading
          signal. */}
      <SignalSection
        icon={Building2}
        title="Buffett Quality Check"
        testId="signal-row-buffett"
        open={open.buffett}
        onToggle={() => toggle("buffett")}
        headline={<BuffettHeadline ticker={ticker} />}
      >
        <BuffettConvictionPanel ticker={ticker} headless />
      </SignalSection>

      {/* Analyst consensus (Finnhub). */}
      <SignalSection
        icon={Users}
        title="Analyst Consensus"
        testId="signal-row-analyst"
        open={open.analyst}
        onToggle={() => toggle("analyst")}
        headline={<AnalystHeadline ticker={ticker} />}
      >
        <AnalystConsensusPanel ticker={ticker} headless />
      </SignalSection>

      {/* Backtest evidence — universe-wide technical-only validation. */}
      <SignalSection
        icon={Beaker}
        title="Backtest Evidence"
        testId="signal-row-backtest"
        open={open.backtest}
        onToggle={() => toggle("backtest")}
        headline={<BacktestHeadline />}
      >
        <QuantBacktestPanel headless />
      </SignalSection>
    </div>
  );
}

function IdeaDetail({
  idea,
  onRemove,
}: {
  idea: ConvictionIdea;
  onRemove: () => void;
}) {
  const km = idea.keyMetrics;
  const perf = km?.performance ?? null;

  // Derive a one-day change from the chart series so the top snapshot can show
  // a daily move. Fetches the default (1Y) range — the last two closes give the
  // daily move regardless of the range the user later picks in ConvictionChart.
  const chartQuery = useQuery<ConvictionChartResponse>({
    queryKey: ["/api/conviction-ideas/chart", idea.ticker],
    enabled: !!idea.ticker,
  });
  const pts = chartQuery.data?.points ?? [];
  const last = pts.length ? pts[pts.length - 1] : null;
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const dailyChangePct =
    last && prev && prev.c ? ((last.c - prev.c) / prev.c) * 100 : null;
  const chartCurrency = chartQuery.data?.currency ?? km?.priceCurrency ?? "USD";

  return (
    <div className="space-y-4" data-testid="idea-detail">
      {/* Ticker snapshot — symbol, name, live price + daily change, status
          badges and a compact quick-stats strip. Kept at the very top so the
          market context for the clicked ticker is the first thing visible. */}
      <div
        className="rounded-md border border-border/70 bg-card/40 p-4 space-y-3"
        data-testid="idea-snapshot"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2
              className="text-xl font-bold text-foreground"
              data-testid="idea-title"
            >
              {idea.ticker}
            </h2>
            <p className="text-sm text-muted-foreground">{idea.companyName}</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right" data-testid="snapshot-price">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Price
              </div>
              <div className="text-xl font-bold text-foreground">
                {km?.price != null
                  ? fmtPrice(km.price, km.priceCurrency ?? chartCurrency)
                  : "N/A"}
              </div>
              {dailyChangePct != null && (
                <div
                  className={`text-[11px] font-medium ${perfTone(dailyChangePct)}`}
                  data-testid="snapshot-daily-change"
                >
                  {dailyChangePct >= 0 ? "+" : ""}
                  {dailyChangePct.toFixed(2)}% 1d
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-neg"
              onClick={onRemove}
              aria-label={`Remove ${idea.ticker}`}
              data-testid="button-remove-idea"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {idea.custom && (
            <span
              className="rounded-full bg-amber-500/15 text-amber-500 px-2 py-0.5"
              data-testid="idea-custom-badge"
            >
              Custom
            </span>
          )}
          {idea.thesisPending && (
            <span
              className="rounded-full bg-sky-500/15 text-sky-500 px-2 py-0.5 font-medium"
              data-testid="idea-thesis-pending-badge"
            >
              Thesis pending
            </span>
          )}
          {idea.sectionLabel && (
            <span
              className="rounded-full bg-primary/15 text-primary px-2 py-0.5 font-medium"
              data-testid="idea-section-badge"
            >
              {idea.sectionLabel}
            </span>
          )}
          <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5">
            {idea.roleLabel}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/80">
            {idea.targetOutcome}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/80">
            {idea.timeHorizon}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/80">
            {REVIEW_LABEL[idea.reviewStatus] ?? idea.reviewStatus}
          </span>
        </div>
        {idea.themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {idea.themes.map((t) => (
              <span
                key={t}
                className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Quick stats strip — the most-glanced numbers, kept in the snapshot
            so the market read is immediate. Each value degrades to "N/A". */}
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2"
          data-testid="idea-quick-stats"
        >
          <MetricCard
            label="Price"
            value={km?.price != null ? fmtPrice(km.price, km.priceCurrency ?? chartCurrency) : "N/A"}
            testId="metric-price"
          />
          <MetricCard
            label="Market cap"
            value={km?.marketCap != null ? fmtCompactCurrency(km.marketCap) : "N/A"}
            testId="metric-marketcap"
          />
          <MetricCard
            label="P/E (TTM)"
            value={km?.peRatio != null ? km.peRatio.toFixed(1) : "N/A"}
            testId="metric-pe"
          />
          <MetricCard
            label="1m return"
            value={fmtPct(perf?.change1mPct, 1)}
            tone={perfTone(perf?.change1mPct)}
            testId="metric-perf1m"
          />
          <MetricCard
            label="6m return"
            value={fmtPct(perf?.change6mPct, 1)}
            tone={perfTone(perf?.change6mPct)}
            testId="metric-perf6m"
          />
          <MetricCard
            label="12m return"
            value={fmtPct(perf?.change12mPct, 1)}
            tone={perfTone(perf?.change12mPct)}
            testId="metric-perf12m"
          />
          <MetricCard
            label="Base upside"
            value={
              idea.scenarioModel?.base.outputs.impliedReturnPct != null
                ? fmtPct(idea.scenarioModel.base.outputs.impliedReturnPct, 0)
                : "N/A"
            }
            tone={perfTone(idea.scenarioModel?.base.outputs.impliedReturnPct)}
            testId="metric-base-upside"
          />
        </div>

        {km?.metricWarnings && km.metricWarnings.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-muted-foreground" data-testid="idea-metric-warnings">
            {km.metricWarnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500/80" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Deterministic research narrative — model's read on the ticker, rendered
          from already-loaded idea data (no network) so it appears instantly on
          click, between the snapshot and the chart/accordion stack. */}
      <TickerNarrative idea={idea} />

      {/* Chart-first market section — price + moving averages with breakout
          status/markers, placed immediately under the snapshot so the graph
          and breakout read are visible before any thesis text. */}
      <div data-testid="idea-chart-first" className="space-y-4">
        <ConvictionChart ticker={idea.ticker} />
      </div>

      {/* Collapsible signal stack — one accordion row per lens, each with an
          at-a-glance headline and an expandable body. All rows default collapsed;
          they expand only on user click/tap. */}
      <SignalStack idea={idea} />

      {/* Revenue / fundamentals (current + historical from SEC EDGAR) — a
          default-collapsed accordion row; expands only on user click/tap. */}
      <RevenueSection
        ticker={idea.ticker}
        keyMetrics={idea.keyMetrics}
        scenarioModel={idea.scenarioModel}
      />

      {/* Thesis / what must be true. For freshly added custom tickers with no
          authored research yet, show a clear pending state instead. */}
      {idea.thesisPending ? (
        <div
          className="rounded-md border border-dashed border-sky-500/40 bg-sky-500/5 p-4 space-y-1.5"
          data-testid="idea-thesis-pending"
        >
          <div className="flex items-center gap-1.5 text-sm font-semibold text-sky-500">
            <Target className="h-4 w-4" aria-hidden />
            Thesis pending
          </div>
          <p className="text-xs text-muted-foreground">
            Market data, chart, action signal and analyst consensus load
            automatically for this ticker. An auto-generated thesis — with
            catalysts, risks and kill criteria — can be added later.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BulletSection
              heading="Thesis"
              icon={Target}
              items={idea.thesis}
              testId="idea-thesis"
            />
            <BulletSection
              heading="What must be true"
              icon={CheckCircle2}
              items={idea.whatMustBeTrue}
              testId="idea-whatmustbetrue"
            />
            <BulletSection
              heading="Catalysts"
              icon={Sparkles}
              items={idea.catalysts}
              testId="idea-catalysts"
            />
            <BulletSection
              heading="Risks"
              icon={ShieldAlert}
              items={idea.risks}
              testId="idea-risks"
              tone="text-amber-500/90"
            />
          </div>

          {/* Kill criteria */}
          <BulletSection
            heading="Kill criteria (what removes it)"
            icon={AlertTriangle}
            items={idea.killCriteria}
            testId="idea-killcriteria"
            tone="text-neg"
          />
        </>
      )}

      {/* Guardrails */}
      <div
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        data-testid="idea-guardrails"
      >
        <div className="rounded-md border border-border/70 bg-card/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Downside guardrail
          </div>
          <p className="text-xs text-foreground/90 mt-0.5">
            {idea.downsideGuardrail}
          </p>
        </div>
        <div className="rounded-md border border-border/70 bg-card/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Position sizing (educational)
          </div>
          <div className="text-sm font-semibold text-foreground mt-0.5">
            {SIZING_LABEL[idea.positionSizingBand] ?? idea.positionSizingBand}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {idea.positionSizingNote}
          </p>
        </div>
        <div className="rounded-md border border-border/70 bg-card/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Review cadence
          </div>
          <p className="text-xs text-foreground/90 mt-0.5">
            {idea.reviewFrequency}
          </p>
        </div>
      </div>

      {/* Evidence checklist */}
      <div
        className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
        data-testid="idea-checklist"
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5 text-primary/80" aria-hidden />
          Evidence checklist (qualitative self-assessment)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {idea.checklist.map((item) => (
            <ChecklistRow
              key={item.key}
              label={item.label}
              score={item.score}
              note={item.note}
            />
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        {idea.sourceNote}
      </p>
    </div>
  );
}

const ROLE_OPTIONS: { value: ConvictionRole; label: string }[] = [
  { value: "core-compounder", label: "Core compounder" },
  { value: "asymmetric-candidate", label: "Asymmetric 2x/3x" },
  { value: "high-variance-optionality", label: "High-variance optionality" },
];

const emptyForm = {
  ticker: "",
  companyName: "",
  theme: "",
  role: "asymmetric-candidate" as ConvictionRole,
  convictionScore: "50",
};

// Sentinels for the Theme/grouping dropdown: no group, or create a new one.
const THEME_NONE = "__none__";
const THEME_NEW = "__new__";

function AddIdeaDialog({
  open,
  onOpenChange,
  onAdded,
  groupNames,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: (data: ConvictionIdeasResponse, ticker: string) => void;
  // Existing watchlist group names (section labels) to offer in the dropdown.
  groupNames: string[];
}) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  // When the user picks "New group…", we show an inline text input and track
  // its value here; otherwise `form.theme` holds the chosen existing group.
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const { toast } = useToast();

  // Reset the create-group sub-state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setCreatingGroup(false);
      setNewGroup("");
    }
  }, [open]);

  // The effective theme/group string sent to the server: the inline new-group
  // name when creating, otherwise the selected existing group (blank = none).
  const effectiveTheme = creatingGroup ? newGroup.trim() : form.theme.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Only the ticker is required. Name, theme/grouping, role and conviction
    // are all optional — the server infers the display name from market data
    // (falling back to the ticker), slots the idea into a default grouping, and
    // its market/pricing/fundamental data loads automatically. The thesis and
    // other fields can be auto-updated later by the agent.
    if (!form.ticker.trim()) {
      toast({
        title: "Ticker is required",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/conviction-ideas", {
        ticker: form.ticker.trim(),
        companyName: form.companyName.trim() || undefined,
        theme: effectiveTheme || undefined,
        role: form.role,
        convictionScore: Number(form.convictionScore) || 50,
      });
      const data = (await res.json()) as ConvictionIdeasResponse;
      const ticker = form.ticker.trim().toUpperCase();
      onAdded(data, ticker);
      toast({ title: `Added ${ticker}` });
      setForm(emptyForm);
      setCreatingGroup(false);
      setNewGroup("");
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to add idea",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-idea">
        <DialogHeader>
          <DialogTitle>Add to watchlist</DialogTitle>
          <DialogDescription data-testid="add-idea-explainer">
            Only the ticker is required. Market data loads automatically; thesis
            and additional fields can be auto-updated later. Name, theme and role
            are all optional — leave them blank and the name is inferred from
            market data (falling back to the ticker).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="idea-ticker" className="text-xs">
                Ticker
              </Label>
              <Input
                id="idea-ticker"
                value={form.ticker}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))
                }
                placeholder="e.g. ASML, RKLB"
                className="mono mt-1"
                data-testid="input-idea-ticker"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="idea-name" className="text-xs">
                Company / fund name{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="idea-name"
                value={form.companyName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, companyName: e.target.value }))
                }
                placeholder="Auto-filled from market data"
                className="mt-1"
                data-testid="input-idea-name"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="idea-theme" className="text-xs">
              Theme / grouping <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={
                creatingGroup
                  ? THEME_NEW
                  : form.theme.trim()
                    ? form.theme
                    : THEME_NONE
              }
              onValueChange={(v) => {
                if (v === THEME_NEW) {
                  setCreatingGroup(true);
                  setForm((f) => ({ ...f, theme: "" }));
                } else if (v === THEME_NONE) {
                  setCreatingGroup(false);
                  setNewGroup("");
                  setForm((f) => ({ ...f, theme: "" }));
                } else {
                  setCreatingGroup(false);
                  setNewGroup("");
                  setForm((f) => ({ ...f, theme: v }));
                }
              }}
            >
              <SelectTrigger className="mt-1" data-testid="select-idea-theme">
                <SelectValue placeholder="No group (default)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={THEME_NONE}>No group (default)</SelectItem>
                {groupNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
                <SelectItem value={THEME_NEW}>+ New group…</SelectItem>
              </SelectContent>
            </Select>
            {creatingGroup && (
              <Input
                id="idea-theme"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="New group name (e.g. Semiconductors / AI capex)"
                className="mt-2"
                data-testid="input-idea-theme"
                autoFocus
              />
            )}
          </div>

          <div>
            <Label className="text-xs">Role</Label>
            <Select
              value={form.role}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, role: v as ConvictionRole }))
              }
            >
              <SelectTrigger className="mt-1" data-testid="select-idea-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-idea"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              data-testid="button-submit-idea"
            >
              {submitting ? "Adding…" : "Add idea"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Top-of-watchlist filter scopes. The default is the grouped "All" view; the
// other two narrow the whole watchlist to a cross-cutting slice while keeping
// the section grouping intact.
type WatchlistFilter = "all" | "needs-review" | "custom";

const WATCHLIST_FILTERS: { key: WatchlistFilter; label: string; icon: typeof Anchor }[] = [
  { key: "all", label: "All", icon: LayoutGrid },
  { key: "needs-review", label: "Needs Review", icon: Eye },
  { key: "custom", label: "Custom", icon: Plus },
];

const SECTION_ICON: Record<string, typeof Anchor> = {
  bravos: Star,
  "core-ai-compounders": Anchor,
  "semiconductors-ai-hardware": Cpu,
  "speculative-ai-infra": Sparkles,
  "ai-power-grid": Rocket,
  "ai-software-data": LayoutGrid,
  "frontier-high-upside": Target,
  other: ListChecks,
};

// =============================================================================
// Bottom summary grid — a sortable, full-watchlist table across all visible
// ideas. Base columns (ticker / name / section / price / 1M / 6M / revenue
// growth / status) come straight from the already-loaded idea keyMetrics, so
// the table renders instantly with no extra provider calls. The enriched
// columns (signal / confidence / risk / Buffett score / breakout) are fetched
// lazily and only when the user opts in, capped to a reasonable subset to avoid
// fanning out 40+ requests at once. Already-viewed tickers fill in from cache.
// =============================================================================

const RISK_TONE: Record<DerivedRiskLevel, string> = {
  Low: "text-pos",
  Moderate: "text-primary",
  Elevated: "text-amber-500",
  High: "text-neg",
  Unknown: "text-muted-foreground",
};

const SIGNAL_TONE: Record<string, string> = {
  "Strong Buy": "text-pos",
  Buy: "text-pos",
  Watch: "text-primary",
  Hold: "text-muted-foreground",
  Trim: "text-amber-500",
  Sell: "text-neg",
  "Invalid Setup": "text-neg",
};

// Max number of visible rows we will auto-enrich when the user turns on
// signals/scores, to keep the provider fan-out bounded.
const ENRICH_CAP = 25;

type SortKey =
  | "ticker"
  | "name"
  | "section"
  | "price"
  | "perf1m"
  | "perf6m"
  | "breakout"
  | "action"
  | "signal"
  | "confidence"
  | "risk"
  | "buffett"
  | "analyst"
  | "revGrowth"
  | "status";

interface EnrichedRow {
  actionLabel: string | null;
  actionScore: number | null;
  signalLabel: string | null;
  confidence: number | null;
  riskLevel: DerivedRiskLevel;
  riskScore: number | null;
  buffettScore: number | null;
  analystLabel: string | null;
  breakout: string | null;
  loading: boolean;
}

const ACTION_TONE: Record<string, string> = {
  Add: "text-pos",
  Starter: "text-pos",
  Hold: "text-primary",
  Watch: "text-muted-foreground",
  Trim: "text-amber-500",
  Avoid: "text-neg",
};

const ANALYST_TONE: Record<string, string> = {
  "Strong Buy": "text-pos",
  Buy: "text-pos",
  Hold: "text-primary",
  Sell: "text-amber-500",
  "Strong Sell": "text-neg",
};

// A single enriched row. Uses the shared per-ticker query hooks so the cells
// reuse the same cache as the detail pane. `enabled` gates the network call.
function useEnrichedRow(ticker: string, enabled: boolean): EnrichedRow {
  const signalQ = useIdeaSignal(enabled ? ticker : null);
  const buffettQ = useIdeaBuffett(enabled ? ticker : null);
  // The action-signal endpoint already folds in the analyst consensus, so a
  // single fetch backs both the Action and Analyst columns.
  const actionQ = useIdeaActionSignal(enabled ? ticker : null);
  const chartQ = useQuery<ConvictionChartResponse>({
    queryKey: ["/api/conviction-ideas/chart", ticker],
    enabled: enabled && !!ticker,
  });

  const signal = signalQ.data;
  const buffett = buffettQ.data;
  const action = actionQ.data;
  const risk = deriveRisk(signal);
  const breakoutStatus = chartQ.data?.breakout?.status;
  const breakout =
    breakoutStatus == null || breakoutStatus === "unavailable"
      ? null
      : breakoutStatus === "none"
        ? "None"
        : breakoutStatus === "breakout"
          ? "Breakout"
          : "Recent";

  return {
    actionLabel: action?.action ?? null,
    actionScore: action ? action.compositeScore : null,
    signalLabel: signal?.signal ?? null,
    confidence: signal ? Math.round(signal.compositeScore) : null,
    riskLevel: risk.level,
    riskScore: risk.riskScore,
    buffettScore: buffettScoreIsMeaningful(buffett)
      ? (buffett?.overallScore ?? null)
      : null,
    analystLabel:
      action?.analystConsensus?.status === "available"
        ? action.analystConsensus.consensusLabel ?? null
        : null,
    breakout,
    loading:
      enabled &&
      (signalQ.isLoading || buffettQ.isLoading || actionQ.isLoading || chartQ.isLoading),
  };
}

function SummaryRow({
  idea,
  enrich,
  selected,
  onSelect,
}: {
  idea: ConvictionIdea;
  enrich: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const km = idea.keyMetrics;
  const perf = km?.performance ?? null;
  const row = useEnrichedRow(idea.ticker, enrich);
  const buffettMeaningful = row.buffettScore != null;

  const cell = (v: string | number | null | undefined, tone?: string) => (
    <td className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${tone ?? ""}`}>
      {v == null || v === "" ? "—" : v}
    </td>
  );

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      data-testid={`summary-row-${idea.id}`}
      onClick={() => onSelect(idea.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(idea.id);
        }
      }}
      className={`border-t border-border/50 cursor-pointer transition-colors ${
        selected ? "bg-primary/10" : "hover:bg-muted/50"
      }`}
    >
      <td className="px-2 py-1.5 font-semibold text-foreground whitespace-nowrap sticky left-0 z-10 bg-inherit">
        {idea.ticker}
      </td>
      <td className="px-2 py-1.5 text-foreground/80 max-w-[180px] truncate">
        {idea.companyName}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
        {idea.sectionLabel ?? idea.sectionKey ?? "—"}
      </td>
      {cell(
        km?.price != null ? fmtPrice(km.price, km.priceCurrency ?? "USD") : null,
      )}
      {cell(fmtPct(perf?.change1mPct, 1), perfTone(perf?.change1mPct))}
      {cell(fmtPct(perf?.change6mPct, 1), perfTone(perf?.change6mPct))}
      {/* Enriched columns */}
      {cell(
        enrich ? (row.loading ? "…" : row.breakout) : "·",
        row.breakout === "Breakout"
          ? "text-pos"
          : row.breakout === "Recent"
            ? "text-amber-500"
            : "text-muted-foreground",
      )}
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        {!enrich ? (
          <span className="text-muted-foreground">·</span>
        ) : row.loading ? (
          "…"
        ) : row.actionLabel ? (
          <span
            className={`font-medium ${ACTION_TONE[row.actionLabel] ?? "text-foreground"}`}
            data-testid={`summary-action-${idea.id}`}
          >
            {row.actionLabel}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        {!enrich ? (
          <span className="text-muted-foreground">·</span>
        ) : row.loading ? (
          "…"
        ) : row.signalLabel ? (
          <span
            className={`font-medium ${SIGNAL_TONE[row.signalLabel] ?? "text-foreground"}`}
            data-testid={`summary-signal-${idea.id}`}
          >
            {row.signalLabel}
          </span>
        ) : (
          "—"
        )}
      </td>
      {cell(
        enrich ? (row.loading ? "…" : row.confidence != null ? `${row.confidence}%` : null) : "·",
      )}
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        {!enrich ? (
          <span className="text-muted-foreground">·</span>
        ) : row.loading ? (
          "…"
        ) : (
          <span
            className={`font-medium ${RISK_TONE[row.riskLevel]}`}
            data-testid={`summary-risk-${idea.id}`}
          >
            {row.riskLevel}
          </span>
        )}
      </td>
      {cell(
        enrich
          ? row.loading
            ? "…"
            : buffettMeaningful
              ? (row.buffettScore as number).toFixed(0)
              : "N/A"
          : "·",
        buffettMeaningful ? scoreToneClass(row.buffettScore) : "text-muted-foreground",
      )}
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        {!enrich ? (
          <span className="text-muted-foreground">·</span>
        ) : row.loading ? (
          "…"
        ) : row.analystLabel ? (
          <span
            className={`font-medium ${ANALYST_TONE[row.analystLabel] ?? "text-foreground"}`}
            data-testid={`summary-analyst-${idea.id}`}
          >
            {row.analystLabel}
          </span>
        ) : (
          <span className="text-muted-foreground">N/A</span>
        )}
      </td>
      {cell(fmtPct(km?.revenueGrowth, 1), perfTone(km?.revenueGrowth))}
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <span
          className={`text-[10px] uppercase tracking-wide ${
            idea.reviewStatus === "needs-review"
              ? "text-amber-500"
              : "text-muted-foreground"
          }`}
        >
          {REVIEW_LABEL[idea.reviewStatus] ?? idea.reviewStatus}
        </span>
      </td>
    </tr>
  );
}

function scoreToneClass(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-pos";
  if (score >= 45) return "text-amber-500";
  return "text-neg";
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-2 py-2 font-medium select-none ${align === "left" ? "text-left" : "text-right"}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        data-testid={`summary-sort-${sortKey}`}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          align === "left" ? "" : "flex-row-reverse"
        } ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" aria-hidden />
      </button>
    </th>
  );
}

export function WatchlistSummaryGrid({
  ideas,
  selectedId,
  onSelect,
}: {
  ideas: ConvictionIdea[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [enrich, setEnrich] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "ticker",
    dir: "asc",
  });

  const handleSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "ticker" || key === "name" || key === "section" ? "asc" : "desc" },
    );
  };

  // Base-data sort comparator. Enriched-only columns (signal/confidence/risk/
  // buffett/breakout) sort by their cached values when enrichment is on, else
  // they fall back to ticker order so headers stay clickable.
  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const num = (v: number | null | undefined) =>
      v == null || !Number.isFinite(v) ? -Infinity : v;
    const sec = (i: ConvictionIdea) => i.sectionLabel ?? i.sectionKey ?? "";
    return [...ideas].sort((a, b) => {
      switch (sort.key) {
        case "ticker":
          return a.ticker.localeCompare(b.ticker) * dir;
        case "name":
          return a.companyName.localeCompare(b.companyName) * dir;
        case "section":
          return sec(a).localeCompare(sec(b)) * dir || a.ticker.localeCompare(b.ticker);
        case "price":
          return (num(a.keyMetrics?.price) - num(b.keyMetrics?.price)) * dir;
        case "perf1m":
          return (
            (num(a.keyMetrics?.performance?.change1mPct) -
              num(b.keyMetrics?.performance?.change1mPct)) *
            dir
          );
        case "perf6m":
          return (
            (num(a.keyMetrics?.performance?.change6mPct) -
              num(b.keyMetrics?.performance?.change6mPct)) *
            dir
          );
        case "revGrowth":
          return (num(a.keyMetrics?.revenueGrowth) - num(b.keyMetrics?.revenueGrowth)) * dir;
        case "status":
          return (
            (a.reviewStatus === "needs-review" ? 1 : 0) -
            (b.reviewStatus === "needs-review" ? 1 : 0)
          ) * dir || a.ticker.localeCompare(b.ticker);
        default:
          // Enriched-only sorts read from the React Query cache directly so we
          // don't need to hoist 40 hook calls into this component.
          if (!enrich) return a.ticker.localeCompare(b.ticker);
          return enrichedSortValue(b, sort.key) - enrichedSortValue(a, sort.key) === 0
            ? a.ticker.localeCompare(b.ticker)
            : (enrichedSortValue(a, sort.key) - enrichedSortValue(b, sort.key)) * dir;
      }
    });
  }, [ideas, sort, enrich]);

  // When enrichment is on, cap how many rows actually fetch to avoid a large
  // provider fan-out. Rows beyond the cap show base data only.
  const enrichSet = useMemo(() => {
    if (!enrich) return new Set<string>();
    const ids = sorted.slice(0, ENRICH_CAP).map((i) => i.id);
    if (selectedId && !ids.includes(selectedId)) ids.push(selectedId);
    return new Set(ids);
  }, [enrich, sorted, selectedId]);

  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="watchlist-summary-grid"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Table2 className="h-3.5 w-3.5 text-primary/80" aria-hidden />
          Watchlist summary ({ideas.length})
        </div>
        <Button
          type="button"
          variant={enrich ? "secondary" : "outline"}
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setEnrich((v) => !v)}
          data-testid="button-enrich-summary"
          title={`Fetch action signal, analyst consensus, risk and Buffett scores for up to ${ENRICH_CAP} rows`}
        >
          {enrich ? "Hide signals & scores" : "Load signals & scores"}
        </Button>
      </div>

      <div className="overflow-x-auto -mx-1" data-testid="summary-table-scroll">
        <table className="w-full text-[11px] min-w-[1000px]" data-testid="summary-table">
          <thead>
            <tr className="text-muted-foreground">
              <SortHeader label="Ticker" sortKey="ticker" active={sort.key === "ticker"} dir={sort.dir} onSort={handleSort} align="left" />
              <SortHeader label="Name" sortKey="name" active={sort.key === "name"} dir={sort.dir} onSort={handleSort} align="left" />
              <SortHeader label="Section" sortKey="section" active={sort.key === "section"} dir={sort.dir} onSort={handleSort} align="left" />
              <SortHeader label="Price" sortKey="price" active={sort.key === "price"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="1M" sortKey="perf1m" active={sort.key === "perf1m"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="6M" sortKey="perf6m" active={sort.key === "perf6m"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Breakout" sortKey="breakout" active={sort.key === "breakout"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Action" sortKey="action" active={sort.key === "action"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Signal" sortKey="signal" active={sort.key === "signal"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Conf." sortKey="confidence" active={sort.key === "confidence"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Risk" sortKey="risk" active={sort.key === "risk"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Buffett" sortKey="buffett" active={sort.key === "buffett"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Analyst" sortKey="analyst" active={sort.key === "analyst"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Rev growth" sortKey="revGrowth" active={sort.key === "revGrowth"} dir={sort.dir} onSort={handleSort} />
              <SortHeader label="Status" sortKey="status" active={sort.key === "status"} dir={sort.dir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((idea) => (
              <SummaryRow
                key={idea.id}
                idea={idea}
                enrich={enrichSet.has(idea.id)}
                selected={idea.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Price, performance and revenue growth come from the loaded watchlist
        data. Action signal, analyst consensus, timing signal, confidence, risk
        and Buffett score are rules-based / research data and loaded on demand
        for up to {ENRICH_CAP} rows. Click any row to open it in the detail pane
        above.
      </p>
    </div>
  );
}

// Reads an enriched numeric sort value for a ticker straight from the React
// Query cache (already populated by visible enriched rows). Returns -Infinity
// when not yet cached so un-fetched rows sink to the bottom.
function enrichedSortValue(idea: ConvictionIdea, key: SortKey): number {
  const signal = queryClient.getQueryData<import("@shared/schema").ModelSignal>([
    "/api/conviction-ideas/signal",
    idea.ticker,
  ]);
  const buffett = queryClient.getQueryData<import("@shared/schema").BuffettIndex>([
    "/api/conviction-ideas/buffett",
    idea.ticker,
  ]);
  const chart = queryClient.getQueryData<ConvictionChartResponse>([
    "/api/conviction-ideas/chart",
    idea.ticker,
  ]);
  const action = queryClient.getQueryData<import("@shared/schema").ActionSignal>([
    "/api/conviction-ideas/action-signal",
    idea.ticker,
  ]);
  switch (key) {
    case "action": {
      const order: Record<string, number> = {
        Add: 6,
        Starter: 5,
        Hold: 4,
        Watch: 3,
        Trim: 2,
        Avoid: 1,
      };
      return action ? order[action.action] ?? -Infinity : -Infinity;
    }
    case "analyst": {
      const order: Record<string, number> = {
        "Strong Buy": 5,
        Buy: 4,
        Hold: 3,
        Sell: 2,
        "Strong Sell": 1,
      };
      const label =
        action?.analystConsensus?.status === "available"
          ? action.analystConsensus.consensusLabel
          : null;
      return label ? order[label] ?? -Infinity : -Infinity;
    }
    case "signal": {
      const order: Record<string, number> = {
        "Strong Buy": 6,
        Buy: 5,
        Watch: 4,
        Hold: 3,
        Trim: 2,
        Sell: 1,
        "Invalid Setup": 0,
      };
      return signal ? order[signal.signal] ?? -Infinity : -Infinity;
    }
    case "confidence":
      return signal ? signal.compositeScore : -Infinity;
    case "risk":
      return signal ? deriveRisk(signal).riskScore ?? -Infinity : -Infinity;
    case "buffett":
      return buffettScoreIsMeaningful(buffett) ? buffett?.overallScore ?? -Infinity : -Infinity;
    case "breakout": {
      const s = chart?.breakout?.status;
      return s === "breakout" ? 2 : s === "recent" ? 1 : s === "none" ? 0 : -Infinity;
    }
    default:
      return -Infinity;
  }
}

// The full watchlist workspace and the Dashboard's primary content: a left
// rail that *is* the grouped Watchlist — a search box, All/Needs-review/Custom
// filter chips, and the visible ideas grouped under collapsible section
// headings (Bravos + AI sections, plus an Other bucket for custom ideas).
// Selecting a ticker drives a rich detail pane with quote/market-cap/PE +
// performance KPIs, price/MA charts, breakout status, revenue, scenario model,
// thesis / catalysts / risks / kill-criteria, and add/remove persistence via
// the SQLite-backed API. `addSignal` is bumped by the Dashboard header's
// "Add to Watchlist" button to open the add dialog without lifting dialog
// state out of here.
export function ConvictionWatchlist({
  addSignal = 0,
  selectTicker,
  onSelectedTickerChange,
}: {
  addSignal?: number;
  // A ticker the parent (e.g. the moving ribbon) wants selected. Carries a
  // bump counter so repeat-selecting the same ticker still triggers the effect.
  selectTicker?: { ticker: string; nonce: number } | null;
  // Reports the currently-selected ticker symbol up to the parent so the
  // ribbon can highlight it.
  onSelectedTickerChange?: (ticker: string | null) => void;
}) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<WatchlistFilter>("all");
  // Groups start collapsed by default. We track explicit *expanded* groups; a
  // key absent from this map is collapsed. Auto-expansion (selecting/adding a
  // ticker) marks that group expanded for orientation.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ConvictionIdea | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);

  const query = useQuery<ConvictionIdeasResponse>({
    queryKey: ["/api/conviction-ideas"],
  });

  const data = query.data;
  const ideas = data?.ideas ?? [];
  const roles = data?.roles ?? [];
  const sections = data?.sections ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;

  // Open the add dialog when the Dashboard header signals it.
  useEffect(() => {
    if (addSignal > 0) setAddOpen(true);
  }, [addSignal]);

  // Section display order + labels, driven by the server's section list with a
  // trailing "Other" bucket for anything uncategorized (including custom ideas
  // that default to "other").
  const sectionMeta = useMemo(() => {
    const map = new Map<string, { label: string; icon: typeof Anchor }>();
    for (const s of sections) {
      map.set(s.key as string, {
        label: s.label,
        icon: SECTION_ICON[s.key] ?? ListChecks,
      });
    }
    if (!map.has("other")) {
      map.set("other", { label: "Custom / Other", icon: ListChecks });
    }
    return map;
  }, [sections]);

  const sectionOrder = useMemo(() => {
    const order = sections.map((s) => s.key as string);
    if (!order.includes("other")) order.push("other");
    return order;
  }, [sections]);

  // Existing group names offered in the Add dialog's Theme/grouping dropdown.
  // Excludes the catch-all "Other" bucket (themeless ideas land there anyway).
  const groupNames = useMemo(
    () => sections.filter((s) => s.key !== "other").map((s) => s.label),
    [sections],
  );

  // Apply the active scope filter (All / Needs review / Custom) and the search
  // query across ticker, company name and section label. Search filters across
  // all groups; the result still groups by section below.
  const visibleIdeas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (filter === "needs-review" && idea.reviewStatus !== "needs-review")
        return false;
      if (filter === "custom" && !idea.custom) return false;
      if (!q) return true;
      const hay = `${idea.ticker} ${idea.companyName} ${idea.sectionLabel ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [ideas, filter, search]);

  // Build the grouped watchlist: one group per section that has visible ideas,
  // in the server's section order. This is the default "All Watchlist" view —
  // sections are groupings here, not the primary navigation object.
  const groups = useMemo<WatchlistGroupData[]>(() => {
    const bySection = new Map<string, ConvictionIdea[]>();
    for (const idea of visibleIdeas) {
      const key = (idea.sectionKey ?? "other") as string;
      const arr = bySection.get(key) ?? [];
      arr.push(idea);
      bySection.set(key, arr);
    }
    const result: WatchlistGroupData[] = [];
    for (const key of sectionOrder) {
      const groupIdeas = bySection.get(key);
      if (!groupIdeas || groupIdeas.length === 0) continue;
      const meta = sectionMeta.get(key);
      result.push({
        key,
        label: meta?.label ?? key,
        icon: meta?.icon ?? ListChecks,
        ideas: groupIdeas,
      });
    }
    // Any section keys not present in the configured order (defensive).
    Array.from(bySection.entries()).forEach(([key, groupIdeas]) => {
      if (sectionOrder.includes(key)) return;
      result.push({
        key,
        label: sectionMeta.get(key)?.label ?? key,
        icon: sectionMeta.get(key)?.icon ?? ListChecks,
        ideas: groupIdeas,
      });
    });
    return result;
  }, [visibleIdeas, sectionOrder, sectionMeta]);

  // Default-select the first visible idea once data loads, and keep the
  // selection valid as the list (or filter) changes.
  useEffect(() => {
    if (ideas.length === 0) return;
    if (!selectedId || !ideas.some((i) => i.id === selectedId)) {
      setSelectedId(visibleIdeas[0]?.id ?? ideas[0].id);
    }
  }, [ideas, visibleIdeas, selectedId]);

  const selected = useMemo(
    () => ideas.find((i) => i.id === selectedId) ?? null,
    [ideas, selectedId],
  );

  // Keep the selected ticker's group expanded for orientation; all other
  // groups remain collapsed by default until the user opens them.
  useEffect(() => {
    if (!selected) return;
    const key = (selected.sectionKey ?? "other") as string;
    setExpanded((e) => (e[key] ? e : { ...e, [key]: true }));
  }, [selected]);

  // Report the active ticker symbol up so the moving ribbon can highlight it.
  useEffect(() => {
    onSelectedTickerChange?.(selected?.ticker ?? null);
  }, [selected, onSelectedTickerChange]);

  // Honour a "select this ticker" request from the parent (the ribbon). We
  // resolve the ticker to an idea and select it; the grouped list keeps its
  // section expanded so the row is visible.
  useEffect(() => {
    if (!selectTicker) return;
    const sym = selectTicker.ticker.trim().toUpperCase();
    const match = ideas.find((i) => i.ticker.toUpperCase() === sym);
    if (!match) return;
    setSelectedId(match.id);
    const key = (match.sectionKey ?? "other") as string;
    setExpanded((e) => ({ ...e, [key]: true }));
  }, [selectTicker, ideas]);

  const toggleGroup = (key: string) =>
    setExpanded((e) => ({ ...e, [key]: !e[key] }));

  const handleSelectIdea = (id: string) => {
    setSelectedId(id);
    setMobileRailOpen(false);
  };

  // Both add and remove endpoints return the full refreshed response, so we
  // write it straight into the query cache for an immediate update.
  const applyResponse = (next: ConvictionIdeasResponse) => {
    queryClient.setQueryData(["/api/conviction-ideas"], next);
  };

  const handleAdded = (next: ConvictionIdeasResponse, ticker: string) => {
    applyResponse(next);
    const added = next.ideas.find((i) => i.ticker === ticker);
    if (added) {
      setFilter("all");
      setSearch("");
      setSelectedId(added.id);
      const key = (added.sectionKey ?? "other") as string;
      setExpanded((e) => ({ ...e, [key]: true }));
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    try {
      const res = await apiRequest(
        "DELETE",
        `/api/conviction-ideas/${encodeURIComponent(pendingRemove.id)}`,
      );
      const next = (await res.json()) as ConvictionIdeasResponse;
      applyResponse(next);
      if (selectedId === pendingRemove.id) {
        setSelectedId(null);
      }
      toast({ title: `Removed ${pendingRemove.ticker}` });
      setPendingRemove(null);
    } catch (err) {
      toast({
        title: "Failed to remove idea",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  // Shared grouped-watchlist body — reused by the desktop rail and the mobile
  // drawer. Header + search + filter chips + "Add to Watchlist" + the grouped,
  // collapsible section list.
  const railBody = (
    <div className="space-y-3" data-testid="conviction-selector">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground" data-testid="watchlist-heading">
          Watchlist
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {visibleIdeas.length}
        </span>
      </div>

      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker or name…"
          className="h-9 pl-8 text-sm"
          aria-label="Search watchlist"
          data-testid="input-watchlist-search"
        />
      </div>

      <div className="flex items-center gap-1.5" data-testid="watchlist-filters">
        {WATCHLIST_FILTERS.map((f) => {
          const active = f.key === filter;
          const FIcon = f.icon;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              data-testid={`watchlist-filter-${f.key}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/70 bg-card/40 text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <FIcon className="h-3 w-3" aria-hidden />
              {f.label}
            </button>
          );
        })}
      </div>

      <Button
        type="button"
        className="w-full justify-center gap-1.5 h-9"
        onClick={() => {
          setMobileRailOpen(false);
          setAddOpen(true);
        }}
        data-testid="button-add-idea"
      >
        <Plus className="h-3.5 w-3.5" />
        Add to Watchlist
      </Button>

      {isLoading && ideas.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-md" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground"
          data-testid="watchlist-empty"
        >
          {search.trim() || filter !== "all"
            ? "No matching tickers."
            : "Your watchlist is empty. Add an idea to get started."}
        </div>
      ) : (
        <div className="space-y-2" data-testid="watchlist-groups">
          {groups.map((g) => (
            <WatchlistGroup
              key={g.key}
              groupKey={g.key}
              label={g.label}
              icon={g.icon}
              ideas={g.ideas}
              roles={roles}
              collapsed={!expanded[g.key]}
              onToggle={toggleGroup}
              selectedId={selectedId}
              onSelect={handleSelectIdea}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section
      className="flex flex-col md:h-full md:min-h-0 md:flex-row"
      data-testid="conviction-watchlist"
    >
      {/* Desktop grouped watchlist rail */}
      <aside
        className="hidden md:flex md:w-[280px] md:shrink-0 md:flex-col md:border-r md:border-border md:overflow-y-auto md:[overscroll-behavior:contain] p-4"
        data-testid="watchlist-rail"
      >
        {railBody}
      </aside>

      {/* Detail pane */}
      <div
        className="min-w-0 flex-1 md:overflow-y-auto md:[overscroll-behavior:contain]"
        data-testid="conviction-pane"
      >
        <div className="px-4 md:px-6 py-4 space-y-4 max-w-[1400px] mx-auto pb-24 md:pb-8">
          {/* Mobile: grouped watchlist opens in a left drawer; the selected
              ticker is shown alongside the trigger. */}
          <div className="md:hidden flex items-center gap-2">
            <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  data-testid="button-mobile-watchlist"
                >
                  <PanelLeft className="h-4 w-4" />
                  Watchlist
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-4 w-[320px] overflow-y-auto">
                {railBody}
              </SheetContent>
            </Sheet>
            <span className="text-xs font-semibold text-foreground truncate">
              {selected ? `${selected.ticker} · ${selected.companyName}` : "Select a ticker"}
            </span>
          </div>

          <div
            className="flex items-start gap-2 rounded-md border border-border/70 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground"
            data-testid="watchlist-disclaimer"
          >
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/80" />
            <p className="leading-relaxed">
              <span className="text-foreground">
                Starter research ideas, not recommendations.
              </span>{" "}
              A small, deliberate research book — not personalized financial
              advice. Model scores, checklist scores, and scenario models
              are hypothetical research inputs, not predictions or targets.
              Position-sizing bands are educational labels, not allocation
              guidance. Investments can lose value. Consult a qualified
              financial professional before acting.
            </p>
          </div>

          {isError && (
            <div
              className="rounded-md border border-neg/30 bg-neg/5 px-3 py-3 text-sm text-neg"
              data-testid="error-banner"
            >
              Failed to load conviction ideas:{" "}
              {(query.error as Error)?.message ?? "unknown"}
            </div>
          )}

          {isLoading && !selected ? (
            <div className="space-y-3">
              <Skeleton className="h-24 rounded-md" />
              <Skeleton className="h-16 rounded-md" />
              <Skeleton className="h-40 rounded-md" />
            </div>
          ) : selected ? (
            <IdeaDetail
              idea={selected}
              onRemove={() => setPendingRemove(selected)}
            />
          ) : (
            !isError &&
            !isLoading && (
              <div
                className="text-sm text-muted-foreground"
                data-testid="empty-detail"
              >
                No idea selected.
              </div>
            )
          )}

          {/* Bottom summary grid — a sortable, full-watchlist table across all
              loaded ideas. Clicking a row selects that ticker in the detail
              pane above. */}
          {!isLoading && ideas.length > 0 && (
            <WatchlistSummaryGrid
              ideas={ideas}
              selectedId={selectedId}
              onSelect={(id) => {
                const target = ideas.find((i) => i.id === id);
                if (target) {
                  const key = (target.sectionKey ?? "other") as string;
                  setExpanded((e) => ({ ...e, [key]: true }));
                }
                setSelectedId(id);
              }}
            />
          )}
        </div>
      </div>

      <AddIdeaDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={handleAdded}
        groupNames={groupNames}
      />

      <AlertDialog
        open={pendingRemove != null}
        onOpenChange={(v) => {
          if (!v) setPendingRemove(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-remove-idea">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingRemove?.ticker}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes {pendingRemove?.companyName} from your conviction
              book. {pendingRemove?.custom
                ? "Custom ideas are deleted permanently."
                : "You can re-add this curated idea later by its ticker."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRemove();
              }}
              disabled={removing}
              data-testid="button-confirm-remove"
            >
              {removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
