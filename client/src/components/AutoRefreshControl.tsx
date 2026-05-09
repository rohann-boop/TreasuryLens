import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Timer, ChevronDown, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export type RefreshInterval = false | 15_000 | 30_000 | 60_000;

const OPTIONS: { value: RefreshInterval; label: string }[] = [
  { value: false, label: "Off" },
  { value: 15_000, label: "15s" },
  { value: 30_000, label: "30s" },
  { value: 60_000, label: "60s" },
];

/**
 * Compact auto-refresh control: shows a pill that doubles as a countdown to
 * the next refresh, plus a dropdown to change the interval. Designed to fit
 * inline in the dashboard header next to the manual Refresh button.
 */
export function AutoRefreshControl({
  interval,
  onChange,
  lastUpdated,
}: {
  interval: RefreshInterval;
  onChange: (v: RefreshInterval) => void;
  lastUpdated: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (interval === false) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [interval]);

  const nextInSec =
    interval && lastUpdated
      ? Math.max(0, Math.ceil((lastUpdated + interval - now) / 1000))
      : null;

  const currentLabel =
    OPTIONS.find((o) => o.value === interval)?.label ?? "Off";

  return (
    <div
      className="hidden sm:inline-flex items-center rounded-md border border-border bg-card h-8"
      data-testid="auto-refresh-control"
    >
      <button
        type="button"
        onClick={() => onChange(interval === false ? 30_000 : false)}
        className={cn(
          "inline-flex items-center gap-1.5 pl-2 pr-2 h-full text-[11px] tabular-nums hover-elevate rounded-l-md",
          interval === false ? "text-muted-foreground" : "text-foreground",
        )}
        aria-label={interval === false ? "Enable auto-refresh" : "Pause auto-refresh"}
        data-testid="button-toggle-auto-refresh"
      >
        {interval === false ? (
          <Play className="h-3 w-3" />
        ) : (
          <Pause className="h-3 w-3" />
        )}
        <span className="hidden md:inline">
          {interval === false ? (
            "Auto-refresh off"
          ) : nextInSec != null ? (
            <>
              <Timer className="h-3 w-3 inline -mt-0.5 mr-0.5" />
              Next in {nextInSec}s
            </>
          ) : (
            `Every ${currentLabel}`
          )}
        </span>
      </button>
      <span className="h-4 w-px bg-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-full px-2 rounded-l-none rounded-r-md text-[11px] gap-1"
            data-testid="button-refresh-interval"
          >
            {currentLabel}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[7rem]">
          {OPTIONS.map((o) => (
            <DropdownMenuItem
              key={String(o.value)}
              onSelect={() => onChange(o.value)}
              data-testid={`option-interval-${o.label.toLowerCase()}`}
              className={cn(
                "text-[12px]",
                interval === o.value && "bg-accent/40",
              )}
            >
              {o.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
