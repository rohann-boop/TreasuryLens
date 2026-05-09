import type { InstrumentSnapshot } from "@shared/schema";
import { fmtCompact, fmtNum, fmtPct, fmtPrice } from "@/lib/format";
import { TrendBadge } from "@/components/Delta";
import { cn } from "@/lib/utils";

function Row({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/50 last:border-b-0"
      data-testid={testId}
    >
      <span className="text-[11px] text-muted-foreground tracking-wide uppercase">
        {label}
      </span>
      <span className="text-right">
        <span className="tabular-nums font-medium text-sm">{value}</span>
        {sub != null && (
          <span className="block text-[10px] text-muted-foreground tabular-nums">
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-card-border bg-card p-3 flex flex-col">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-2">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function rsiTone(rsi: number | null): string {
  if (rsi == null) return "";
  if (rsi >= 70) return "text-warn";
  if (rsi <= 30) return "text-primary";
  return "";
}

function rsiLabel(rsi: number | null): string {
  if (rsi == null) return "—";
  if (rsi >= 70) return "Overbought";
  if (rsi <= 30) return "Oversold";
  return "Neutral";
}

export function IndicatorPanel({ snap }: { snap: InstrumentSnapshot }) {
  const dist52 = snap.distFrom52wHigh;
  const distTone =
    dist52 == null
      ? ""
      : dist52 >= -3
      ? "text-pos"
      : dist52 <= -25
      ? "text-neg"
      : "";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <Section title="Returns">
        <Row
          label="1D"
          value={
            <span
              className={cn(
                snap.changePct1d == null
                  ? ""
                  : snap.changePct1d >= 0
                  ? "text-pos"
                  : "text-neg",
              )}
            >
              {fmtPct(snap.changePct1d)}
            </span>
          }
          sub={fmtPrice(snap.change1d, snap.currency)}
          testId="row-return-1d"
        />
        <Row
          label="7D"
          value={
            <span
              className={cn(
                snap.return7d == null
                  ? ""
                  : snap.return7d >= 0
                  ? "text-pos"
                  : "text-neg",
              )}
            >
              {fmtPct(snap.return7d)}
            </span>
          }
          testId="row-return-7d"
        />
        <Row
          label="30D"
          value={
            <span
              className={cn(
                snap.return30d == null
                  ? ""
                  : snap.return30d >= 0
                  ? "text-pos"
                  : "text-neg",
              )}
            >
              {fmtPct(snap.return30d)}
            </span>
          }
          testId="row-return-30d"
        />
        <Row
          label="YTD"
          value={
            <span
              className={cn(
                snap.returnYtd == null
                  ? ""
                  : snap.returnYtd >= 0
                  ? "text-pos"
                  : "text-neg",
              )}
            >
              {fmtPct(snap.returnYtd)}
            </span>
          }
          testId="row-return-ytd"
        />
      </Section>

      <Section title="Trend (Moving Averages)">
        <Row
          label="SMA 20"
          value={fmtPrice(snap.sma20, snap.currency)}
          sub={<TrendBadge trend={snap.sma20Trend} label="SMA 20" />}
          testId="row-sma-20"
        />
        <Row
          label="SMA 50"
          value={fmtPrice(snap.sma50, snap.currency)}
          sub={<TrendBadge trend={snap.sma50Trend} label="SMA 50" />}
          testId="row-sma-50"
        />
        <Row
          label="SMA 200"
          value={fmtPrice(snap.sma200, snap.currency)}
          sub={<TrendBadge trend={snap.sma200Trend} label="SMA 200" />}
          testId="row-sma-200"
        />
      </Section>

      <Section title="Momentum & Risk">
        <Row
          label="RSI 14"
          value={
            <span className={rsiTone(snap.rsi14)}>{fmtNum(snap.rsi14, 1)}</span>
          }
          sub={rsiLabel(snap.rsi14)}
          testId="row-rsi"
        />
        <Row
          label="Vol 30D ann."
          value={fmtPct(snap.vol30dAnnualized, 1, false)}
          testId="row-volatility"
        />
        <Row
          label="52W High"
          value={fmtPrice(snap.high52w, snap.currency)}
          testId="row-52w-high"
        />
        <Row
          label="52W Low"
          value={fmtPrice(snap.low52w, snap.currency)}
          testId="row-52w-low"
        />
        <Row
          label="Distance from 52W High"
          value={
            <span className={distTone}>{fmtPct(dist52, 1)}</span>
          }
          testId="row-dist-52w"
        />
      </Section>

      <Section title="Fundamentals & Liquidity">
        <Row
          label="Market Cap"
          value={
            snap.marketCap != null ? `${snap.currency === "JPY" ? "¥" : "$"}${fmtCompact(snap.marketCap)}` : "—"
          }
          testId="row-mcap"
        />
        <Row
          label="P/E (TTM)"
          value={
            snap.peRatio != null ? (
              fmtNum(snap.peRatio, 2)
            ) : (
              <span className="text-muted-foreground">N/A</span>
            )
          }
          sub={
            snap.peRatio != null
              ? `via ${snap.peSource ?? "provider"}`
              : snap.instrument.assetClass === "crypto"
              ? "not applicable"
              : "provider unavailable"
          }
          testId="row-pe"
        />
        <Row
          label="Volume"
          value={fmtCompact(snap.volume)}
          testId="row-volume"
        />
        <Row
          label="Avg Volume (30D)"
          value={fmtCompact(snap.avgVolume)}
          testId="row-avg-volume"
        />
        {snap.btcDominance !== undefined && (
          <Row
            label="BTC Dominance"
            value={
              snap.btcDominance != null
                ? fmtPct(snap.btcDominance, 2, false)
                : <span className="text-muted-foreground">unavailable</span>
            }
            testId="row-btc-dominance"
          />
        )}
      </Section>
    </div>
  );
}
