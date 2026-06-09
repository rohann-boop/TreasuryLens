import { Link, useLocation } from "wouter";
import { LineChart, Users, Lightbulb, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

// Routes that resolve to the merged Dashboard (which now embeds the watchlist).
// Legacy /ideas and /conviction live here so the Dashboard tab stays active on
// those backward-compatible routes.
const DASHBOARD_ROUTES = [
  "/",
  "",
  "/dashboard",
  "/app",
  "/ideas",
  "/conviction",
];

const STOCK_PICKS_ROUTES = ["/stock-picks", "/themes"];

type Tab = {
  href: string;
  label: string;
  testId: string;
  icon: typeof LineChart;
  match: (loc: string) => boolean;
};

// The primary tabs. Order is intentional: Dashboard (merged dashboard +
// watchlist), Stock Picks (theme discovery), Model Lab (quant weight sandbox),
// 13F Filings.
export const PRIMARY_TABS: Tab[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    testId: "nav-dashboard",
    icon: LineChart,
    match: (loc) => DASHBOARD_ROUTES.includes(loc),
  },
  {
    href: "/stock-picks",
    label: "Stock Picks",
    testId: "nav-stock-picks",
    icon: Lightbulb,
    match: (loc) => STOCK_PICKS_ROUTES.includes(loc),
  },
  {
    href: "/model-lab",
    label: "Model Lab",
    testId: "nav-model-lab",
    icon: FlaskConical,
    match: (loc) => loc === "/model-lab",
  },
  {
    href: "/13f",
    label: "13F Filings",
    testId: "nav-13f",
    icon: Users,
    match: (loc) => loc === "/13f" || loc === "/superinvestors",
  },
];

// Horizontal primary navigation rendered inside each page header on >= sm.
// Mobile navigation lives in MobileNav (bottom bar).
export function PrimaryNav({ className }: { className?: string }) {
  const [location] = useLocation();
  return (
    <nav
      aria-label="Primary"
      data-testid="primary-nav"
      className={cn("hidden sm:flex items-center gap-1", className)}
    >
      {PRIMARY_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = tab.match(location);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-testid={tab.testId}
            aria-current={active ? "page" : undefined}
            title={tab.label}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-[12px] font-medium hover-elevate transition-colors",
              active
                ? "text-foreground bg-accent/60"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden md:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
