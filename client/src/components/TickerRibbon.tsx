import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TickerResponse, TickerItem } from "@shared/schema";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

// Moving price ribbon for the Watchlist & Conviction Dashboard. Items are
// sourced from the conviction watchlist's enriched key metrics via
// /api/conviction-ticker (deployment-safe; no raw fetch). Clicking an item
// selects that ticker in the workspace. The marquee uses the shared
// `.ticker-track` CSS, which pauses on hover and disables motion for users who
// prefer reduced motion. Degrades to null when no priced items are available.
export function TickerRibbon({
  selectedTicker,
  onSelect,
  intervalMs = 60_000,
}: {
  selectedTicker?: string | null;
  onSelect?: (ticker: string) => void;
  intervalMs?: number | false;
}) {
  const { data, isLoading } = useQuery<TickerResponse>({
    queryKey: ["/api/conviction-ticker"],
    refetchInterval: intervalMs,
  });

  const items = data?.items ?? [];

  // Duration scales with item count so the per-item speed feels consistent.
  const duration = useMemo(() => {
    const n = Math.max(items.length, 1);
    return Math.max(30, Math.min(140, n * 7));
  }, [items.length]);

  if (isLoading && items.length === 0) {
    return (
      <div
        className="border-b border-border bg-card/40 h-9 flex items-center px-4 shrink-0"
        data-testid="ticker-ribbon-loading"
      >
        <span className="text-[11px] text-muted-foreground">
          Loading ticker…
        </span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className="border-b border-border bg-card/40 h-9 flex items-center px-4 shrink-0"
        data-testid="ticker-ribbon-empty"
      >
        <span className="text-[11px] text-muted-foreground">
          Live ticker unavailable — pricing will appear when providers respond.
        </span>
      </div>
    );
  }

  return (
    <div
      className="border-b border-border bg-card/40 overflow-hidden relative shrink-0"
      data-testid="ticker-ribbon"
      aria-label="Live watchlist price ticker"
    >
      {/* Edge fade masks */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-card/80 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card/80 to-transparent z-10" />
      <div
        className="ticker-track flex items-center gap-0 whitespace-nowrap py-1.5"
        style={{ ["--ticker-duration" as never]: `${duration}s` }}
      >
        <RibbonRow items={items} selectedTicker={selectedTicker} onSelect={onSelect} />
        <RibbonRow
          items={items}
          selectedTicker={selectedTicker}
          onSelect={onSelect}
          ariaHidden
        />
      </div>
    </div>
  );
}

function RibbonRow({
  items,
  selectedTicker,
  onSelect,
  ariaHidden,
}: {
  items: TickerItem[];
  selectedTicker?: string | null;
  onSelect?: (ticker: string) => void;
  ariaHidden?: boolean;
}) {
  return (
    <div className="flex items-center shrink-0" aria-hidden={ariaHidden}>
      {items.map((it) => (
        <RibbonCell
          key={`${ariaHidden ? "b" : "a"}-${it.symbol}`}
          item={it}
          isSelected={selectedTicker === it.symbol}
          onSelect={onSelect}
          tabbable={!ariaHidden}
        />
      ))}
    </div>
  );
}

function RibbonCell({
  item,
  isSelected,
  onSelect,
  tabbable,
}: {
  item: TickerItem;
  isSelected: boolean;
  onSelect?: (ticker: string) => void;
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

  return (
    <button
      type="button"
      onClick={() => onSelect?.(item.symbol)}
      tabIndex={tabbable ? 0 : -1}
      aria-hidden={tabbable ? undefined : true}
      data-testid={`ticker-ribbon-item-${item.symbol}`}
      className={cn(
        "group inline-flex items-center gap-2 px-3 py-1 mx-0.5 rounded text-[12px] tabular-nums",
        "hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected && "bg-accent/30",
      )}
      title={`${item.displayName} · 1m ${fmtPct(item.changePct1d, 1)}`}
    >
      <span className="mono font-medium text-foreground/90">{item.symbol}</span>
      <span className="text-foreground/80">
        {fmtPrice(item.price, item.currency)}
      </span>
      <span className={cn("font-medium", tone)}>
        {fmtPct(item.changePct1d, 1)}
      </span>
    </button>
  );
}
