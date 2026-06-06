import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Instrument, InstrumentSnapshot } from "@shared/schema";
import { Sidebar } from "@/components/Sidebar";
import { KpiCard } from "@/components/KpiCard";
import { Delta } from "@/components/Delta";
import { IndicatorPanel } from "@/components/IndicatorPanel";
import { AdvancedIndicators } from "@/components/AdvancedIndicators";
import { TreasuryPanel } from "@/components/TreasuryPanel";
import { PriceChart } from "@/components/PriceChart";
import { AddInstrumentDialog } from "@/components/AddInstrumentDialog";
import { ComparisonTable, StatusBadge } from "@/components/ComparisonTable";
import { TickerTape } from "@/components/TickerTape";
import { SignalLab } from "@/components/SignalLab";
import { BuffettIndexPanel } from "@/components/BuffettIndexPanel";
import {
  AutoRefreshControl,
  type RefreshInterval,
} from "@/components/AutoRefreshControl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  RefreshCcw,
  Sun,
  Moon,
  Plus,
  Menu,
  Bitcoin,
  Info,
  LineChart as LineIcon,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { fmtAgo, fmtCompact, fmtNum, fmtPrice } from "@/lib/format";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { WordMark } from "@/components/Logo";
import { MobileNav } from "@/components/MobileNav";
import { PrimaryNav } from "@/components/PrimaryNav";

function useTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);
  return { dark, setDark };
}

export default function Dashboard() {
  const { dark, setDark } = useTheme();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Desktop sidebar collapse — stored in React state only (no
  // localStorage in the sandboxed iframe). Mobile uses the Sheet trigger.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Default to 30s polling. State is in-memory only — no localStorage in the
  // sandboxed iframe.
  const [interval, setInterval] = useState<RefreshInterval>(30_000);
  const { toast } = useToast();

  const { data: instruments = [] } = useQuery<Instrument[]>({
    queryKey: ["/api/instruments"],
  });
  const { data: snaps = [], isLoading: snapsLoading } = useQuery<
    InstrumentSnapshot[]
  >({
    queryKey: ["/api/snapshots"],
    refetchInterval: interval,
  });

  // Default to first instrument
  useEffect(() => {
    if (selectedId == null && instruments.length > 0) {
      setSelectedId(instruments[0].id);
    }
  }, [instruments, selectedId]);

  const selected = useMemo(
    () => snaps.find((s) => s.instrument.id === selectedId) ?? null,
    [snaps, selectedId],
  );

  const lastUpdated = useMemo(() => {
    if (!snaps.length) return null;
    return Math.max(...snaps.map((s) => s.asOf));
  }, [snaps]);

  // Manual refresh bypasses the backend cache (`refresh=1`). Auto-refresh
  // hits the cached endpoint to avoid hammering Yahoo/CoinGecko.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await apiRequest("GET", "/api/snapshots?refresh=1");
      await queryClient.invalidateQueries({ queryKey: ["/api/snapshots"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/ticker"] });
      toast({ title: "Refreshed" });
    } catch (e) {
      toast({ title: "Refresh failed", variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  // Status mix for the explanatory copy line under the ticker.
  const liveCount = snaps.filter((s) => s.status === "live").length;
  const demoCount = snaps.filter((s) => s.status === "demo").length;
  const errorCount = snaps.filter((s) => s.status === "error").length;

  return (
    <div className="min-h-[100dvh] md:h-[100dvh] grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto_1fr] md:overflow-hidden bg-background text-foreground">
      {/* Sidebar (desktop) — collapsible. Hidden on mobile; mobile uses Sheet. */}
      <div className="row-span-3 hidden md:flex h-full overflow-hidden">
        {sidebarCollapsed ? (
          <CollapsedRail
            instruments={instruments}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onExpand={() => setSidebarCollapsed(false)}
            onAdd={() => setAddOpen(true)}
          />
        ) : (
          <Sidebar
            instruments={instruments}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={() => setAddOpen(true)}
            onCollapse={() => setSidebarCollapsed(true)}
          />
        )}
      </div>

      {/* Header */}
      <header className="col-start-2 min-w-0 h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile sidebar trigger */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" data-testid="button-mobile-menu">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[280px]">
              <Sidebar
                instruments={instruments}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                }}
                onAdd={() => setAddOpen(true)}
              />
            </SheetContent>
          </Sheet>
          <div className="md:hidden">
            <WordMark />
          </div>
          {selected && (
            <div className="hidden md:flex items-center gap-3 min-w-0">
              <AssetGlyph assetClass={selected.instrument.assetClass} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-semibold truncate" data-testid="text-selected-name">
                    {selected.instrument.displayName}
                  </h1>
                  <span className="mono text-xs text-muted-foreground">
                    {selected.instrument.symbol}
                  </span>
                  <StatusBadge status={selected.status} source={selected.source} />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden lg:inline text-[11px] text-muted-foreground" data-testid="text-last-updated">
            {lastUpdated ? `Updated ${fmtAgo(lastUpdated)}` : "—"}
          </span>
          <PrimaryNav className="mr-1" />
          <AutoRefreshControl
            interval={interval}
            onChange={setInterval}
            lastUpdated={lastUpdated}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={refresh}
            disabled={refreshing}
            data-testid="button-refresh"
            title="Refresh now (bypasses cache)"
          >
            <RefreshCcw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDark(!dark)}
            aria-label="Toggle theme"
            data-testid="button-theme"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            className="h-8 hidden sm:inline-flex"
            onClick={() => setAddOpen(true)}
            data-testid="button-header-add"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
      </header>

      {/* Ticker tape sits between the sticky header and main content. The
          outer container hugs the full content column so the bottom border
          spans the screen; the inner shell mirrors the dashboard
          `max-w-[1600px] mx-auto` so the scrolling track lines up with the
          KPI cards and tables at fullscreen widths. */}
      <div className="col-start-2 min-w-0 sticky top-14 z-10 border-b border-border bg-card/40 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-0">
          <TickerTape
            selectedId={selectedId}
            onSelect={setSelectedId}
            intervalMs={interval}
          />
        </div>
      </div>

      {/* Main */}
      <main className="col-start-2 min-w-0 md:overflow-y-auto md:[overscroll-behavior:contain]">
        <div className="px-4 md:px-6 py-5 space-y-5 max-w-[1600px] mx-auto pb-20 md:pb-5">
          {/* Live/demo data status note */}
          <div
            className="flex items-start gap-2 rounded-md border border-border/70 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground"
            data-testid="data-status-note"
          >
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/80" />
            <p className="leading-relaxed">
              <span className="text-foreground">Near-real-time data.</span>{" "}
              Prices come from Massive, Yahoo Finance, Stooq, and CoinGecko on
              a polling cycle — not a tick-by-tick websocket feed. Each
              instrument is tagged{" "}
              <span className="text-pos">Live</span> when the provider responds,{" "}
              <span className="text-warn">Demo</span> when rate-limited or
              unavailable (a deterministic series is shown), or{" "}
              <span className="text-neg">Error</span> on hard failures.
              {snaps.length > 0 && (
                <>
                  {" "}Currently:{" "}
                  <span className="text-foreground tabular-nums" data-testid="text-status-mix">
                    {liveCount} live
                    {demoCount > 0 && ` · ${demoCount} demo`}
                    {errorCount > 0 && ` · ${errorCount} error`}
                  </span>
                  .
                </>
              )}
              {interval !== false && (
                <span className="ml-1">
                  Updates every {interval / 1000}s.
                </span>
              )}
            </p>
          </div>
          {/* Mobile selected header */}
          {selected && (
            <div className="md:hidden flex items-center gap-3">
              <AssetGlyph assetClass={selected.instrument.assetClass} />
              <div className="min-w-0">
                <h1 className="text-base font-semibold truncate">
                  {selected.instrument.displayName}
                </h1>
                <div className="flex items-center gap-2">
                  <span className="mono text-xs text-muted-foreground">{selected.instrument.symbol}</span>
                  <StatusBadge status={selected.status} source={selected.source} />
                </div>
              </div>
            </div>
          )}

          {snapsLoading && !selected && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          )}

          {selected && (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <KpiCard
                  label="Price"
                  value={fmtPrice(selected.price, selected.currency)}
                  sub={
                    <span className="inline-flex items-center gap-1.5">
                      <Delta value={selected.changePct1d} digits={2} />
                      <span>{fmtPrice(selected.change1d, selected.currency)}</span>
                    </span>
                  }
                  testId="kpi-price"
                />
                <KpiCard
                  label="30D Return"
                  value={<Delta value={selected.return30d} showArrow={false} />}
                  testId="kpi-30d"
                />
                <KpiCard
                  label="YTD"
                  value={<Delta value={selected.returnYtd} showArrow={false} />}
                  testId="kpi-ytd"
                />
                <KpiCard
                  label="Market Cap"
                  value={
                    selected.marketCap != null
                      ? `${selected.currency === "JPY" ? "¥" : "$"}${fmtCompact(selected.marketCap)}`
                      : selected.instrument.assetClass === "crypto"
                      ? "N/A"
                      : "—"
                  }
                  sub={
                    selected.marketCap != null
                      ? selected.currency === "USD"
                        ? "USD"
                        : selected.currency
                      : selected.instrument.assetClass === "crypto"
                      ? "use BTC dominance"
                      : "needs fundamentals provider"
                  }
                  tone={selected.marketCap == null ? "muted" : "default"}
                  testId="kpi-mcap"
                />
                <KpiCard
                  label="P/E (TTM)"
                  value={
                    selected.peRatio != null
                      ? fmtNum(selected.peRatio, 2)
                      : "N/A"
                  }
                  sub={
                    selected.peRatio != null
                      ? `via ${selected.peSource ?? "provider"}`
                      : selected.instrument.assetClass === "crypto"
                      ? "not applicable"
                      : "negative earnings or no data"
                  }
                  tone={selected.peRatio == null ? "muted" : "default"}
                  testId="kpi-pe"
                />
              </div>

              {selected.message && (
                <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[12px]">
                  {selected.message}
                </div>
              )}

              {/* Chart */}
              <PriceChart snap={selected} />

              {/* Indicators */}
              <IndicatorPanel snap={selected} />

              {/* Risk & relative — advanced indicators */}
              <AdvancedIndicators snap={selected} />

              {/* Research-only model signal panel */}
              <SignalLab snap={selected} />

              {/* Long-term business quality / valuation framework */}
              <BuffettIndexPanel snap={selected} />

              {/* Treasury panel for Metaplanet (or any instrument with treasury data) */}
              {(selected.instrument.symbol === "MTPLF" || selected.treasury) && (
                <TreasuryPanel snap={selected} />
              )}
            </>
          )}

          {/* Comparison table */}
          <ComparisonTable
            snaps={snaps}
            onSelect={setSelectedId}
            selectedId={selectedId}
          />

          <footer className="text-[10px] text-muted-foreground py-3 leading-relaxed">
            TreasuryLens · Equity pricing can use Massive when
            MASSIVE_API_KEY is configured, with Yahoo/Stooq fallback; crypto
            data uses CoinGecko/Yahoo. Indicators (SMA, RSI, volatility, returns) computed
            deterministically from daily OHLCV. Treasury figures are manual
            inputs — verify against company filings before use. Not financial
            advice.
          </footer>
        </div>
      </main>

      <AddInstrumentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(id) => setSelectedId(id)}
      />
      <MobileNav />
    </div>
  );
}

/**
 * Narrow vertical rail shown when the desktop sidebar is collapsed.
 * Renders just the watchlist icons + a row of dots so users can still
 * click an instrument or expand back to the full sidebar.
 */
function CollapsedRail({
  instruments,
  selectedId,
  onSelect,
  onExpand,
  onAdd,
}: {
  instruments: Instrument[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onExpand: () => void;
  onAdd: () => void;
}) {
  return (
    <aside
      className="flex flex-col h-full bg-sidebar border-r border-sidebar-border w-[56px] shrink-0"
      data-testid="sidebar-collapsed"
    >
      <div className="h-14 flex items-center justify-center border-b border-sidebar-border">
        <button
          onClick={onExpand}
          className="h-8 w-8 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover-elevate"
          aria-label="Expand sidebar"
          data-testid="button-sidebar-expand"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col items-center gap-1 py-2">
        {instruments.map((inst) => {
          const Icon =
            inst.assetClass === "crypto"
              ? Bitcoin
              : inst.assetClass === "equity"
              ? LineIcon
              : BarChart3;
          const tone =
            inst.assetClass === "crypto"
              ? "text-warn"
              : inst.assetClass === "equity"
              ? "text-primary"
              : "text-muted-foreground";
          return (
            <button
              key={inst.id}
              onClick={() => onSelect(inst.id)}
              title={`${inst.displayName} · ${inst.symbol}`}
              data-testid={`rail-instrument-${inst.id}`}
              className={`h-9 w-9 inline-flex items-center justify-center rounded border ${
                selectedId === inst.id
                  ? "bg-sidebar-accent border-sidebar-accent-border"
                  : "border-transparent hover-elevate"
              }`}
            >
              <Icon className={`h-4 w-4 ${tone}`} />
            </button>
          );
        })}
        <button
          onClick={onAdd}
          title="Add instrument"
          aria-label="Add instrument"
          data-testid="button-rail-add"
          className="h-9 w-9 inline-flex items-center justify-center rounded text-muted-foreground hover-elevate"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function AssetGlyph({ assetClass }: { assetClass: string }) {
  const Icon =
    assetClass === "crypto" ? Bitcoin : assetClass === "equity" ? LineIcon : BarChart3;
  const tone =
    assetClass === "crypto"
      ? "text-warn bg-warn/10 border-warn/30"
      : assetClass === "equity"
      ? "text-primary bg-primary/10 border-primary/30"
      : "text-muted-foreground bg-muted/30 border-border";
  return (
    <div
      className={`h-9 w-9 rounded border flex items-center justify-center ${tone}`}
      aria-hidden
    >
      <Icon className="h-4 w-4" />
    </div>
  );
}
