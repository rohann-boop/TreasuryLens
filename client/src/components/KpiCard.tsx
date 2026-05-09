import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  sub,
  tone = "default",
  className,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "pos" | "neg" | "muted";
  className?: string;
  testId?: string;
}) {
  const valTone =
    tone === "pos"
      ? "text-pos"
      : tone === "neg"
      ? "text-neg"
      : tone === "muted"
      ? "text-muted-foreground"
      : "";
  return (
    <div
      className={cn(
        "rounded-md border border-card-border bg-card px-4 py-3 flex flex-col gap-1 min-w-0",
        className,
      )}
      data-testid={testId}
    >
      <div className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "tabular-nums font-semibold text-lg leading-tight truncate",
          valTone,
        )}
      >
        {value}
      </div>
      {sub != null && (
        <div className="text-[11px] text-muted-foreground tabular-nums truncate">
          {sub}
        </div>
      )}
    </div>
  );
}
