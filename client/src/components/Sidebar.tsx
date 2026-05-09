import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Bitcoin, LineChart, BarChart3, Trash2, PanelLeftClose } from "lucide-react";
import type { Instrument, InstrumentSnapshot } from "@shared/schema";
import { fmtPrice } from "@/lib/format";
import { Delta } from "@/components/Delta";
import { WordMark } from "@/components/Logo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function AssetIcon({ assetClass }: { assetClass: string }) {
  if (assetClass === "crypto")
    return <Bitcoin className="h-3.5 w-3.5 text-warn" />;
  if (assetClass === "equity")
    return <LineChart className="h-3.5 w-3.5 text-primary" />;
  return <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function Sidebar({
  instruments,
  selectedId,
  onSelect,
  onAdd,
  onCollapse,
}: {
  instruments: Instrument[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onCollapse?: () => void;
}) {
  const { data: snaps = [] } = useQuery<InstrumentSnapshot[]>({
    queryKey: ["/api/snapshots"],
    refetchInterval: 60_000,
  });
  const { toast } = useToast();
  const snapById = new Map(snaps.map((s) => [s.instrument.id, s]));

  const remove = async (id: number, name: string) => {
    try {
      await apiRequest("DELETE", `/api/instruments/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/instruments"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/snapshots"] });
      toast({ title: `Removed ${name}` });
    } catch (e) {
      toast({ title: "Failed to remove", variant: "destructive" });
    }
  };

  return (
    <aside
      className="flex flex-col h-full bg-sidebar border-r border-sidebar-border w-[260px] shrink-0"
      data-testid="sidebar"
    >
      <div className="px-3 h-14 flex items-center justify-between gap-2 border-b border-sidebar-border">
        <div className="pl-1"><WordMark /></div>
        {onCollapse && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            data-testid="button-sidebar-collapse"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="px-3 py-3 flex items-center justify-between border-b border-sidebar-border">
        <span className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
          Watchlist
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onAdd}
          data-testid="button-add-instrument"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <ul className="p-2 space-y-1">
          {instruments.length === 0 && (
            <li className="px-3 py-6 text-xs text-muted-foreground text-center">
              No instruments yet. Add one to get started.
            </li>
          )}
          {instruments.map((inst) => {
            const snap = snapById.get(inst.id);
            const active = selectedId === inst.id;
            return (
              <li key={inst.id}>
                <button
                  onClick={() => onSelect(inst.id)}
                  data-testid={`button-instrument-${inst.id}`}
                  className={cn(
                    "group w-full flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left hover-elevate active-elevate-2 border",
                    active
                      ? "bg-sidebar-accent border-sidebar-accent-border"
                      : "border-transparent",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AssetIcon assetClass={inst.assetClass} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {inst.displayName}
                      </div>
                      <div className="mono text-[11px] text-muted-foreground truncate">
                        {inst.symbol}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end">
                    <div
                      className="mono text-[12px] font-medium"
                      data-testid={`text-price-${inst.id}`}
                    >
                      {snap ? fmtPrice(snap.price, snap.currency) : "—"}
                    </div>
                    {snap && <Delta value={snap.changePct1d} showArrow={false} digits={2} />}
                  </div>
                  {!inst.pinned && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${inst.displayName}`}
                      data-testid={`button-remove-${inst.id}`}
                      className="hidden group-hover:inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(inst.id, inst.displayName);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          remove(inst.id, inst.displayName);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      <div className="p-3 border-t border-sidebar-border text-[10px] text-muted-foreground leading-relaxed">
        Data via Yahoo Finance & CoinGecko. Indicators computed locally. Not
        investment advice.
      </div>
    </aside>
  );
}
