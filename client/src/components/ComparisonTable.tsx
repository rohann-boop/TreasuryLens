import type { InstrumentSnapshot } from "@shared/schema";
import { fmtPrice, fmtPct, fmtCompact, fmtNum } from "@/lib/format";
import { Delta } from "@/components/Delta";
import { cn } from "@/lib/utils";

export function ComparisonTable({
  snaps,
  onSelect,
  selectedId,
}: {
  snaps: InstrumentSnapshot[];
  onSelect: (id: number) => void;
  selectedId: number | null;
}) {
  return (
    <div
      className="rounded-md border border-card-border bg-card overflow-hidden"
      data-testid="comparison-table"
    >
      <div className="border-b border-card-border px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">
          Watchlist Snapshot
        </span>
        <span className="text-[10px] text-muted-foreground">
          {snaps.length} {snaps.length === 1 ? "instrument" : "instruments"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] tracking-wider uppercase text-muted-foreground border-b border-border/60">
              <th className="px-4 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium text-right">Price</th>
              <th className="px-3 py-2 font-medium text-right">1D</th>
              <th className="px-3 py-2 font-medium text-right">7D</th>
              <th className="px-3 py-2 font-medium text-right">30D</th>
              <th className="px-3 py-2 font-medium text-right">YTD</th>
              <th className="px-3 py-2 font-medium text-right">RSI 14</th>
              <th className="px-3 py-2 font-medium text-right">Vol 30D</th>
              <th className="px-3 py-2 font-medium text-right hidden lg:table-cell">Max DD</th>
              <th className="px-3 py-2 font-medium text-right hidden lg:table-cell">β 90D BTC</th>
              <th className="px-3 py-2 font-medium text-right hidden md:table-cell">52W↓</th>
              <th className="px-3 py-2 font-medium text-right hidden md:table-cell">Mkt Cap</th>
              <th className="px-3 py-2 font-medium text-right hidden md:table-cell">P/E</th>
              <th className="px-3 py-2 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {snaps.map((s) => (
              <tr
                key={s.instrument.id}
                onClick={() => onSelect(s.instrument.id)}
                data-testid={`row-instrument-${s.instrument.id}`}
                className={cn(
                  "border-b border-border/40 cursor-pointer hover-elevate",
                  selectedId === s.instrument.id && "bg-accent/20",
                )}
              >
                <td className="px-4 py-2">
                  <div className="font-medium">{s.instrument.displayName}</div>
                  <div className="mono text-[11px] text-muted-foreground">
                    {s.instrument.symbol}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {fmtPrice(s.price, s.currency)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Delta value={s.changePct1d} showArrow={false} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Delta value={s.return7d} showArrow={false} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Delta value={s.return30d} showArrow={false} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Delta value={s.returnYtd} showArrow={false} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {s.rsi14 != null ? s.rsi14.toFixed(0) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {fmtPct(s.vol30dAnnualized, 0, false)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums hidden lg:table-cell",
                    s.maxDrawdownPct != null && s.maxDrawdownPct <= -25
                      ? "text-neg"
                      : "text-muted-foreground",
                  )}
                  data-testid={`cell-mdd-${s.instrument.id}`}
                >
                  {s.maxDrawdownPct != null
                    ? fmtPct(s.maxDrawdownPct, 0)
                    : "—"}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums text-muted-foreground hidden lg:table-cell"
                  data-testid={`cell-beta-${s.instrument.id}`}
                >
                  {s.relIsSelf
                    ? "—"
                    : s.betaToBtc90d != null
                    ? fmtNum(s.betaToBtc90d, 2)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                  <span className={cn(s.distFrom52wHigh != null && s.distFrom52wHigh <= -25 ? "text-neg" : "text-muted-foreground")}>
                    {fmtPct(s.distFrom52wHigh, 1)}
                  </span>
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums text-muted-foreground hidden md:table-cell"
                  data-testid={`cell-mcap-${s.instrument.id}`}
                >
                  {s.marketCap != null
                    ? `${s.currency === "JPY" ? "¥" : "$"}${fmtCompact(s.marketCap)}`
                    : "—"}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums text-muted-foreground hidden md:table-cell"
                  data-testid={`cell-pe-${s.instrument.id}`}
                >
                  {s.peRatio != null ? fmtNum(s.peRatio, 1) : "N/A"}
                </td>
                <td className="px-3 py-2 text-right">
                  <StatusBadge status={s.status} source={s.source} />
                </td>
              </tr>
            ))}
            {snaps.length === 0 && (
              <tr>
                <td
                  colSpan={14}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No instruments to compare.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatusBadge({
  status,
  source,
}: {
  status: "live" | "demo" | "error";
  source: string;
}) {
  const tone =
    status === "live"
      ? "border-pos/30 bg-pos/10 text-pos"
      : status === "demo"
      ? "border-warn/30 bg-warn/10 text-warn"
      : "border-neg/30 bg-neg/10 text-neg";
  const label =
    status === "live"
      ? `Live · ${source}`
      : status === "demo"
      ? `Demo · ${source}`
      : "Error";
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-medium tracking-wide uppercase border rounded px-1.5 py-0.5",
        tone,
      )}
      data-testid="status-badge"
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full mr-1",
          status === "live" ? "bg-pos animate-pulse" : status === "demo" ? "bg-warn" : "bg-neg",
        )}
      />
      {label}
    </span>
  );
}
