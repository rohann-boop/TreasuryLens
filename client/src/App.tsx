import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import ThirteenF from "@/pages/ThirteenF";
import StockPicks from "@/pages/StockPicks";
import ModelLab from "@/pages/ModelLab";
import InvestmentGroups from "@/pages/InvestmentGroups";
import TradeIdeas from "@/pages/TradeIdeas";
import Ideas from "@/pages/Ideas";
import PortfolioLab from "@/pages/PortfolioLab";
import { AssistantWidget } from "@/components/AssistantWidget";
import { ThemeProvider } from "@/lib/theme";

// Five primary destinations: Dashboard (monitor & research), Ideas (discover),
// Portfolio Lab (construct), Model Lab (tune/validate), 13F (investor
// intelligence). The legacy discovery routes (/stock-picks, /themes,
// /trade-ideas, /groups) and construction routes (/investment-groups,
// /baskets) are kept as backwards-compatible entries that resolve to the
// consolidated surfaces but no longer appear in the primary nav. /conviction
// resolves to the Dashboard so old watchlist links keep working.
function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/app" component={Dashboard} />
      <Route path="/conviction" component={Dashboard} />
      <Route path="/13f" component={ThirteenF} />
      <Route path="/superinvestors" component={ThirteenF} />
      <Route path="/model-lab" component={ModelLab} />

      {/* Ideas — consolidated discovery surface */}
      <Route path="/ideas" component={Ideas} />
      <Route path="/stock-picks" component={Ideas} />
      <Route path="/themes" component={Ideas} />
      <Route path="/groups" component={Ideas} />
      <Route path="/trade-ideas" component={Ideas} />
      <Route path="/trade-ideas/longs" component={Ideas} />
      <Route path="/trade-ideas/options" component={Ideas} />

      {/* Portfolio Lab — model / paper portfolio construction */}
      <Route path="/portfolio-lab" component={PortfolioLab} />
      <Route path="/portfolio" component={PortfolioLab} />
      <Route path="/investment-groups" component={PortfolioLab} />
      <Route path="/baskets" component={PortfolioLab} />

      {/* Standalone legacy pages (off-nav, still directly reachable) */}
      <Route path="/stock-picks-classic" component={StockPicks} />
      <Route path="/trade-ideas-classic" component={TradeIdeas} />
      <Route path="/investment-groups-classic" component={InvestmentGroups} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
            <AssistantWidget />
          </Router>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
