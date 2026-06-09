import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCcw, Sun, Moon, Plus } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { WordMark } from "@/components/Logo";
import { MobileNav } from "@/components/MobileNav";
import { PrimaryNav } from "@/components/PrimaryNav";
import { ConvictionWatchlist } from "@/components/ConvictionWatchlist";
import { TickerRibbon } from "@/components/TickerRibbon";
import { useTheme } from "@/lib/theme";

// The Dashboard *is* the Watchlist & Conviction workspace. The left rail lists
// the thematic watchlist sections (Bravos, Core AI, Speculative AI infra, AI
// power/grid, AI software/data, Frontier/high-upside, plus Custom and a
// Needs-review view); selecting a section shows that section's tickers, and a
// selected ticker drives the detail pane on the right (quote/market-cap/PE +
// performance, price chart with 50/200 MAs and breakout markers, revenue, and
// the full thesis / bull-bear / catalysts / risks / kill-criteria content).
// Add/remove of ideas persists via the SQLite-backed conviction API. Stock
// Picks and 13F Filings remain separate primary tabs.
export default function Dashboard() {
  const { dark, setDark } = useTheme();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  // A bump counter the workspace can watch to trigger an "Add idea" flow from
  // the header button, keeping the dialog state owned by the workspace.
  const [addSignal, setAddSignal] = useState(0);
  // The currently-selected ticker (reported up by the workspace) drives the
  // ribbon highlight; clicking the ribbon sends a select request back down.
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectTicker, setSelectTicker] = useState<{
    ticker: string;
    nonce: number;
  } | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["/api/conviction-ideas"] });
      await queryClient.invalidateQueries({
        queryKey: ["/api/conviction-ideas/chart"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/conviction-ideas/revenue"],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/conviction-ticker"] });
      toast({ title: "Refreshed" });
    } catch {
      toast({ title: "Refresh failed", variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      className="min-h-[100dvh] md:h-[100dvh] flex flex-col md:overflow-hidden bg-background text-foreground"
      data-testid="dashboard-workspace"
    >
      {/* Header */}
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <WordMark />
          <span className="hidden md:inline text-[11px] text-muted-foreground border-l border-border pl-3">
            Watchlist &amp; conviction ideas
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PrimaryNav className="mr-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={refresh}
            disabled={refreshing}
            data-testid="button-refresh"
            title="Refresh ideas, charts and revenue"
          >
            <RefreshCcw
              className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">Refresh</span>
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
            onClick={() => setAddSignal((n) => n + 1)}
            data-testid="button-header-add"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add to Watchlist
          </Button>
        </div>
      </header>

      {/* Moving price ribbon — sits just below the header, sourced from the
          watchlist's enriched key metrics. Clicking an item selects it. */}
      <TickerRibbon
        selectedTicker={selectedTicker}
        onSelect={(ticker) =>
          setSelectTicker({ ticker, nonce: Date.now() })
        }
      />

      {/* Main workspace — the watchlist takes the full content area. */}
      <main className="flex-1 min-h-0 md:overflow-hidden">
        <ConvictionWatchlist
          addSignal={addSignal}
          selectTicker={selectTicker}
          onSelectedTickerChange={setSelectedTicker}
        />
      </main>

      <MobileNav />
    </div>
  );
}
