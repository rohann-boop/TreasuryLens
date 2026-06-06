import { Link, useLocation } from "wouter";
import { LineChart, Users, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  href: string;
  label: string;
  testId: string;
  icon: typeof LineChart;
  match: (loc: string) => boolean;
};

// The three primary tabs of the watchlist-first app. Order is intentional:
// Dashboard (landing), 13F Filings, Additional Stock Ideas (watchlist).
export const PRIMARY_TABS: Tab[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    testId: "nav-dashboard",
    icon: LineChart,
    match: (loc) => loc === "/" || loc === "" || loc === "/dashboard" || loc === "/app",
  },
  {
    href: "/13f",
    label: "13F Filings",
    testId: "nav-13f",
    icon: Users,
    match: (loc) => loc === "/13f" || loc === "/superinvestors",
  },
  {
    href: "/ideas",
    label: "Additional Stock Ideas",
    testId: "nav-ideas",
    icon: Lightbulb,
    match: (loc) =>
      loc === "/ideas" ||
      loc === "/conviction" ||
      loc === "/stock-picks" ||
      loc === "/themes",
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
