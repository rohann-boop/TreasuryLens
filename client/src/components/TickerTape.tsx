import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TickerResponse, TickerItem } from "@shared/schema";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Horizontal ticker strip that scrolls instrument prices across the top of
 * the dashboard. Items are clickable; clicking selects the instrument.
 *
 * The strip auto-refreshes via TanStack Query at the same cadence as the
 * dashboard's auto-refresh interval (passed in as `intervalMs`). When the
 * user prefers reduced motion, the scroll animation is disabled by CSS.
 */
export function TickerTape({
  selectedId,
  onSelect,
  intervalMs,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  intervalMs: number | false;
}) {
  const { data, isLoading } = useQuery<TickerResponse>({
    queryKey: ["/api/ticker"],
    refetchInterval: intervalMs,
  });

  const items = data?.items ?? [];

  // Duration scales with item count so the per-item speed feels consistent
  // regardless of how many instruments are in the watchlist.
  const duration = useMemo(() => {
    const n = Math.max(items.length, 1);
    return Math.max(30, Math.min(120, n * 8));
  }, [items.length]);

  if (isLoading && items.length === 0) {
    return (
      <div
        className="border-b border-border bg-card/40 h-9 flex items-center px-4"
        data-testid="ticker-tape-loading"
      >
        <span className="text-[11px] text-muted-foreground">
          Loading ticker…
        </span>
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  // Two copies of the track for a seamless loop.
  return (
    <div
      className="border-b border-border bg-card/40 overflow-hidden relative"
      data-testid="ticker-tape"
      aria-label="Live price ticker"
    >
      {/* Edge fade masks */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-card/80 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card/80 to-transparent z-10" />
      <div
        className="ticker-track flex items-center gap-0 whitespace-nowrap py-1.5"
        style={{ ["--ticker-duration" as never]: `${duration}s` }}
      >
        <TickerRow items={items} selectedId={selectedId} onSelect={onSelect} />
        <TickerRow
          items={items}
          selectedId={selectedId}
          onSelect={onSelect}
          ariaHidden
        />
      </div>
    </div>
  );
}

function TickerRow({
  items,
  selectedId,
  onSelect,
  ariaHidden,
}: {
  items: TickerItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  ariaHidden?: boolean;
}) {
  return (
    <div
      className="flex items-center shrink-0"
      aria-hidden={ariaHidden}
    >
      {items.map((it) => (
        <TickerCell
          key={`${ariaHidden ? "b" : "a"}-${it.id}`}
          item={it}
          isSelected={selectedId === it.id}
          onSelect={onSelect}
          tabbable={!ariaHidden}
        />
      ))}
    </div>
  );
}

function TickerCell({
  item,
  isSelected,
  onSelect,
  tabbable,
}: {
  item: TickerItem;
  isSelected: boolean;
  onSelect: (id: number) => void;
  tabbable: boolean;
}) {
  const tone =
    item.changePct1d == null
      ? "text-muted-foreground"
      : item.changePct1d > 0
      ? "text-pos"
      : item.changePct1d < 0
      ? "text-neg"
      : "text-muted-foreground";

  const dotTone =
    item.status === "live"
      ? "bg-pos"
      : item.status === "demo"
      ? "bg-warn"
      : "bg-neg";

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      tabIndex={tabbable ? 0 : -1}
      aria-hidden={tabbable ? undefined : true}
      data-testid={`ticker-item-${item.id}`}
      className={cn(
        "group inline-flex items-center gap-2 px-3 py-1 mx-0.5 rounded text-[12px] tabular-nums",
        "hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected && "bg-accent/30",
      )}
      title={`${item.displayName} · ${item.status === "live" ? "Live" : item.status === "demo" ? "Demo" : "Error"} · ${item.source}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          dotTone,
          item.status === "live" && "animate-pulse",
        )}
        aria-label={
          item.status === "live"
            ? "Live data"
            : item.status === "demo"
            ? "Demo data"
            : "Data error"
        }
      />
      <span className="mono font-medium text-foreground/90">
        {item.symbol}
      </span>
      <span className="text-foreground/80">
        {fmtPrice(item.price, item.currency)}
      </span>
      <span className={cn("font-medium", tone)}>
        {fmtPct(item.changePct1d, 2)}
      </span>
    </button>
  );
}
