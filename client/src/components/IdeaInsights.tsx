import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ActionFactor,
  ActionLabel,
  ActionSignal,
  AnalystConsensus,
  BuffettCategory,
  BuffettIndex,
  EquityFundamentals,
  FactorVerdict,
  ModelSignal,
  ManagementGovernance,
  SignalLabel,
  ConfidenceLabel,
} from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
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

export function BuffettConvictionPanel({ ticker }: { ticker: string }) {
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
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="buffett-index-panel"
    >
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
export function SignalConvictionPanel({ ticker }: { ticker: string }) {
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
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="signal-indicator"
    >
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="signal-levels">
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
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Reward / risk</div>
              <div className="tabular-nums font-semibold text-sm mt-0.5">
                {signal.rewardRiskRatio != null ? `${signal.rewardRiskRatio.toFixed(2)}×` : "—"}
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

export function RiskConvictionPanel({ ticker }: { ticker: string }) {
  const query = useIdeaSignal(ticker);
  const signal = query.data;
  const risk = useMemo(() => deriveRisk(signal), [signal]);

  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="risk-indicator"
    >
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

export function AnalystConsensusPanel({ ticker }: { ticker: string }) {
  const query = useIdeaAnalystConsensus(ticker);
  const data = query.data;
  const available = data?.status === "available";

  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="analyst-consensus-panel"
    >
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

export function ActionSignalPanel({ ticker }: { ticker: string }) {
  const query = useIdeaActionSignal(ticker);
  const data = query.data;

  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="action-signal-panel"
    >
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
