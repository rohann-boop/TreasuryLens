import { useState } from "react";
import { Moon, Sun, Lightbulb } from "lucide-react";
import { WordMark } from "@/components/Logo";
import { PrimaryNav } from "@/components/PrimaryNav";
import { MobileNav } from "@/components/MobileNav";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTheme } from "@/lib/theme";
import { StockPicksBody } from "./StockPicks";
import { TradeIdeasBody } from "./TradeIdeas";

// Consolidated discovery surface. Two sub-sections, both reusing the existing
// page bodies (no duplicated logic): Discovery (stock picks / themes / ETFs)
// and Trade Ideas (actionable longs + bullish option structures).
type IdeasTab = "discovery" | "trade-ideas";

export default function Ideas() {
  const { dark, setDark } = useTheme();
  const [tab, setTab] = useState<IdeasTab>("discovery");

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-background text-foreground pb-16 md:pb-0"
      data-testid="ideas-page"
    >
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <WordMark />
          <span className="hidden md:inline text-[11px] text-muted-foreground border-l border-border pl-3">
            Ideas — discover picks, themes &amp; actionable trades
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PrimaryNav className="mr-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDark(!dark)}
            aria-label="Toggle theme"
            data-testid="button-theme"
          >
            {dark ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as IdeasTab)}
          className="w-full"
        >
          <div className="border-b border-border bg-background/60 px-4 md:px-6 pt-3">
            <div className="max-w-[1600px] mx-auto flex items-center gap-2">
              <Lightbulb
                className="h-4 w-4 text-primary shrink-0"
                aria-hidden
              />
              <TabsList data-testid="ideas-tabs">
                <TabsTrigger value="discovery" data-testid="tab-discovery">
                  Discovery
                </TabsTrigger>
                <TabsTrigger value="trade-ideas" data-testid="tab-trade-ideas">
                  Trade Ideas
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          <TabsContent value="discovery" className="mt-0">
            <StockPicksBody embedded />
          </TabsContent>
          <TabsContent value="trade-ideas" className="mt-0">
            <TradeIdeasBody embedded />
          </TabsContent>
        </Tabs>
      </main>

      <MobileNav />
    </div>
  );
}
