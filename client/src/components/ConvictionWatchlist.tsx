import { useEffect, useMemo, useState } from "react";
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
  ScenarioModel,
} from "@shared/schema";
import { CONVICTION_CHART_RANGES } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";
import { fmtPrice, fmtCompactCurrency, fmtPct } from "@/lib/format";
import { ScenarioDerivation } from "@/components/ScenarioDerivation";
import {
  BuffettConvictionPanel,
  SignalConvictionPanel,
  RiskConvictionPanel,
  ActionSignalPanel,
  AnalystConsensusPanel,
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
function RevenuePanel({ ticker }: { ticker: string }) {
  const query = useQuery<EquityRevenueResponse>({
    queryKey: ["/api/conviction-ideas/revenue", ticker],
    enabled: !!ticker,
  });
  const data = query.data;
  const currency = data?.currency ?? "USD";
  const annual = data?.annual ?? [];
  const quarterly = data?.quarterly ?? [];
  const hasSeries = annual.length > 0 || quarterly.length > 0;
  const available = data?.status === "available" && hasSeries;

  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="idea-revenue-card"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <DollarSign className="h-3.5 w-3.5 text-primary/80" aria-hidden />
          Revenue (current &amp; historical)
        </div>
        {available && (
          <div className="text-[11px] text-muted-foreground" data-testid="revenue-ttm">
            TTM:{" "}
            <span className="font-semibold text-foreground">
              {data?.ttmRevenue != null ? fmtCompactCurrency(data.ttmRevenue, currency) : "—"}
            </span>
            {data?.ttmIsAnnualFallback && data?.ttmRevenue != null && (
              <span className="ml-1 text-muted-foreground">(latest FY)</span>
            )}
            {data?.annualGrowthPct != null && (
              <span className={`ml-2 ${perfTone(data.annualGrowthPct)}`}>
                YoY {fmtPct(data.annualGrowthPct, 0)}
              </span>
            )}
          </div>
        )}
      </div>

      {query.isLoading ? (
        <Skeleton className="h-[140px] rounded-md" data-testid="revenue-loading" />
      ) : query.isError ? (
        <div
          className="text-xs text-muted-foreground"
          data-testid="revenue-error"
        >
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
        <div className="space-y-3" data-testid="revenue-body">
          {annual.length > 0 && (
            <div className="h-[140px]" data-testid="revenue-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={annual}
                  margin={{ top: 6, right: 8, left: 4, bottom: 0 }}
                >
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

          {quarterly.length > 0 && (
            <div className="overflow-x-auto" data-testid="revenue-table">
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
                      <td className="py-1 text-right font-medium text-foreground">
                        {fmtCompactCurrency(p.value, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Projections — always rendered so the unavailable state is explicit. */}
      <div
        className="rounded border border-dashed border-border/60 bg-background/30 px-3 py-2 text-[11px] text-muted-foreground"
        data-testid="revenue-projections"
      >
        <span className="font-semibold text-foreground/90">Projections:</span>{" "}
        {data?.projections?.status === "available" &&
        data.projections.points.length > 0 ? (
          <span data-testid="revenue-projections-available">
            {data.projections.points
              .map((p) => `${p.label} ${fmtCompactCurrency(p.value, currency)}`)
              .join(" · ")}
            {data.projections.source ? ` · source: ${data.projections.source}` : ""}
          </span>
        ) : (
          <span data-testid="revenue-projections-unavailable">
            {data?.projections?.note ??
              "Revenue projections unavailable with current free data sources."}
          </span>
        )}
      </div>

      {available && (
        <p className="text-[10px] text-muted-foreground" data-testid="revenue-source-note">
          {data?.note} {data?.entityName ? `· ${data.entityName}` : ""}
        </p>
      )}
    </div>
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
        <div className="text-[11px] text-muted-foreground">
          Reward/risk:{" "}
          <span className="font-semibold text-foreground">
            {model.rewardRiskRatio != null
              ? `${model.rewardRiskRatio.toFixed(2)}×`
              : "—"}
          </span>
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
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Conviction
              </div>
              <div className="text-xl font-bold text-primary">
                {idea.convictionScore}
                <span className="text-sm text-muted-foreground">/100</span>
              </div>
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
            label="Reward / risk"
            value={
              idea.scenarioModel?.rewardRiskRatio != null
                ? `${idea.scenarioModel.rewardRiskRatio.toFixed(2)}×`
                : "N/A"
            }
            testId="metric-rewardrisk"
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

      {/* Chart-first market section — price + moving averages with breakout
          status/markers, placed immediately under the snapshot so the graph
          and breakout read are visible before any thesis text. */}
      <div data-testid="idea-chart-first" className="space-y-4">
        <ConvictionChart ticker={idea.ticker} />
      </div>

      {/* Compact action / analyst / risk / Buffett cards — the rules-based read
          on the ticker, directly after the chart. */}
      <div className="space-y-4" data-testid="idea-insight-cards">
        {/* Primary, explainable Action Signal — folds the rules-based factors
            plus analyst consensus into one auditable verdict. */}
        <ActionSignalPanel ticker={idea.ticker} />
        {/* Analyst consensus (Finnhub) — sits next to the action/risk cards. */}
        <AnalystConsensusPanel ticker={idea.ticker} />
        {/* Legacy buy / sell + confidence timing signal (kept available). */}
        <SignalConvictionPanel ticker={idea.ticker} />
        {/* Risk assessment (rules-based, derived from the signal model) */}
        <RiskConvictionPanel ticker={idea.ticker} />
        {/* Buffett Index — business quality & valuation */}
        <BuffettConvictionPanel ticker={idea.ticker} />
      </div>

      {/* Revenue / fundamentals (current + historical from SEC EDGAR) */}
      <RevenuePanel ticker={idea.ticker} />

      {/* Scenario card */}
      {idea.scenarioModel ? (
        <ScenarioCard model={idea.scenarioModel} />
      ) : (
        <div
          className="rounded-md border border-border/70 bg-card/40 p-3 text-sm text-muted-foreground"
          data-testid="idea-scenario-card"
        >
          Scenario model unavailable for this idea.
        </div>
      )}

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
            and additional fields can be auto-updated later. Name, theme, role
            and conviction are all optional — leave them blank and the name is
            inferred from market data (falling back to the ticker).
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

          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label htmlFor="idea-score" className="text-xs">
                Conviction (0–100)
              </Label>
              <Input
                id="idea-score"
                type="number"
                min={0}
                max={100}
                value={form.convictionScore}
                onChange={(e) =>
                  setForm((f) => ({ ...f, convictionScore: e.target.value }))
                }
                className="mt-1 mono"
                data-testid="input-idea-score"
              />
            </div>
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
              advice. Conviction scores, checklist scores, and scenario models
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
