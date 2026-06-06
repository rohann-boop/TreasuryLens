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
  ConvictionChartResponse,
  ConvictionIdea,
  ConvictionIdeasResponse,
  ConvictionRole,
  ConvictionRoleInfo,
  ConvictionSectionKey,
  EquityRevenueResponse,
  ScenarioModel,
} from "@shared/schema";
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
  Star,
  Eye,
  PanelLeft,
} from "lucide-react";
import { fmtPrice, fmtCompactCurrency, fmtPct } from "@/lib/format";
import {
  BuffettConvictionPanel,
  SignalConvictionPanel,
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
function ConvictionChart({ ticker }: { ticker: string }) {
  const query = useQuery<ConvictionChartResponse>({
    queryKey: ["/api/conviction-ideas/chart", ticker],
    enabled: !!ticker,
  });

  const data = query.data;
  const points = data?.points ?? [];
  const hasData = points.length > 0;
  const showMa50 = (data?.availableMaWindows ?? []).includes(50);
  const showMa200 = (data?.availableMaWindows ?? []).includes(200);
  const currency = data?.currency ?? "USD";
  const fmt = (v: number) => fmtPrice(v, currency);

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
                  new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" })
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

function SelectorItem({
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
        data-testid={`selector-item-${idea.id}`}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(idea.id)}
        className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
          active
            ? "border-primary bg-primary/10"
            : "border-border/70 bg-card/40 hover:bg-muted"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm text-foreground">
            {idea.ticker}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {idea.convictionScore}/100
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {idea.companyName}
        </div>
      </button>
    </li>
  );
}

// A view in the section rail: either a curated thematic section or a
// synthesized cross-cutting view ("Custom / personal", "Needs review").
// `key` is used for testids and active-state; `count` is the number of ideas
// that resolve to this view.
interface RailView {
  key: string;
  label: string;
  blurb: string;
  icon: typeof Anchor;
  count: number;
  synthetic?: boolean;
}

// The left rail of watchlist sections. The active section drives which ticker
// list is shown. Renders as a vertical list of section buttons with counts.
function SectionRail({
  views,
  activeKey,
  onSelect,
}: {
  views: RailView[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav
      className="space-y-1"
      aria-label="Watchlist sections"
      data-testid="section-rail"
    >
      {views.map((v) => {
        const active = v.key === activeKey;
        const Icon = v.icon;
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => onSelect(v.key)}
            aria-current={active ? "true" : undefined}
            title={v.blurb}
            data-testid={`section-rail-item-${v.key}`}
            className={`w-full flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-transparent hover:bg-muted/60 text-foreground/90"
            }`}
          >
            <Icon
              className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
              aria-hidden
            />
            <span className="text-xs font-semibold truncate flex-1 min-w-0">
              {v.label}
            </span>
            <span
              className="text-[10px] text-muted-foreground shrink-0 tabular-nums"
              data-testid={`section-rail-count-${v.key}`}
            >
              {v.count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// The ticker list for the active section. Ideas are ordered by role so the
// role context (compounder / asymmetric / optionality) reads top-to-bottom.
function TickerList({
  ideas,
  roles,
  selectedId,
  onSelect,
}: {
  ideas: ConvictionIdea[];
  roles: ConvictionRoleInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (ideas.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground"
        data-testid="ticker-list-empty"
      >
        No ideas in this section yet.
      </div>
    );
  }
  const roleOrder = roles.map((r) => r.key);
  const sorted = [...ideas].sort(
    (a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role),
  );
  return (
    <ul className="space-y-1" data-testid="ticker-list">
      {sorted.map((idea) => (
        <SelectorItem
          key={idea.id}
          idea={idea}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
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
  return (
    <div className="space-y-4" data-testid="idea-detail">
      {/* Summary header */}
      <div className="rounded-md border border-border/70 bg-card/40 p-4 space-y-2">
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
      </div>

      {/* Metrics row — quote, market cap, P/E, 1m/6m/12m performance and the
          scenario reward/risk. Each is independently nullable so short or
          missing series degrade to "N/A" rather than fabricating a value. */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2"
        data-testid="idea-metrics"
      >
        <MetricCard
          label="Price"
          value={km?.price != null ? fmtPrice(km.price, km.priceCurrency ?? "USD") : "N/A"}
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

      {/* Price + moving-average chart */}
      <ConvictionChart ticker={idea.ticker} />

      {/* Buy / sell + confidence signal (rules-based model) */}
      <SignalConvictionPanel ticker={idea.ticker} />

      {/* Revenue (current + historical from SEC EDGAR) */}
      <RevenuePanel ticker={idea.ticker} />

      {/* Buffett Index — business quality & valuation */}
      <BuffettConvictionPanel ticker={idea.ticker} />

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

      {/* Thesis / what must be true */}
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

function AddIdeaDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: (data: ConvictionIdeasResponse, ticker: string) => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.ticker.trim() || !form.companyName.trim() || !form.theme.trim()) {
      toast({
        title: "Ticker, name and theme are required",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/conviction-ideas", {
        ticker: form.ticker.trim(),
        companyName: form.companyName.trim(),
        theme: form.theme.trim(),
        role: form.role,
        convictionScore: Number(form.convictionScore) || 50,
      });
      const data = (await res.json()) as ConvictionIdeasResponse;
      const ticker = form.ticker.trim().toUpperCase();
      onAdded(data, ticker);
      toast({ title: `Added ${ticker}` });
      setForm(emptyForm);
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
          <DialogTitle>Add conviction idea</DialogTitle>
          <DialogDescription>
            Add your own research idea by ticker, name and theme. Live pricing
            and a scenario model are attached automatically where available. You
            can flesh out thesis, catalysts and kill criteria afterward.
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
                Company / fund name
              </Label>
              <Input
                id="idea-name"
                value={form.companyName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, companyName: e.target.value }))
                }
                placeholder="e.g. ASML Holding N.V."
                className="mt-1"
                data-testid="input-idea-name"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="idea-theme" className="text-xs">
              Theme
            </Label>
            <Input
              id="idea-theme"
              value={form.theme}
              onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value }))}
              placeholder="e.g. Semiconductors / AI capex"
              className="mt-1"
              data-testid="input-idea-theme"
            />
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

// Synthetic cross-cutting rail views appended after the curated sections.
const CUSTOM_VIEW_KEY = "custom";
const REVIEW_VIEW_KEY = "needs-review";

const SECTION_ICON: Record<string, typeof Anchor> = {
  bravos: Star,
  "core-ai-compounders": Anchor,
  "speculative-ai-infra": Sparkles,
  "ai-power-grid": Rocket,
  "ai-software-data": LayoutGrid,
  "frontier-high-upside": Target,
  other: ListChecks,
  [CUSTOM_VIEW_KEY]: Plus,
  [REVIEW_VIEW_KEY]: Eye,
};

// The full watchlist workspace and the Dashboard's primary content: a left
// rail of thematic watchlist sections (Bravos + AI sections, plus synthesized
// "Custom / personal" and "Needs review" views) that drives a ticker list,
// alongside a rich detail pane with quote/market-cap/PE + performance KPIs,
// price/MA charts, breakout status, revenue, scenario model, thesis / bull-bear
// / catalysts / risks / kill-criteria, and add/remove persistence via the
// SQLite-backed API. `addSignal` is bumped by the Dashboard header's "Add idea"
// button to open the add dialog without lifting dialog state out of here.
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
  const [activeSection, setActiveSection] = useState<string | null>(null);
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

  const ideasBySection = useMemo(() => {
    const map = new Map<string, ConvictionIdea[]>();
    for (const idea of ideas) {
      const key = (idea.sectionKey ?? "other") as ConvictionSectionKey;
      const arr = map.get(key) ?? [];
      arr.push(idea);
      map.set(key, arr);
    }
    return map;
  }, [ideas]);

  const customIdeas = useMemo(() => ideas.filter((i) => i.custom), [ideas]);
  const reviewIdeas = useMemo(
    () => ideas.filter((i) => i.reviewStatus === "needs-review"),
    [ideas],
  );

  // Rail views = curated sections that actually have ideas, then the synthetic
  // Custom / Needs-review views (only when non-empty).
  const railViews = useMemo<RailView[]>(() => {
    const views: RailView[] = sections
      .map((s) => ({
        key: s.key as string,
        label: s.label,
        blurb: s.blurb,
        icon: SECTION_ICON[s.key] ?? ListChecks,
        count: ideasBySection.get(s.key)?.length ?? 0,
      }))
      .filter((v) => v.count > 0);
    if (customIdeas.length > 0) {
      views.push({
        key: CUSTOM_VIEW_KEY,
        label: "Custom / personal",
        blurb: "Your own ideas added to the watchlist.",
        icon: SECTION_ICON[CUSTOM_VIEW_KEY],
        count: customIdeas.length,
        synthetic: true,
      });
    }
    if (reviewIdeas.length > 0) {
      views.push({
        key: REVIEW_VIEW_KEY,
        label: "Needs review",
        blurb: "Ideas flagged for a fresh look against their kill criteria.",
        icon: SECTION_ICON[REVIEW_VIEW_KEY],
        count: reviewIdeas.length,
        synthetic: true,
      });
    }
    return views;
  }, [sections, ideasBySection, customIdeas, reviewIdeas]);

  // Default-select the first available section + idea once data loads.
  useEffect(() => {
    if (railViews.length === 0) return;
    if (!activeSection || !railViews.some((v) => v.key === activeSection)) {
      setActiveSection(railViews[0].key);
    }
  }, [railViews, activeSection]);

  const sectionIdeas = useMemo(() => {
    if (activeSection === CUSTOM_VIEW_KEY) return customIdeas;
    if (activeSection === REVIEW_VIEW_KEY) return reviewIdeas;
    if (activeSection) return ideasBySection.get(activeSection) ?? [];
    return [];
  }, [activeSection, customIdeas, reviewIdeas, ideasBySection]);

  // Keep a valid selection scoped to the active section.
  useEffect(() => {
    if (sectionIdeas.length === 0) return;
    if (!selectedId || !sectionIdeas.some((i) => i.id === selectedId)) {
      setSelectedId(sectionIdeas[0].id);
    }
  }, [sectionIdeas, selectedId]);

  const selected = useMemo(
    () => ideas.find((i) => i.id === selectedId) ?? null,
    [ideas, selectedId],
  );

  // Report the active ticker symbol up so the moving ribbon can highlight it.
  useEffect(() => {
    onSelectedTickerChange?.(selected?.ticker ?? null);
  }, [selected, onSelectedTickerChange]);

  // Honour a "select this ticker" request from the parent (the ribbon). We
  // resolve the ticker to an idea, switch to its section, and select it.
  useEffect(() => {
    if (!selectTicker) return;
    const sym = selectTicker.ticker.trim().toUpperCase();
    const match = ideas.find((i) => i.ticker.toUpperCase() === sym);
    if (!match) return;
    setActiveSection((match.sectionKey ?? "other") as string);
    setSelectedId(match.id);
  }, [selectTicker, ideas]);

  const handleSelectSection = (key: string) => {
    setActiveSection(key);
    setMobileRailOpen(false);
    const first =
      key === CUSTOM_VIEW_KEY
        ? customIdeas[0]
        : key === REVIEW_VIEW_KEY
          ? reviewIdeas[0]
          : ideasBySection.get(key)?.[0];
    if (first) setSelectedId(first.id);
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
      setActiveSection((added.sectionKey ?? "other") as string);
      setSelectedId(added.id);
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

  const activeLabel =
    railViews.find((v) => v.key === activeSection)?.label ?? "Sections";

  // Shared rail body — reused by the desktop column and the mobile drawer.
  const railBody = (
    <div className="space-y-4" data-testid="conviction-selector">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center gap-1.5 h-9"
        onClick={() => {
          setMobileRailOpen(false);
          setAddOpen(true);
        }}
        data-testid="button-add-idea"
      >
        <Plus className="h-3.5 w-3.5" />
        Add idea
      </Button>
      {isLoading && ideas.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-md" />
          ))}
        </div>
      ) : (
        <>
          <SectionRail
            views={railViews}
            activeKey={activeSection ?? ""}
            onSelect={handleSelectSection}
          />
          <div className="pt-2 border-t border-border/60 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
              {activeLabel}
            </div>
            <TickerList
              ideas={sectionIdeas}
              roles={roles}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setMobileRailOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );

  return (
    <section
      className="flex flex-col md:h-full md:min-h-0 md:flex-row"
      data-testid="conviction-watchlist"
    >
      {/* Desktop section rail + ticker list */}
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
          {/* Mobile: section selector trigger + active section label */}
          <div className="md:hidden flex items-center gap-2">
            <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  data-testid="button-mobile-sections"
                >
                  <PanelLeft className="h-4 w-4" />
                  Sections
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-4 w-[300px] overflow-y-auto">
                {railBody}
              </SheetContent>
            </Sheet>
            <span className="text-xs font-semibold text-foreground truncate">
              {activeLabel}
            </span>
          </div>

          {/* Mobile: horizontal section chips for quick switching */}
          {!isLoading && railViews.length > 0 && (
            <div
              className="md:hidden -mx-4 px-4 overflow-x-auto"
              data-testid="section-chips"
            >
              <div className="flex gap-1.5 w-max">
                {railViews.map((v) => {
                  const active = v.key === activeSection;
                  return (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => handleSelectSection(v.key)}
                      data-testid={`section-chip-${v.key}`}
                      aria-current={active ? "true" : undefined}
                      className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border/70 bg-card/40 text-muted-foreground"
                      }`}
                    >
                      {v.label}{" "}
                      <span className="opacity-60">{v.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
        </div>
      </div>

      <AddIdeaDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={handleAdded}
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
