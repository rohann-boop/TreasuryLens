import { Link, useLocation } from "wouter";
import {
  LineChart,
  Users,
  Lightbulb,
  FlaskConical,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Routes that resolve to the merged Dashboard (which embeds the watchlist).
// Legacy /conviction lives here so the Dashboard tab stays active on the
// backward-compatible route.
const DASHBOARD_ROUTES = ["/", "", "/dashboard", "/app", "/conviction"];

// The consolidated Ideas surface now owns discovery: Stock Picks / themes /
// ETFs, Trade Ideas (longs + options) and theme/group discovery. The old
// top-level routes resolve here so legacy links keep working.
const IDEAS_ROUTES = [
  "/ideas",
  "/stock-picks",
  "/themes",
  "/trade-ideas",
  "/trade-ideas/longs",
  "/trade-ideas/options",
  "/groups",
];

// Portfolio Lab — model/paper portfolio construction. The legacy Investment
// Groups / Baskets routes resolve here so old links land on the construction
// workflow.
const PORTFOLIO_ROUTES = [
  "/portfolio-lab",
  "/portfolio",
  "/investment-groups",
  "/baskets",
];

type Tab = {
  href: string;
  label: string;
  testId: string;
  icon: typeof LineChart;
  match: (loc: string) => boolean;
};

// The five primary destinations, in intentional order:
//   Dashboard (monitor & research) · Ideas (discover) · Portfolio Lab
//   (construct) · Model Lab (tune/validate) · 13F (investor intelligence).
export const PRIMARY_TABS: Tab[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    testId: "nav-dashboard",
    icon: LineChart,
    match: (loc) => DASHBOARD_ROUTES.includes(loc),
  },
  {
    href: "/ideas",
    label: "Ideas",
    testId: "nav-ideas",
    icon: Lightbulb,
    match: (loc) => IDEAS_ROUTES.includes(loc),
  },
  {
    href: "/portfolio-lab",
    label: "Portfolio Lab",
    testId: "nav-portfolio-lab",
    icon: Briefcase,
    match: (loc) => PORTFOLIO_ROUTES.includes(loc),
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
    label: "13F",
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
