import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ActionFactor,
  ActionLabel,
  ActionSignal,
  AnalystConsensus,
  BuffettCategory,
  BuffettIndex,
  ConvictionSignal,
  DownsideRisk,
  EntryQuality,
  EquityFundamentals,
  FactorVerdict,
  ModelSignal,
  ManagementGovernance,
  SignalLabel,
  ConfidenceLabel,
  UpsidePotential,
  QuantScore,
  QuantFactor,
  QuantBand,
  QuantConfidence,
  QuantBacktestResponse,
  QuantBacktestWindow,
  QuantBacktestVerdict,
  ScenarioModel,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { fmtPrice, fmtPct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Scale,
  Beaker,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Users,
  CircleCheck,
  CircleAlert,
  TrendingUp,
  TrendingDown,
  Target,
  Gauge,
  Users2,
  ArrowUpCircle,
  ArrowDownCircle,
  Sparkles,
  Scale as ScaleIcon,
  Rocket,
  ShieldHalf,
  LogIn,
  Clock,
  FlaskConical,
  Info,
  Calculator,
  Layers,
  BarChart3,
} from "lucide-react";

// Shared React Query hooks so the detail panels and the summary grid reuse the
// same cache entry per ticker (no duplicate provider calls). Keys match the
// queryClient's default `queryKey.join("/")` URL convention.
export function useIdeaSignal(ticker: string | null | undefined) {
  return useQuery<ModelSignal>({
    queryKey: ["/api/conviction-ideas/signal", ticker ?? ""],
    enabled: !!ticker,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/conviction-ideas/signal/${encodeURIComponent(ticker as string)}`,
      );
      return res.json();
    },
  });
}

export function useIdeaBuffett(ticker: string | null | undefined) {
  return useQuery<BuffettIndex>({
    queryKey: ["/api/conviction-ideas/buffett", ticker ?? ""],
    enabled: !!ticker,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/conviction-ideas/buffett/${encodeURIComponent(ticker as string)}`,
      );
      return res.json();
    },
  });
}

export function useIdeaActionSignal(ticker: string | null | undefined) {
  return useQuery<ActionSignal>({
    queryKey: ["/api/conviction-ideas/action-signal", ticker ?? ""],
    enabled: !!ticker,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/conviction-ideas/action-signal/${encodeURIComponent(ticker as string)}`,
      );
      return res.json();
    },
  });
}

// Technical-only quant backtest (universe-wide, not per-ticker). Cached
// server-side; we let React Query share it across panels.
export function useQuantBacktest(enabled: boolean) {
  return useQuery<QuantBacktestResponse>({
    queryKey: ["/api/quant-score/backtest"],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quant-score/backtest");
      return res.json();
    },
  });
}

export function useIdeaAnalystConsensus(ticker: string | null | undefined) {
  return useQuery<AnalystConsensus>({
    queryKey: ["/api/conviction-ideas/analyst-consensus", ticker ?? ""],
    enabled: !!ticker,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/conviction-ideas/analyst-consensus/${encodeURIComponent(ticker as string)}`,
      );
      return res.json();
    },
  });
}

// A ticker's Buffett score is only meaningful for operating equities. ETFs /
// funds / non-operating issuers have no fundamentals and degrade to a 0%
// coverage "incomplete" state — treat that as not-meaningful for display.
export function buffettScoreIsMeaningful(b: BuffettIndex | undefined): boolean {
  if (!b || !b.applicable) return false;
  if (b.overallScore == null) return false;
  if (b.framework === "equity" && !b.fundamentals && (b.dataCoverage ?? 0) < 0.15)
    return false;
  return true;
}

export type DerivedRiskLevel =
  | "Low"
  | "Moderate"
  | "Elevated"
  | "High"
  | "Unknown";

export interface DerivedRisk {
  level: DerivedRiskLevel;
  // 0-100 where higher = riskier. Derived from the signal's risk sub-model
  // (which itself blends volatility / drawdown / Sharpe) plus valuation and
  // momentum penalties and any invalid-setup flags.
  riskScore: number | null;
  reasons: string[];
  flags: string[];
}

// Rules-based risk derivation from the deterministic ModelSignal. The signal's
// `risk` sub-model scores *safety* (higher = calmer), so risk = 100 - safety,
// nudged up when valuation is stretched, momentum is weak, or the setup is
// flagged invalid. No LLM; purely a transform of public-data-derived scores.
export function deriveRisk(signal: ModelSignal | undefined): DerivedRisk {
  if (!signal) {
    return { level: "Unknown", riskScore: null, reasons: [], flags: [] };
  }
  const byKey = new Map(signal.models.map((m) => [m.key, m]));
  const risk = byKey.get("risk");
  const valuation = byKey.get("valuation");
  const momentum = byKey.get("momentum");

  const reasons: string[] = [];
  const flags: string[] = [];

  // Base: invert the risk sub-model's safety score.
  let score = risk && risk.available ? 100 - risk.score : 55;
  if (risk && risk.available && risk.bullets[0]) reasons.push(risk.bullets[0]);
  if (risk && risk.bullets.slice(1).length) {
    for (const b of risk.bullets.slice(1, 3)) reasons.push(b);
  }
  if (risk && !risk.available) flags.push("Limited price history — risk is approximate.");

  // Valuation penalty — a stretched multiple adds drawdown risk.
  if (valuation && valuation.available) {
    if (valuation.score < 40) {
      score += 12;
      flags.push("Valuation looks stretched.");
      if (valuation.bullets[0]) reasons.push(valuation.bullets[0]);
    } else if (valuation.score < 55) {
      score += 5;
    }
  }

  // Weak momentum modestly raises near-term risk.
  if (momentum && momentum.available && momentum.score < 40) {
    score += 6;
    flags.push("Momentum is weak.");
  }

  if (signal.invalidReasons.length > 0) {
    score = Math.max(score, 80);
    for (const r of signal.invalidReasons.slice(0, 2)) flags.push(r);
  }

  score = Math.max(0, Math.min(100, score));

  let level: DerivedRiskLevel;
  if (score >= 75) level = "High";
  else if (score >= 55) level = "Elevated";
  else if (score >= 35) level = "Moderate";
  else level = "Low";

  return { level, riskScore: Math.round(score), reasons: reasons.slice(0, 4), flags: flags.slice(0, 4) };
}

// =============================================================================
// SignalSection — a reusable collapsible row for the detail-pane signal stack.
// Each row shows an icon, a title, an at-a-glance headline summary (rendered to
// the right of the title) and an accessible expand/collapse toggle with a
// chevron. The body is mounted only when open. Light/dark compatible: it reuses
// the same card / border tokens as the rest of the detail pane. Collapse state
// is controlled by the parent so the whole stack can be coordinated.
// =============================================================================
export function SignalSection({
  icon: Icon,
  title,
  headline,
  open,
  onToggle,
  testId,
  children,
}: {
  icon: typeof Building2;
  title: string;
  // Compact at-a-glance summary shown in the header when collapsed *and* open.
  headline?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  const regionId = `${testId}-body`;
  return (
    <div
      className="rounded-md border border-border/70 bg-card/40"
      data-testid={testId}
      data-state={open ? "open" : "closed"}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        data-testid={`${testId}-toggle`}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 rounded-md transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
          {title}
        </span>
        {headline != null && (
          <span
            className="ml-auto flex items-center gap-2 min-w-0 justify-end flex-wrap"
            data-testid={`${testId}-headline`}
          >
            {headline}
          </span>
        )}
      </button>
      {open && (
        <div
          id={regionId}
          className="border-t border-border/60 p-3 space-y-3"
          data-testid={`${testId}-content`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Buffett business-quality panel for the selected conviction idea. Keyed by
// ticker; data comes from /api/conviction-ideas/buffett/:ticker (deployment-
// safe via the shared query client). ETFs/funds/ambiguous tickers degrade to
// an explicit "not meaningful" state rather than fabricating a verdict.
// =============================================================================

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-pos";
  if (score >= 45) return "text-amber-500";
  return "text-neg";
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

function fmtMetricPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)}%`;
}

function fmtMetricNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return v.toFixed(digits);
}

function CategoryCard({ c }: { c: BuffettCategory }) {
  return (
    <div
      className="rounded-md border border-border/70 bg-background/35 p-3"
      data-testid={`buffett-category-${c.key}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {c.name}
        </div>
        <div className={cn("tabular-nums text-sm font-semibold", scoreTone(c.score))}>
          {c.score == null ? "N/A" : c.score.toFixed(0)}
        </div>
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground leading-relaxed">
        {c.bullets.map((b) => (
          <div key={b}>{b}</div>
        ))}
      </div>
    </div>
  );
}

function FundMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-[12px] tabular-nums font-medium">{value}</div>
      {hint && <div className="text-[9px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

function FundamentalsBlock({ f }: { f: EquityFundamentals }) {
  const filing = f.latestFiling;
  return (
    <div
      className="rounded-md border border-border/60 bg-background/20"
      data-testid="buffett-fundamentals"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/50">
        <span>SEC EDGAR fundamentals</span>
        <span data-testid="buffett-fundamentals-source">
          CIK {f.cik}
          {filing ? ` · ${filing.form} ${filing.filed}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y divide-border/50">
        <FundMetric label="Revenue (TTM)" value={fmtMoney(f.revenue?.value)} />
        <FundMetric label="Net income" value={fmtMoney(f.netIncome?.value)} />
        <FundMetric label="Free cash flow" value={fmtMoney(f.freeCashFlow?.value)} />
        <FundMetric label="Gross margin" value={fmtMetricPct(f.grossMargin)} />
        <FundMetric label="Operating margin" value={fmtMetricPct(f.operatingMargin)} />
        <FundMetric label="Net margin" value={fmtMetricPct(f.netMargin)} />
        <FundMetric label="ROE" value={fmtMetricPct(f.roe)} />
        <FundMetric label="Debt / equity" value={fmtMetricNum(f.debtToEquity)} />
        <FundMetric label="Total debt" value={fmtMoney(f.totalDebt?.value)} />
        <FundMetric label="Revenue growth" value={fmtMetricPct(f.revenueGrowth)} hint="YoY" />
        <FundMetric label="EPS growth" value={fmtMetricPct(f.epsGrowth)} hint="YoY" />
        <FundMetric
          label="Share count"
          value={
            f.shareCountTrend
              ? `${f.shareCountTrend}${
                  f.shareCountChangePct != null
                    ? ` (${fmtMetricPct(f.shareCountChangePct, 1)})`
                    : ""
                }`
              : "N/A"
          }
        />
      </div>
    </div>
  );
}

function governanceTone(c: ManagementGovernance["confidence"]) {
  if (c === "high") return "text-pos";
  if (c === "medium") return "text-amber-500";
  if (c === "low") return "text-neg";
  return "text-muted-foreground";
}

function GovernanceBlock({ g }: { g: ManagementGovernance }) {
  const [open, setOpen] = useState(false);
  const ChevIcon = open ? ChevronDown : ChevronRight;
  return (
    <div
      className="rounded-md border border-border/60 bg-background/20"
      data-testid="buffett-governance"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-background/30"
        data-testid="buffett-governance-toggle"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          <ChevIcon className="h-3.5 w-3.5" />
          <Users className="h-3.5 w-3.5" />
          <span>Management &amp; governance</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] tabular-nums">
          <span
            className={cn(governanceTone(g.confidence))}
            data-testid="buffett-governance-confidence"
          >
            {g.confidence === "unknown" ? "needs review" : `confidence ${g.confidence}`}
          </span>
          <span className={cn("tabular-nums", scoreTone(g.score))} data-testid="buffett-governance-score">
            {g.score == null ? "N/A" : `${g.score.toFixed(0)}/100`}
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-border/50 p-3 space-y-2 text-[11px]">
          {g.leaders.length ? (
            <ul className="space-y-1" data-testid="buffett-governance-leaders">
              {g.leaders.map((l) => (
                <li key={`${l.role}-${l.name}`} className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">{l.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {l.role}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted-foreground">
              {g.cik ? "Executives not yet extracted from filings." : "No CIK match — SEC filings unavailable."}
            </div>
          )}
          {g.recentChanges.length > 0 && (
            <div className="pt-1 text-muted-foreground" data-testid="buffett-governance-changes">
              {g.recentChanges.length} recent 8-K Item 5.02 change(s).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ListColumn({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
        {(items.length ? items : [empty]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function BuffettConvictionPanel({
  ticker,
  headless = false,
}: {
  ticker: string;
  headless?: boolean;
}) {
  const query = useIdeaBuffett(ticker);
  const data = query.data;

  // ETF / fund / non-operating issuer: low or zero coverage and no equity
  // fundamentals. Treat as an explicit "not meaningful" state.
  const isThinEquity =
    data?.applicable === true &&
    data.framework === "equity" &&
    !data.fundamentals &&
    (data.dataCoverage ?? 0) < 0.15;

  return (
    <div
      className={
        headless
          ? "space-y-3"
          : "rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      }
      data-testid="buffett-index-panel"
    >
      {!headless && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 text-primary/80" aria-hidden />
            Buffett Index — business quality &amp; valuation
          </div>
          {data && (
            <span
              className={cn("text-[11px] uppercase tracking-wide tabular-nums", scoreTone(data.overallScore))}
              data-testid="buffett-score-header"
            >
              {data.overallScore == null ? "N/A" : `${data.overallScore.toFixed(0)} / 100`}
            </span>
          )}
        </div>
      )}

      {query.isLoading ? (
        <Skeleton className="h-[160px] rounded-md" data-testid="buffett-loading" />
      ) : query.isError ? (
        <div className="text-xs text-muted-foreground" data-testid="buffett-error">
          Buffett Index unavailable: {(query.error as Error)?.message ?? "unknown"}
        </div>
      ) : !data ? null : !data.applicable || isThinEquity ? (
        <div
          className="rounded border border-border/60 bg-background/40 px-3 py-3 text-xs text-muted-foreground"
          data-testid="buffett-unavailable"
        >
          <span className="font-semibold text-foreground/90">
            {data.label || "Not meaningful for this ticker."}
          </span>
          <p className="mt-1 leading-relaxed">
            {!data.applicable
              ? "Buffett business-quality metrics (ROIC, owner earnings, debt, management) do not apply here."
              : "This looks like an ETF, fund, or non-operating issuer — there are no company fundamentals from free SEC data to score business quality."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-3">
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Scale className="h-3.5 w-3.5" />
                <span className="text-[10px] uppercase tracking-wide">Long-term score</span>
              </div>
              <div
                className={cn("mt-2 text-3xl font-semibold tabular-nums", scoreTone(data.overallScore))}
                data-testid="buffett-overall-score"
              >
                {data.overallScore == null ? "N/A" : data.overallScore.toFixed(0)}
              </div>
              <div className="mt-1 text-sm font-medium text-foreground" data-testid="buffett-label">
                {data.label}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                Data coverage: {(data.dataCoverage * 100).toFixed(0)}%
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {data.categories.map((c) => (
                <CategoryCard key={c.key} c={c} />
              ))}
            </div>
          </div>

          {data.fundamentals && data.framework === "equity" && (
            <FundamentalsBlock f={data.fundamentals} />
          )}
          {data.managementGovernance && <GovernanceBlock g={data.managementGovernance} />}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <ListColumn title="Strengths" items={data.strengths} empty="No strong category yet." />
            <ListColumn title="Watchouts" items={data.watchouts} empty="No major quantified watchout." />
            <ListColumn title="Missing data" items={data.missingData} empty="No missing category data." />
          </div>
        </>
      )}

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Research framework for business quality and valuation, not a timing model
        and not financial advice. Equity fundamentals from SEC EDGAR where available.
      </p>
    </div>
  );
}

// =============================================================================
// Buy / Sell + confidence signal for the selected conviction idea. Keyed by
// ticker; rules-based and deterministic (no LLM). Shows the headline signal,
// a confidence percentage, the key reasons driving it, and the model ensemble.
// =============================================================================

function signalTone(label: SignalLabel): string {
  switch (label) {
    case "Strong Buy":
      return "border-pos/40 bg-pos/15 text-pos";
    case "Buy":
      return "border-pos/30 bg-pos/10 text-pos";
    case "Watch":
      return "border-primary/30 bg-primary/10 text-primary";
    case "Hold":
      return "border-border bg-muted/40 text-muted-foreground";
    case "Trim":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    case "Sell":
      return "border-neg/30 bg-neg/10 text-neg";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function confidenceTone(c: ConfidenceLabel): string {
  if (c === "High") return "text-pos";
  if (c === "Medium") return "text-primary";
  return "text-muted-foreground";
}

// The composite score (0-100) doubles as the model's confidence percentage:
// it is the weighted ensemble strength behind the signal.
export function SignalConvictionPanel({
  ticker,
  headless = false,
}: {
  ticker: string;
  headless?: boolean;
}) {
  const query = useIdeaSignal(ticker);
  const signal = query.data;

  // Key reasons: the top-scoring sub-model bullets plus the most material exit
  // triggers, so the user sees what is driving the call.
  const reasons = useMemo(() => {
    if (!signal) return [];
    const out: string[] = [];
    const ranked = [...signal.models].sort((a, b) => b.score - a.score);
    for (const m of ranked) {
      if (m.bullets[0]) out.push(`${m.name}: ${m.bullets[0]}`);
    }
    return out.slice(0, 4);
  }, [signal]);

  const confidencePct = signal ? Math.round(signal.compositeScore) : null;

  return (
    <div
      className={
        headless
          ? "space-y-3"
          : "rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      }
      data-testid="signal-indicator"
    >
      {!headless && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Beaker className="h-3.5 w-3.5 text-primary/80" aria-hidden />
            Buy / sell signal (rules-based model)
          </div>
          {signal && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded border text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5",
                  signalTone(signal.signal),
                )}
                data-testid="signal-label"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {signal.signal}
              </span>
              <span
                className={cn("text-[11px] uppercase tracking-wide tabular-nums", confidenceTone(signal.confidence))}
                data-testid="signal-confidence"
              >
                {signal.confidence} · {confidencePct}%
              </span>
            </div>
          )}
        </div>
      )}

      {query.isLoading ? (
        <Skeleton className="h-[120px] rounded-md" data-testid="signal-loading" />
      ) : query.isError ? (
        <div className="text-xs text-muted-foreground" data-testid="signal-error">
          Signal unavailable: {(query.error as Error)?.message ?? "unknown"}
        </div>
      ) : !signal ? null : (
        <>
          {signal.invalidReasons.length > 0 && (
            <div
              className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-500 flex items-start gap-2"
              data-testid="signal-invalid"
            >
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold uppercase tracking-wide text-[10px] mb-0.5">
                  Invalid setup
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {signal.invalidReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Confidence meter */}
          <div data-testid="signal-confidence-meter">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
              <span>Model confidence</span>
              <span className="tabular-nums font-medium text-foreground">{confidencePct}/100</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full",
                  (confidencePct ?? 0) >= 65
                    ? "bg-pos"
                    : (confidencePct ?? 0) >= 45
                      ? "bg-amber-500"
                      : "bg-neg",
                )}
                style={{ width: `${Math.max(0, Math.min(100, confidencePct ?? 0))}%` }}
              />
            </div>
          </div>

          {/* Levels */}
          <div className="grid grid-cols-3 gap-2" data-testid="signal-levels">
            <div className="rounded border border-border/60 bg-background/40 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <TrendingDown className="h-3 w-3" /> Stop
              </div>
              <div className="tabular-nums font-semibold text-sm mt-0.5 text-neg">
                {fmtPrice(signal.stopPrice, "USD")}
              </div>
            </div>
            <div className="rounded border border-border/60 bg-background/40 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Target className="h-3 w-3" /> Target
              </div>
              <div className="tabular-nums font-semibold text-sm mt-0.5 text-pos">
                {fmtPrice(signal.targetPrice, "USD")}
              </div>
            </div>
            <div className="rounded border border-border/60 bg-background/40 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <TrendingUp className="h-3 w-3" /> Composite
              </div>
              <div className="tabular-nums font-semibold text-sm mt-0.5">
                {signal.compositeScore.toFixed(0)}
              </div>
            </div>
          </div>

          {/* Key reasons */}
          {reasons.length > 0 && (
            <div data-testid="signal-reasons">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Key reasons driving the signal
              </div>
              <ul className="space-y-1 text-[11px]">
                {reasons.map((r) => (
                  <li key={r} className="flex items-start gap-1.5">
                    <CircleCheck className="h-3 w-3 mt-0.5 shrink-0 text-primary/70" />
                    <span className="text-foreground/90">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ensemble */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="signal-ensemble">
            {signal.models.map((m) => (
              <div
                key={m.key}
                className="rounded border border-border/60 bg-background/40 px-2.5 py-2"
                data-testid={`signal-submodel-${m.key}`}
                data-unavailable={!m.available ? "true" : undefined}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                    {m.name}
                  </span>
                  <span className={cn("text-xs font-semibold tabular-nums", scoreTone(m.score), !m.available && "opacity-60")}>
                    {m.score.toFixed(0)}
                  </span>
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">
                  weight {(m.weight * 100).toFixed(0)}%{!m.available && " · partial"}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Model signal, not financial advice. Levels and labels are derived
          deterministically from public price data — no trade execution and no
          LLM in this calculation.
        </span>
      </p>
    </div>
  );
}

// =============================================================================
// Risk panel for the selected conviction idea. Rules-based: it reuses the same
// deterministic ModelSignal as the buy/sell panel (shared query cache) and
// derives a risk level + score + reasons/flags from the signal's volatility /
// drawdown / valuation / momentum sub-scores. No separate provider call.
// =============================================================================

function riskTone(level: DerivedRiskLevel): string {
  switch (level) {
    case "Low":
      return "border-pos/30 bg-pos/10 text-pos";
    case "Moderate":
      return "border-primary/30 bg-primary/10 text-primary";
    case "Elevated":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    case "High":
      return "border-neg/30 bg-neg/10 text-neg";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function riskMeterTone(score: number | null): string {
  if (score == null) return "bg-muted-foreground/40";
  if (score >= 75) return "bg-neg";
  if (score >= 55) return "bg-amber-500";
  if (score >= 35) return "bg-primary";
  return "bg-pos";
}

export function RiskConvictionPanel({
  ticker,
  headless = false,
}: {
  ticker: string;
  headless?: boolean;
}) {
  const query = useIdeaSignal(ticker);
  const signal = query.data;
  const risk = useMemo(() => deriveRisk(signal), [signal]);

  return (
    <div
      className={
        headless
          ? "space-y-3"
          : "rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      }
      data-testid="risk-indicator"
    >
      {!headless && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Gauge className="h-3.5 w-3.5 text-primary/80" aria-hidden />
            Risk assessment (rules-based)
          </div>
          {signal && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded border text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5",
                  riskTone(risk.level),
                )}
                data-testid="risk-level"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {risk.level} risk
              </span>
              {risk.riskScore != null && (
                <span
                  className="text-[11px] uppercase tracking-wide tabular-nums text-muted-foreground"
                  data-testid="risk-score"
                >
                  {risk.riskScore}/100
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {query.isLoading ? (
        <Skeleton className="h-[110px] rounded-md" data-testid="risk-loading" />
      ) : query.isError ? (
        <div className="text-xs text-muted-foreground" data-testid="risk-error">
          Risk unavailable: {(query.error as Error)?.message ?? "unknown"}
        </div>
      ) : !signal ? null : (
        <>
          {/* Risk meter */}
          <div data-testid="risk-meter">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
              <span>Downside risk (higher = riskier)</span>
              <span className="tabular-nums font-medium text-foreground">
                {risk.riskScore ?? "—"}/100
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full", riskMeterTone(risk.riskScore))}
                style={{ width: `${Math.max(0, Math.min(100, risk.riskScore ?? 0))}%` }}
              />
            </div>
          </div>

          {/* Key risk reasons */}
          {risk.reasons.length > 0 && (
            <div data-testid="risk-reasons">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Key risk notes
              </div>
              <ul className="space-y-1 text-[11px]">
                {risk.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-1.5">
                    <CircleAlert className="h-3 w-3 mt-0.5 shrink-0 text-amber-500/80" />
                    <span className="text-foreground/90">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risk flags */}
          {risk.flags.length > 0 && (
            <div data-testid="risk-flags">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Risk flags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {risk.flags.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500 text-[10px] px-2 py-0.5"
                  >
                    <ShieldAlert className="h-3 w-3" />
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {risk.reasons.length === 0 && risk.flags.length === 0 && (
            <p className="text-[11px] text-muted-foreground" data-testid="risk-empty">
              No material risk flags from available price data.
            </p>
          )}
        </>
      )}

      <p className="text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Rules-based risk view, not financial advice. Derived deterministically
          from the signal model's volatility, drawdown, valuation and momentum
          sub-scores — no LLM.
        </span>
      </p>
    </div>
  );
}

// =============================================================================
// Analyst Consensus panel — Wall-Street recommendation trends from Finnhub.
// Keyed by ticker via /api/conviction-ideas/analyst-consensus/:ticker. Renders
// the latest consensus verdict, the bull/bear split, a count breakdown and a
// short trend history. Degrades to an explicit message when the token is
// missing or the ticker is uncovered (ETFs / funds).
// =============================================================================

function consensusTone(label: AnalystConsensus["consensusLabel"]): string {
  switch (label) {
    case "Strong Buy":
      return "border-pos/40 bg-pos/15 text-pos";
    case "Buy":
      return "border-pos/30 bg-pos/10 text-pos";
    case "Hold":
      return "border-primary/30 bg-primary/10 text-primary";
    case "Sell":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    case "Strong Sell":
      return "border-neg/30 bg-neg/10 text-neg";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

const REC_BANDS: {
  key: keyof Pick<AnalystConsensus, "strongBuy" | "buy" | "hold" | "sell" | "strongSell">;
  label: string;
  tone: string;
}[] = [
  { key: "strongBuy", label: "Strong Buy", tone: "bg-pos" },
  { key: "buy", label: "Buy", tone: "bg-pos/60" },
  { key: "hold", label: "Hold", tone: "bg-primary/60" },
  { key: "sell", label: "Sell", tone: "bg-amber-500/70" },
  { key: "strongSell", label: "Strong Sell", tone: "bg-neg" },
];

export function AnalystConsensusPanel({
  ticker,
  headless = false,
}: {
  ticker: string;
  headless?: boolean;
}) {
  const query = useIdeaAnalystConsensus(ticker);
  const data = query.data;
  const available = data?.status === "available";

  return (
    <div
      className={
        headless
          ? "space-y-3"
          : "rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      }
      data-testid="analyst-consensus-panel"
    >
      {!headless && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Users2 className="h-3.5 w-3.5 text-primary/80" aria-hidden />
            Analyst consensus (Finnhub)
          </div>
          {available && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded border text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5",
                  consensusTone(data!.consensusLabel),
                )}
                data-testid="analyst-consensus-label"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {data!.consensusLabel ?? "—"}
              </span>
              <span
                className="text-[11px] uppercase tracking-wide tabular-nums text-muted-foreground"
                data-testid="analyst-consensus-count"
              >
                {data!.totalAnalysts} analysts
              </span>
            </div>
          )}
        </div>
      )}

      {query.isLoading ? (
        <Skeleton className="h-[120px] rounded-md" data-testid="analyst-consensus-loading" />
      ) : query.isError ? (
        <div className="text-xs text-muted-foreground" data-testid="analyst-consensus-error">
          Analyst consensus unavailable: {(query.error as Error)?.message ?? "unknown"}
        </div>
      ) : !data ? null : !available ? (
        <div
          className="rounded border border-border/60 bg-background/40 px-3 py-3 text-xs text-muted-foreground"
          data-testid="analyst-consensus-unavailable"
        >
          <span className="font-semibold text-foreground/90">
            {data.status === "error" ? "Could not load analyst consensus." : "No analyst consensus available."}
          </span>
          <p className="mt-1 leading-relaxed">{data.message}</p>
        </div>
      ) : (
        <>
          {/* Bull / bear split bar */}
          <div data-testid="analyst-consensus-split">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
              <span className="text-pos">Bullish {data.bullishPercent ?? 0}%</span>
              <span className="text-muted-foreground">as of {data.lastUpdated}</span>
              <span className="text-neg">Bearish {data.bearishPercent ?? 0}%</span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
              {REC_BANDS.map((b) => {
                const v = (data[b.key] as number | null) ?? 0;
                const pct = data.totalAnalysts ? (v / data.totalAnalysts) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <div
                    key={b.key}
                    className={cn("h-full", b.tone)}
                    style={{ width: `${pct}%` }}
                    title={`${b.label}: ${v}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Count breakdown */}
          <div className="grid grid-cols-5 gap-1.5" data-testid="analyst-consensus-breakdown">
            {REC_BANDS.map((b) => (
              <div
                key={b.key}
                className="rounded border border-border/60 bg-background/40 px-1.5 py-1.5 text-center"
                data-testid={`analyst-band-${b.key}`}
              >
                <div className="text-sm font-semibold tabular-nums text-foreground">
                  {(data[b.key] as number | null) ?? 0}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground leading-tight mt-0.5">
                  {b.label}
                </div>
              </div>
            ))}
          </div>

          {/* Trend history */}
          {data.history.length > 1 && (
            <div data-testid="analyst-consensus-trend">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center justify-between">
                <span>Recent trend</span>
                {data.trendDirection && (
                  <span
                    className={cn(
                      "tabular-nums",
                      data.trendDirection === "improving"
                        ? "text-pos"
                        : data.trendDirection === "deteriorating"
                          ? "text-neg"
                          : "text-muted-foreground",
                    )}
                  >
                    {data.trendDirection}
                  </span>
                )}
              </div>
              <ul className="space-y-0.5 text-[11px]">
                {data.history.slice(0, 4).map((p) => (
                  <li key={p.period} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground tabular-nums">{p.period}</span>
                    <span className="text-foreground/90">{p.label ?? "—"}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {p.bullishPercent ?? 0}% bull · {p.total}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Sell-side recommendation counts from Finnhub, shown for research
          context — not an endorsement and not financial advice.
        </span>
      </p>
    </div>
  );
}

// =============================================================================
// Action Signal panel — the primary, explainable verdict that augments the
// legacy buy/sell signal. Shows the action label, a factor scorecard with
// plain-English rationale per factor, agreement vs. analysts, and what would
// upgrade / downgrade the call. Keyed by ticker via the action-signal endpoint.
// =============================================================================

function actionTone(label: ActionLabel): string {
  switch (label) {
    case "Add":
      return "border-pos/40 bg-pos/15 text-pos";
    case "Starter":
      return "border-pos/30 bg-pos/10 text-pos";
    case "Hold":
      return "border-primary/30 bg-primary/10 text-primary";
    case "Watch":
      return "border-border bg-muted/40 text-muted-foreground";
    case "Trim":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    case "Avoid":
      return "border-neg/30 bg-neg/10 text-neg";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function factorTone(v: FactorVerdict): string {
  switch (v) {
    case "strong":
      return "text-pos";
    case "favorable":
      return "text-pos/80";
    case "neutral":
      return "text-primary";
    case "caution":
      return "text-amber-500";
    case "weak":
      return "text-neg";
    default:
      return "text-muted-foreground";
  }
}

function factorBar(v: FactorVerdict): string {
  switch (v) {
    case "strong":
      return "bg-pos";
    case "favorable":
      return "bg-pos/70";
    case "neutral":
      return "bg-primary";
    case "caution":
      return "bg-amber-500";
    case "weak":
      return "bg-neg";
    default:
      return "bg-muted-foreground/40";
  }
}

function agreementTone(a: ActionSignal["agreement"]["agreement"]): string {
  switch (a) {
    case "aligned":
      return "text-pos";
    case "analysts-more-bullish":
      return "text-primary";
    case "analysts-more-bearish":
      return "text-amber-500";
    default:
      return "text-muted-foreground";
  }
}

function FactorRow({ f }: { f: ActionFactor }) {
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-2.5 py-2"
      data-testid={`action-factor-${f.key}`}
      data-unavailable={!f.available ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground">{f.name}</span>
        <span className="flex items-center gap-1.5">
          <span className={cn("text-[10px] uppercase tracking-wide", factorTone(f.verdict))}>
            {f.label}
          </span>
          <span className={cn("text-xs font-semibold tabular-nums", factorTone(f.verdict))}>
            {f.score == null ? "N/A" : f.score}
          </span>
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full", factorBar(f.verdict))}
          style={{ width: `${Math.max(0, Math.min(100, f.score ?? 0))}%` }}
        />
      </div>
      <p
        className="mt-1 text-[10px] text-muted-foreground leading-relaxed"
        data-testid={`action-factor-rationale-${f.key}`}
      >
        {f.rationale}
      </p>
    </div>
  );
}

// ---------- Conviction Signal sub-panel (honest, separated read) ----------

function upsideTone(p: UpsidePotential): string {
  switch (p) {
    case "5x candidate":
      return "border-pos/40 bg-pos/15 text-pos";
    case "3x candidate":
      return "border-pos/30 bg-pos/10 text-pos";
    case "2x candidate":
      return "border-primary/30 bg-primary/10 text-primary";
    case "base":
      return "border-border bg-muted/40 text-foreground/80";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function downsideTone(r: DownsideRisk): string {
  switch (r) {
    case "low":
      return "border-pos/30 bg-pos/10 text-pos";
    case "moderate":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    case "high":
      return "border-neg/30 bg-neg/10 text-neg";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function entryTone(q: EntryQuality): string {
  switch (q) {
    case "attractive":
      return "border-pos/30 bg-pos/10 text-pos";
    case "fair":
      return "border-primary/30 bg-primary/10 text-primary";
    case "extended":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    case "wait-for-setup":
      return "border-neg/30 bg-neg/10 text-neg";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function backtestTone(c: ConvictionSignal["backtest"]["confidence"]): string {
  switch (c) {
    case "strong":
      return "border-pos/30 bg-pos/10 text-pos";
    case "moderate":
      return "border-primary/30 bg-primary/10 text-primary";
    case "weak":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function PillCard({
  icon,
  title,
  pill,
  pillClass,
  detail,
  rationale,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  pill: string;
  pillClass: string;
  detail?: string | null;
  rationale?: string[];
  testId: string;
}) {
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-2.5 py-2 space-y-1.5"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {icon}
          {title}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            pillClass,
          )}
          data-testid={`${testId}-pill`}
        >
          {pill}
        </span>
      </div>
      {detail && (
        <div className="text-[11px] font-medium tabular-nums text-foreground/90" data-testid={`${testId}-detail`}>
          {detail}
        </div>
      )}
      {rationale && rationale.length > 0 && (
        <ul className="space-y-0.5">
          {rationale.slice(0, 2).map((r, i) => (
            <li key={i} className="text-[10px] text-muted-foreground leading-relaxed">
              · {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ConvictionSignalBlock({ c }: { c: ConvictionSignal }) {
  const bt = c.backtest;
  if (c.insufficientEvidence) {
    return (
      <div
        className="rounded border border-border/60 bg-background/40 px-3 py-3 text-[12px] text-muted-foreground flex items-start gap-2"
        data-testid="conviction-signal-insufficient"
      >
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <div className="font-semibold text-foreground/90">Not enough evidence yet</div>
          <p className="leading-relaxed">
            Pending market / fundamental data for this ticker. We won't show an
            overconfident upside or downside read until there's enough to back it.
          </p>
          <ConvictionBacktestBadge bt={bt} />
        </div>
      </div>
    );
  }

  const upsideDetail =
    c.upside.upsidePctEstimate != null
      ? `Bull-case estimate ~+${c.upside.upsidePctEstimate}% (scenario, not guaranteed)`
      : null;
  const downsideDetail = (() => {
    const parts: string[] = [];
    if (c.downside.downsidePctEstimate != null)
      parts.push(`Bear-case estimate ~${c.downside.downsidePctEstimate}%`);
    if (c.downside.invalidationLevel != null)
      parts.push(`invalidation ~${c.downside.invalidationLevel.toFixed(2)}`);
    return parts.length ? parts.join(" · ") : null;
  })();

  return (
    <div className="space-y-2.5" data-testid="conviction-signal-block">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Conviction signal — scenario read
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PillCard
          icon={<Rocket className="h-3 w-3" />}
          title="Upside potential"
          pill={c.upside.label}
          pillClass={upsideTone(c.upside.potential)}
          detail={upsideDetail}
          rationale={c.upside.rationale}
          testId="conviction-upside"
        />
        <PillCard
          icon={<ShieldHalf className="h-3 w-3" />}
          title="Downside risk"
          pill={c.downside.label}
          pillClass={downsideTone(c.downside.risk)}
          detail={downsideDetail}
          rationale={c.downside.rationale}
          testId="conviction-downside"
        />
        <PillCard
          icon={<LogIn className="h-3 w-3" />}
          title="Entry quality"
          pill={c.entry.label}
          pillClass={entryTone(c.entry.quality)}
          rationale={c.entry.rationale}
          testId="conviction-entry"
        />
        <PillCard
          icon={<Clock className="h-3 w-3" />}
          title="Time horizon"
          pill={c.horizon.label}
          pillClass="border-border bg-muted/40 text-foreground/80"
          rationale={c.horizon.rationale ? [c.horizon.rationale] : undefined}
          testId="conviction-horizon"
        />
      </div>

      {c.evidence.length > 0 && (
        <div data-testid="conviction-evidence">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Why this signal
          </div>
          <ul className="space-y-1 text-[11px]">
            {c.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CircleCheck className="h-3 w-3 mt-0.5 shrink-0 text-primary/70" />
                <span className="text-foreground/90">{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.invalidationTriggers.length > 0 && (
        <div data-testid="conviction-invalidation">
          <div className="text-[10px] uppercase tracking-wide text-amber-500 mb-1 flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> What would change the view
          </div>
          <ul className="space-y-1 text-[11px]">
            {c.invalidationTriggers.map((t, i) => (
              <li key={i} className="flex items-start gap-1.5" data-testid="conviction-invalidation-trigger">
                <ArrowDownCircle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500/70" />
                <span className="text-foreground/90">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConvictionBacktestBadge bt={bt} />
    </div>
  );
}

function ConvictionBacktestBadge({ bt }: { bt: ConvictionSignal["backtest"] }) {
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-2.5 py-2 flex items-start gap-2"
      data-testid="conviction-backtest"
    >
      <FlaskConical className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Backtest status
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              backtestTone(bt.confidence),
            )}
            data-testid="conviction-backtest-pill"
          >
            {bt.label}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">{bt.note}</p>
      </div>
    </div>
  );
}

// ---------- Quant Score v1 sub-panel (transparent factor-score model) --------

function quantBandTone(band: QuantBand): string {
  switch (band) {
    case "strong":
      return "border-pos/40 bg-pos/15 text-pos";
    case "constructive":
      return "border-pos/30 bg-pos/10 text-pos";
    case "mixed":
      return "border-primary/30 bg-primary/10 text-primary";
    case "weak":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function quantConfidenceTone(c: QuantConfidence): string {
  switch (c) {
    case "high":
      return "text-pos";
    case "medium":
      return "text-primary";
    case "low":
      return "text-amber-500";
    default:
      return "text-muted-foreground";
  }
}

function quantSourceLabel(s: QuantFactor["source"]): string {
  switch (s) {
    case "technical":
      return "Technical";
    case "analyst":
      return "Analyst";
    case "fundamental":
      return "Fundamental";
    case "risk":
      return "Risk";
    default:
      return s;
  }
}

function quantStatusTone(status: QuantFactor["status"], score: number | null): string {
  if (status !== "scored" || score == null) return "text-muted-foreground";
  if (score >= 70) return "text-pos";
  if (score >= 58) return "text-pos/80";
  if (score >= 45) return "text-primary";
  if (score >= 32) return "text-amber-500";
  return "text-neg";
}

function quantBarTone(status: QuantFactor["status"], score: number | null): string {
  if (status !== "scored" || score == null) return "bg-muted-foreground/30";
  if (score >= 70) return "bg-pos";
  if (score >= 58) return "bg-pos/70";
  if (score >= 45) return "bg-primary";
  if (score >= 32) return "bg-amber-500";
  return "bg-neg";
}

function QuantFactorRow({ f }: { f: QuantFactor }) {
  const scored = f.status === "scored" && f.score != null;
  const statusText =
    f.status === "scored"
      ? `${f.score}`
      : f.status === "pending"
        ? "Pending"
        : "N/A";
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-2.5 py-2"
      data-testid={`quant-factor-${f.key}`}
      data-status={f.status}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-foreground truncate">{f.label}</span>
          <span className="shrink-0 rounded border border-border/60 px-1 py-px text-[8px] uppercase tracking-wide text-muted-foreground">
            {quantSourceLabel(f.source)}
          </span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className={cn("text-xs font-semibold tabular-nums", quantStatusTone(f.status, f.score))}>
            {statusText}
          </span>
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full", quantBarTone(f.status, f.score))}
          style={{ width: `${scored ? Math.max(2, Math.min(100, f.score as number)) : 0}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p
          className="text-[10px] text-muted-foreground leading-relaxed"
          data-testid={`quant-factor-rationale-${f.key}`}
        >
          {f.rationale}
        </p>
        {scored && (
          <span className="shrink-0 text-[9px] text-muted-foreground tabular-nums whitespace-nowrap">
            w {Math.round(f.weight * 100)}% · +{f.contribution.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}

export function QuantScoreBlock({ q }: { q: QuantScore }) {
  const insufficient = q.overall == null;
  return (
    <div
      className="rounded-md border border-primary/20 bg-primary/[0.03] p-3 space-y-2.5"
      data-testid="quant-score-block"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Calculator className="h-3.5 w-3.5 text-primary/80" aria-hidden />
          Quant Score v1
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              quantBandTone(q.band),
            )}
            data-testid="quant-score-band"
          >
            {q.bandLabel}
          </span>
          <span className="text-lg font-bold tabular-nums text-foreground" data-testid="quant-score-overall">
            {q.overall == null ? "—" : q.overall}
            <span className="text-[10px] font-normal text-muted-foreground">/100</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[10px]">
        <span className="text-muted-foreground">
          Confidence:{" "}
          <span className={cn("font-semibold uppercase", quantConfidenceTone(q.confidence))} data-testid="quant-score-confidence">
            {q.confidence}
          </span>
        </span>
        <span className="text-muted-foreground" data-testid="quant-score-coverage">
          Data coverage:{" "}
          <span className="font-semibold tabular-nums text-foreground/90">
            {Math.round(q.dataCoverage * 100)}%
          </span>{" "}
          ({q.scoredFactors}/{q.totalFactors} factors)
        </span>
      </div>

      <p className="text-[11px] text-foreground/85 leading-relaxed" data-testid="quant-score-summary">
        {q.summary}
      </p>

      {insufficient && (
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Not enough scored factors to stand behind an overall number. Pending
            market / fundamental data — we show factor detail below rather than a
            fabricated score.
          </span>
        </div>
      )}

      <div data-testid="quant-score-factors">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
          <Layers className="h-3 w-3" /> Factor breakdown
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {q.factors.map((f) => (
            <QuantFactorRow key={f.key} f={f} />
          ))}
        </div>
      </div>

      <div
        className="rounded border border-border/60 bg-background/40 px-2.5 py-2 flex items-start gap-2"
        data-testid="quant-score-backtest"
      >
        <FlaskConical className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="space-y-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {q.backtest.label}
          </span>
          <p className="text-[10px] text-muted-foreground leading-relaxed">{q.backtest.note}</p>
        </div>
      </div>
    </div>
  );
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

// One window's threshold cohorts rendered as a compact responsive table.
function BacktestWindowCard({
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
        data-testid={`quant-backtest-window-${w.key}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-foreground/90">{w.label}</span>
          <span className="inline-flex items-center rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Unavailable
          </span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">{w.status}</p>
      </div>
    );
  }
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-2.5 py-2 space-y-1.5"
      data-testid={`quant-backtest-window-${w.key}`}
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
                data-testid={`quant-backtest-cohort-${w.key}-${t.key}`}
              >
                <td className="pr-2 py-0.5 text-foreground/90 whitespace-nowrap">{t.label}</td>
                <td className="px-1 py-0.5 text-right text-muted-foreground">{t.selectedCount}</td>
                <td className="px-1 py-0.5 text-right">{fmtPctVal(t.selectedAvgReturnPct)}</td>
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

function toneClass(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  return n > 0 ? "text-pos" : n < 0 ? "text-neg" : "text-foreground/90";
}

// Universe-wide technical-only Backtest v1. Multiple point-in-time windows
// (3M/6M/1Y/2Y where data exists) each with several threshold cohorts. Honest
// "Technical-only" framing + limitations are always surfaced.
export function QuantBacktestPanel({
  open = false,
  headless = false,
}: {
  open?: boolean;
  // When headless, the parent (e.g. an accordion row) supplies the toggle and
  // chrome; the panel always fetches and renders the body directly.
  headless?: boolean;
}) {
  const [expanded, setExpanded] = useState(open);
  const active = headless || expanded;
  const query = useQuantBacktest(active);
  const data = query.data;
  return (
    <div
      className={
        headless
          ? "space-y-2"
          : "rounded-md border border-border/70 bg-card/40 p-3 space-y-2"
      }
      data-testid="quant-backtest-panel"
    >
      {!headless && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
          data-testid="quant-backtest-toggle"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5 text-primary/80" aria-hidden />
            Backtest v1 — technical-only validation
          </span>
          <span className="flex items-center gap-2">
            {!expanded && (
              <span className="text-[10px] text-muted-foreground">Tap to run</span>
            )}
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
        </button>
      )}

      {!active ? (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The full quant score is not validated yet. A lightweight technical-only
          backtest (price/momentum only, no fundamental or analyst look-ahead) runs
          across several point-in-time windows (3M / 6M / 1Y / 2Y where data exists)
          as a directional sanity check — not a complete fundamentals-aware backtest.
        </p>
      ) : query.isLoading ? (
        <Skeleton className="h-[160px] rounded-md" data-testid="quant-backtest-loading" />
      ) : query.isError ? (
        <div className="text-xs text-muted-foreground" data-testid="quant-backtest-error">
          Backtest unavailable: {(query.error as Error)?.message ?? "unknown"}
        </div>
      ) : !data ? null : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500"
              data-testid="quant-backtest-badge"
            >
              {data.validationBadge}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                data.tested
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
              data-testid="quant-backtest-status"
            >
              {data.tested
                ? "Backtest run"
                : "Not enough historical validation yet"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Universe: {data.universeSize} · benchmark {data.benchmarkSymbol}
            </span>
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Directional sanity check on the price/momentum factor only. Each window
            scores names at a past decision date using prior bars, then measures the
            forward return to today. "vs rest" = selected avg − rest avg; "vs bmk" =
            selected avg − {data.benchmarkSymbol}. This is NOT a complete
            fundamentals-aware historical backtest.
          </p>

          {data.tested ? (
            <div className="space-y-2" data-testid="quant-backtest-windows">
              {data.windows.map((w) => (
                <BacktestWindowCard
                  key={w.key}
                  w={w}
                  benchmarkSymbol={data.benchmarkSymbol}
                />
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              No window had enough historical price coverage to evaluate.
            </p>
          )}

          <details className="text-[10px] text-muted-foreground" data-testid="quant-backtest-method">
            <summary className="cursor-pointer select-none">Methodology & limitations</summary>
            <p className="mt-1 leading-relaxed">{data.methodology}</p>
            <ul className="mt-1 space-y-0.5 list-disc pl-4">
              {data.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            <p className="mt-1 italic">{data.disclaimer}</p>
          </details>
        </div>
      )}
    </div>
  );
}

function fmtPctVal(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function ActionSignalPanel({
  ticker,
  headless = false,
  // Which nested blocks to render inline. Defaults to all-true for the legacy
  // full-card usage. The Dashboard accordion turns these off and renders Quant
  // Score / Scenario / Backtest as their own discrete rows from the same data.
  include = { quantScore: true, conviction: true, backtest: true },
  // Supporting detail rendered after the triggers — used by the Dashboard to
  // fold the legacy buy/sell signal + risk view into the Model Action body.
  supporting,
}: {
  ticker: string;
  headless?: boolean;
  include?: { quantScore?: boolean; conviction?: boolean; backtest?: boolean };
  supporting?: React.ReactNode;
}) {
  const query = useIdeaActionSignal(ticker);
  const data = query.data;

  return (
    <div
      className={
        headless
          ? "space-y-3"
          : "rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      }
      data-testid="action-signal-panel"
    >
      {!headless && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary/80" aria-hidden />
            Action signal (rules-based research)
          </div>
          {data && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded border text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5",
                  actionTone(data.action),
                )}
                data-testid="action-signal-label"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {data.action}
              </span>
              <span
                className={cn("text-[11px] uppercase tracking-wide tabular-nums", confidenceTone(data.confidence))}
                data-testid="action-signal-confidence"
              >
                {data.confidence} · {data.compositeScore}
              </span>
            </div>
          )}
        </div>
      )}

      {query.isLoading ? (
        <Skeleton className="h-[200px] rounded-md" data-testid="action-signal-loading" />
      ) : query.isError ? (
        <div className="text-xs text-muted-foreground" data-testid="action-signal-error">
          Action signal unavailable: {(query.error as Error)?.message ?? "unknown"}
        </div>
      ) : !data ? null : (
        <>
          <p className="text-[12px] text-foreground/90 leading-relaxed" data-testid="action-signal-summary">
            {data.summary}
          </p>

          {include.quantScore && data.quantScore && <QuantScoreBlock q={data.quantScore} />}

          {include.conviction && data.conviction && <ConvictionSignalBlock c={data.conviction} />}

          {include.backtest && <QuantBacktestPanel />}

          {data.notes.length > 0 && (
            <ul className="space-y-0.5 text-[10px] text-amber-500" data-testid="action-signal-notes">
              {data.notes.map((n) => (
                <li key={n} className="flex items-start gap-1.5">
                  <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Factor scorecard */}
          <div data-testid="action-signal-scorecard">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Factor scorecard
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.factors.map((f) => (
                <FactorRow key={f.key} f={f} />
              ))}
            </div>
          </div>

          {/* Agreement vs analysts */}
          <div
            className="rounded border border-border/60 bg-background/40 px-3 py-2 text-[11px] flex items-start gap-2"
            data-testid="action-signal-agreement"
          >
            <ScaleIcon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">
                  Internal: <span className="text-foreground font-medium">{data.action}</span>
                </span>
                <span className="text-muted-foreground">
                  Analysts:{" "}
                  <span className="text-foreground font-medium">
                    {data.agreement.analystStance
                      ? data.analystConsensus?.consensusLabel ?? data.agreement.analystStance
                      : "no coverage"}
                  </span>
                </span>
                <span className={cn("font-medium", agreementTone(data.agreement.agreement))}>
                  {data.agreement.agreement.replace(/-/g, " ")}
                </span>
              </div>
              <p className="text-muted-foreground leading-relaxed">{data.agreement.note}</p>
            </div>
          </div>

          {/* Upgrade / downgrade triggers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div data-testid="action-signal-upgrade">
              <div className="text-[10px] uppercase tracking-wide text-pos mb-1 flex items-center gap-1">
                <ArrowUpCircle className="h-3 w-3" /> What would upgrade this
              </div>
              <ul className="space-y-1 text-[11px]">
                {data.upgradeTriggers.map((t) => (
                  <li key={t} className="flex items-start gap-1.5" data-testid="action-upgrade-trigger">
                    <ArrowUpCircle className="h-3 w-3 mt-0.5 shrink-0 text-pos/70" />
                    <span className="text-foreground/90">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div data-testid="action-signal-downgrade">
              <div className="text-[10px] uppercase tracking-wide text-neg mb-1 flex items-center gap-1">
                <ArrowDownCircle className="h-3 w-3" /> What would downgrade this
              </div>
              <ul className="space-y-1 text-[11px]">
                {data.downgradeTriggers.map((t) => (
                  <li key={t} className="flex items-start gap-1.5" data-testid="action-downgrade-trigger">
                    <ArrowDownCircle className="h-3 w-3 mt-0.5 shrink-0 text-neg/70" />
                    <span className="text-foreground/90">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground" data-testid="action-signal-legacy">
            Legacy timing signal: <span className="font-medium text-foreground/80">{data.legacySignal}</span>
          </div>

          {supporting}
        </>
      )}

      <p className="text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Rules-based research that blends momentum, valuation, quality, growth,
          risk and analyst consensus into one explainable label. Not financial
          advice and no LLM in this calculation.
        </span>
      </p>
    </div>
  );
}

// =============================================================================
// At-a-glance headline summaries for the detail-pane signal accordion. Each one
// reads the same shared per-ticker query cache as its panel body (no extra
// fetch) and renders a compact verdict pill / score for the collapsed row. They
// degrade to a muted "—" / "Loading" / "N/A" while pending or unavailable.
// =============================================================================

function HeadlinePill({ label, className, testId }: { label: string; className: string; testId?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5",
        className,
      )}
      data-testid={testId}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function HeadlineMuted({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-muted-foreground tabular-nums">{children}</span>;
}

// Model Action — the consolidated final decision (Hold / Starter / Add / Trim /
// Avoid) with its confidence. Reads the action-signal cache.
export function ModelActionHeadline({ ticker }: { ticker: string }) {
  const { data, isLoading, isError } = useIdeaActionSignal(ticker);
  if (isLoading) return <HeadlineMuted>Loading…</HeadlineMuted>;
  if (isError || !data) return <HeadlineMuted>Unavailable</HeadlineMuted>;
  return (
    <>
      <HeadlinePill label={data.action} className={actionTone(data.action)} testId="headline-action-label" />
      <HeadlineMuted>
        {data.confidence} · {data.compositeScore}
      </HeadlineMuted>
    </>
  );
}

// Quant Score — score and band, e.g. "74/100 Constructive".
export function QuantScoreHeadline({ ticker }: { ticker: string }) {
  const { data, isLoading, isError } = useIdeaActionSignal(ticker);
  if (isLoading) return <HeadlineMuted>Loading…</HeadlineMuted>;
  if (isError || !data || !data.quantScore) return <HeadlineMuted>N/A</HeadlineMuted>;
  const q = data.quantScore;
  return (
    <>
      <span className="text-[11px] font-semibold tabular-nums text-foreground" data-testid="headline-quant-score">
        {q.overall == null ? "—" : q.overall}
        <span className="text-[10px] font-normal text-muted-foreground">/100</span>
      </span>
      <HeadlinePill label={q.bandLabel} className={quantBandTone(q.band)} testId="headline-quant-band" />
    </>
  );
}

// Scenario — Bear / Base / Bull implied returns plus the derivation method,
// e.g. "Bear -18% · Base +42% · Bull +110% · Fundamentals-driven".
export function ScenarioHeadline({ model }: { model: ScenarioModel | null | undefined }) {
  if (!model) return <HeadlineMuted>Unavailable</HeadlineMuted>;
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v)}%`;
  const methodLabel =
    model.method === "fundamentals-driven"
      ? "Fundamentals-driven"
      : model.method === "hybrid"
        ? "Hybrid"
        : model.method === "fallback-heuristic"
          ? "Heuristic"
          : null;
  return (
    <>
      <span className="text-[11px] tabular-nums" data-testid="headline-scenario-cases">
        <span className="text-neg">Bear {pct(model.bear.outputs.impliedReturnPct)}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="text-foreground">Base {pct(model.base.outputs.impliedReturnPct)}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="text-pos">Bull {pct(model.bull.outputs.impliedReturnPct)}</span>
      </span>
      {methodLabel && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground" data-testid="headline-scenario-method">
          {methodLabel}
        </span>
      )}
    </>
  );
}

// Buffett — quality/value verdict. Reuses the panel's own `label` (e.g. "High
// quality, expensive" / "Mixed" / "Pass") plus the score, or a "not meaningful"
// state for ETFs / funds / non-operating issuers.
export function BuffettHeadline({ ticker }: { ticker: string }) {
  const { data, isLoading, isError } = useIdeaBuffett(ticker);
  if (isLoading) return <HeadlineMuted>Loading…</HeadlineMuted>;
  if (isError || !data) return <HeadlineMuted>Unavailable</HeadlineMuted>;
  if (!buffettScoreIsMeaningful(data)) {
    return <HeadlineMuted>Insufficient data</HeadlineMuted>;
  }
  return (
    <>
      <span className="text-[11px] font-medium text-foreground" data-testid="headline-buffett-label">
        {data.label}
      </span>
      <span
        className={cn("text-[11px] uppercase tracking-wide tabular-nums", scoreTone(data.overallScore))}
        data-testid="headline-buffett-score"
      >
        {data.overallScore == null ? "N/A" : `${data.overallScore.toFixed(0)}/100`}
      </span>
    </>
  );
}

// Analyst Consensus — Buy/Hold/Sell verdict and analyst count / bullish percent.
export function AnalystHeadline({ ticker }: { ticker: string }) {
  const { data, isLoading, isError } = useIdeaAnalystConsensus(ticker);
  if (isLoading) return <HeadlineMuted>Loading…</HeadlineMuted>;
  if (isError || !data || data.status !== "available") {
    return <HeadlineMuted>No coverage</HeadlineMuted>;
  }
  return (
    <>
      <HeadlinePill
        label={data.consensusLabel ?? "—"}
        className={consensusTone(data.consensusLabel)}
        testId="headline-analyst-label"
      />
      <HeadlineMuted>
        {data.totalAnalysts} analysts
        {data.bullishPercent != null ? ` · ${data.bullishPercent}% bull` : ""}
      </HeadlineMuted>
    </>
  );
}

// Backtest Evidence — the universe-wide technical-only validation badge, e.g.
// "Technical-only" + run / not-run state. Reads the shared backtest cache only
// if it has already been fetched (it is lazy), otherwise shows "Technical-only".
export function BacktestHeadline() {
  const data = queryClient.getQueryData<QuantBacktestResponse>(["/api/quant-score/backtest"]);
  if (!data) {
    return <HeadlineMuted>Technical-only</HeadlineMuted>;
  }
  return (
    <>
      <span
        className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500"
        data-testid="headline-backtest-badge"
      >
        {data.validationBadge}
      </span>
      <HeadlineMuted>{data.tested ? "Run" : "Not validated"}</HeadlineMuted>
    </>
  );
}
