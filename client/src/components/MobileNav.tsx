import { Link, useLocation } from "wouter";
import { Home, LineChart, Lightbulb, Users } from "lucide-react";

type Item = {
  href: string;
  label: string;
  testId: string;
  icon: typeof Home;
  match: (loc: string) => boolean;
};

const ITEMS: Item[] = [
  {
    href: "/",
    label: "Home",
    testId: "mobile-nav-home",
    icon: Home,
    match: (loc) => loc === "/" || loc === "",
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    testId: "mobile-nav-dashboard",
    icon: LineChart,
    match: (loc) => loc === "/dashboard" || loc === "/app",
  },
  {
    href: "/stock-picks",
    label: "Picks",
    testId: "mobile-nav-picks",
    icon: Lightbulb,
    match: (loc) => loc === "/stock-picks" || loc === "/themes",
  },
  {
    href: "/superinvestors",
    label: "SuperInvestors",
    testId: "mobile-nav-superinvestors",
    icon: Users,
    match: (loc) => loc === "/superinvestors" || loc === "/13f",
  },
];

export function MobileNav() {
  const [location] = useLocation();
  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-nav"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.match(location);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                data-testid={item.testId}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium leading-none transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="truncate px-1">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
