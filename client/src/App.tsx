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
import { AssistantWidget } from "@/components/AssistantWidget";

// The root route renders the merged Dashboard, which now embeds the Watchlist /
// conviction-ideas experience. Three primary tabs: Dashboard, Stock Picks, 13F
// Filings. Legacy /ideas and /conviction routes resolve to the Dashboard so old
// links land on the merged watchlist section; /themes still maps to Stock
// Picks; /superinvestors to 13F.
function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/app" component={Dashboard} />
      <Route path="/ideas" component={Dashboard} />
      <Route path="/conviction" component={Dashboard} />
      <Route path="/13f" component={ThirteenF} />
      <Route path="/superinvestors" component={ThirteenF} />
      <Route path="/stock-picks" component={StockPicks} />
      <Route path="/themes" component={StockPicks} />
      <Route path="/model-lab" component={ModelLab} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
          <AssistantWidget />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
