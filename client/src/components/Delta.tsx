import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/lib/format";

export function Delta({
  value,
  className,
  showArrow = true,
  digits = 2,
}: {
  value: number | null | undefined;
  className?: string;
  showArrow?: boolean;
  digits?: number;
}) {
  const tone =
    value == null
      ? "text-muted-foreground"
      : value > 0
      ? "text-pos"
      : value < 0
      ? "text-neg"
      : "text-muted-foreground";
  const Icon =
    value == null
      ? ArrowRight
      : value > 0
      ? ArrowUp
      : value < 0
      ? ArrowDown
      : ArrowRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums font-medium",
        tone,
        className,
      )}
    >
      {showArrow && <Icon className="h-3.5 w-3.5" />}
      {fmtPct(value, digits)}
    </span>
  );
}

export function TrendBadge({
  trend,
  label,
}: {
  trend: "up" | "down" | "flat" | null;
  label: string;
}) {
  const tone =
    trend === "up"
      ? "text-pos border-pos/30 bg-pos/10"
      : trend === "down"
      ? "text-neg border-neg/30 bg-neg/10"
      : "text-muted-foreground border-border bg-muted/30";
  const t = trend === "up" ? "Above" : trend === "down" ? "Below" : "Near";
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-medium tracking-wide uppercase border rounded px-1.5 py-0.5",
        tone,
      )}
    >
      {t} {label}
    </span>
  );
}
