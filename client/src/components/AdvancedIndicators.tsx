import type { InstrumentSnapshot } from "@shared/schema";
import { fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Activity, GitCompare, TrendingDown } from "lucide-react";

/**
 * "Risk & Relative" panel — second-tier indicators that complement the
 * primary IndicatorPanel. All values are computed server-side from price
 * history and clearly mark themselves as N/A when data is insufficient
 * (e.g. < 30 paired returns vs BTC, or self-reference for BTC itself).
 */

function Cell({
  label,
  value,
  sub,
  tone,
  testId,
  unavailable,
  unavailableHint,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  testId?: string;
  unavailable?: boolean;
  unavailableHint?: string;
}) {
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-3 py-2 min-w-0"
      data-testid={testId}
      data-unavailable={unavailable ? "true" : undefined}
    >
      <div className="text-[10px] tracking-widest uppercase text-muted-foreground truncate">
        {label}
      </div>
      <div
        className={cn(
          "tabular-nums font-semibold text-sm mt-0.5 truncate",
          tone,
          unavailable && "text-muted-foreground/70",
        )}
      >
        {unavailable ? "N/A" : value}
      </div>
      {(unavailable ? unavailableHint : sub) != null && (
        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
          {unavailable ? unavailableHint : sub}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  testId,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="rounded-md border border-card-border bg-card flex flex-col"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 border-b border-card-border px-4 py-2.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[11px] font-semibold tracking-widest uppercase">
          {title}
        </span>
      </div>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5">{children}</div>
    </div>
  );
}

function corrTone(v: number | null): string {
  if (v == null) return "";
  const abs = Math.abs(v);
  if (abs >= 0.7) return "text-primary";
  if (abs <= 0.2) return "text-muted-foreground";
  return "";
}

function relPerfTone(v: number | null): string {
  if (v == null) return "";
  return v > 0 ? "text-pos" : v < 0 ? "text-neg" : "";
}

export function AdvancedIndicators({ snap }: { snap: InstrumentSnapshot }) {
  const benchLabel = "BTC";
  const isSelf = snap.relIsSelf;
  const ddDays = snap.maxDrawdownLookbackDays;
  const ddSub =
    ddDays != null
      ? `over ${ddDays} bars (~${Math.round(ddDays / 252)}y)`
      : undefined;

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-2 gap-3"
      data-testid="advanced-indicators"
    >
      <Section
        title="Risk"
        icon={<TrendingDown className="h-3.5 w-3.5" />}
        testId="section-risk"
      >
        <Cell
          label="Max Drawdown"
          value={
            <span
              className={cn(
                snap.maxDrawdownPct != null && snap.maxDrawdownPct <= -25
                  ? "text-neg"
                  : "",
              )}
            >
              {fmtPct(snap.maxDrawdownPct, 1)}
            </span>
          }
          sub={ddSub}
          unavailable={snap.maxDrawdownPct == null}
          unavailableHint="needs price history"
          testId="metric-max-drawdown"
        />
        <Cell
          label="Vol-Adj Return (30D)"
          value={fmtNum(snap.sharpeLike30d, 2)}
          sub="annualized, rf=0"
          unavailable={snap.sharpeLike30d == null}
          unavailableHint="needs ≥ 30 returns"
          testId="metric-sharpe-30d"
        />
        <Cell
          label="Vol 30D ann."
          value={fmtPct(snap.vol30dAnnualized, 1, false)}
          sub="σ of log returns"
          unavailable={snap.vol30dAnnualized == null}
          unavailableHint="needs ≥ 30 bars"
          testId="metric-vol-30d-adv"
        />
      </Section>

      <Section
        title={`Relative to ${benchLabel}`}
        icon={<GitCompare className="h-3.5 w-3.5" />}
        testId="section-relative"
      >
        <Cell
          label={`Rel. perf 30D vs ${benchLabel}`}
          value={
            <span className={relPerfTone(snap.relPerf30d)}>
              {fmtPct(snap.relPerf30d, 1)}
            </span>
          }
          sub="asset − BTC return"
          unavailable={isSelf || snap.relPerf30d == null}
          unavailableHint={isSelf ? "self-reference" : "insufficient history"}
          testId="metric-relperf-30d"
        />
        <Cell
          label={`Rel. perf 90D vs ${benchLabel}`}
          value={
            <span className={relPerfTone(snap.relPerf90d)}>
              {fmtPct(snap.relPerf90d, 1)}
            </span>
          }
          sub="asset − BTC return"
          unavailable={isSelf || snap.relPerf90d == null}
          unavailableHint={isSelf ? "self-reference" : "insufficient history"}
          testId="metric-relperf-90d"
        />
        <Cell
          label={`Corr 30D to ${benchLabel}`}
          value={
            <span className={corrTone(snap.corrToBtc30d)}>
              {fmtNum(snap.corrToBtc30d, 2)}
            </span>
          }
          sub="Pearson, log returns"
          unavailable={isSelf || snap.corrToBtc30d == null}
          unavailableHint={
            isSelf ? "self-reference" : "needs ≥ 10 paired returns"
          }
          testId="metric-corr-30d"
        />
        <Cell
          label={`Corr 90D to ${benchLabel}`}
          value={
            <span className={corrTone(snap.corrToBtc90d)}>
              {fmtNum(snap.corrToBtc90d, 2)}
            </span>
          }
          sub="Pearson, log returns"
          unavailable={isSelf || snap.corrToBtc90d == null}
          unavailableHint={
            isSelf ? "self-reference" : "needs ≥ 10 paired returns"
          }
          testId="metric-corr-90d"
        />
        <Cell
          label={`Beta 30D to ${benchLabel}`}
          value={fmtNum(snap.betaToBtc30d, 2)}
          sub="OLS slope"
          unavailable={isSelf || snap.betaToBtc30d == null}
          unavailableHint={
            isSelf ? "self-reference" : "needs ≥ 10 paired returns"
          }
          testId="metric-beta-30d"
        />
        <Cell
          label={`Beta 90D to ${benchLabel}`}
          value={fmtNum(snap.betaToBtc90d, 2)}
          sub="OLS slope"
          unavailable={isSelf || snap.betaToBtc90d == null}
          unavailableHint={
            isSelf ? "self-reference" : "needs ≥ 10 paired returns"
          }
          testId="metric-beta-90d"
        />
      </Section>
    </div>
  );
}
