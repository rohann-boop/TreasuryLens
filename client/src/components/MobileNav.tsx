import { Link, useLocation } from "wouter";
import { PRIMARY_TABS } from "@/components/PrimaryNav";

// Mobile bottom-bar navigation. Shows short labels for the three primary tabs;
// the source of truth for the tabs themselves is PRIMARY_TABS in PrimaryNav.
const MOBILE_LABELS: Record<string, string> = {
  "nav-dashboard": "Dashboard",
  "nav-stock-picks": "Stock Picks",
  "nav-model-lab": "Model Lab",
  "nav-investment-groups": "Groups",
  "nav-trade-ideas": "Ideas",
  "nav-13f": "13F",
};

const ITEMS = PRIMARY_TABS.map((tab) => ({
  ...tab,
  testId: `mobile-${tab.testId}`,
  label: MOBILE_LABELS[tab.testId] ?? tab.label,
}));

export function MobileNav() {
  const [location] = useLocation();
  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-nav"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-6">
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
