import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import ThirteenF from "@/pages/ThirteenF";
import Landing from "@/pages/Landing";
import StockPicks from "@/pages/StockPicks";
import { AssistantWidget } from "@/components/AssistantWidget";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/app" component={Dashboard} />
      <Route path="/13f" component={ThirteenF} />
      <Route path="/superinvestors" component={ThirteenF} />
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
