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
import ConvictionIdeas from "@/pages/ConvictionIdeas";
import { AssistantWidget } from "@/components/AssistantWidget";

// Watchlist-first app: the root route renders the Dashboard (no marketing
// landing page). The three primary tabs are Dashboard, 13F Filings, and
// Additional Stock Ideas (the watchlist). Legacy routes (/conviction,
// /superinvestors, /stock-picks, /themes) remain for backward compatibility.
function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/app" component={Dashboard} />
      <Route path="/13f" component={ThirteenF} />
      <Route path="/superinvestors" component={ThirteenF} />
      <Route path="/ideas" component={ConvictionIdeas} />
      <Route path="/conviction" component={ConvictionIdeas} />
      <Route path="/stock-picks" component={StockPicks} />
      <Route path="/themes" component={StockPicks} />
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
