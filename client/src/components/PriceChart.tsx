import {
  Area,
  AreaChart,
  Line,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
} from "recharts";
import { useMemo, useState } from "react";
import type { InstrumentSnapshot } from "@shared/schema";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type Range = "1M" | "3M" | "6M" | "1Y" | "ALL";

const rangeBars: Record<Range, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 130,
  "1Y": 252,
  ALL: 9999,
};

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function PriceChart({ snap }: { snap: InstrumentSnapshot }) {
  const [range, setRange] = useState<Range>("6M");
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(true);

  const data = useMemo(() => {
    const all = snap.history;
    const closes = all.map((b) => b.c);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const enriched = all.map((b, i) => ({
      t: b.t,
      c: b.c,
      sma20: s20[i],
      sma50: s50[i],
      sma200: s200[i],
    }));
    const n = rangeBars[range];
    return enriched.slice(-n);
  }, [snap, range]);

  const fmt = (v: number) => fmtPrice(v, snap.currency);

  return (
    <div
      className="rounded-md border border-card-border bg-card flex flex-col"
      data-testid="chart-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
            Price & Moving Averages
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SeriesToggle on={showSma20} onChange={setShowSma20} color="hsl(var(--chart-2))" label="SMA 20" />
          <SeriesToggle on={showSma50} onChange={setShowSma50} color="hsl(var(--chart-3))" label="SMA 50" />
          <SeriesToggle on={showSma200} onChange={setShowSma200} color="hsl(var(--chart-5))" label="SMA 200" />
          <div className="ml-2 flex items-center rounded border border-border overflow-hidden">
            {(["1M", "3M", "6M", "1Y", "ALL"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                data-testid={`button-range-${r}`}
                className={cn(
                  "px-2 py-1 text-[11px] font-medium",
                  range === r
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover-elevate",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-2 pt-2 pb-3 h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) =>
                new Date(t).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              }
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickFormatter={(v) => fmt(v)}
              domain={["auto", "auto"]}
              tickLine={false}
              width={70}
              orientation="right"
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--popover-border))",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelFormatter={(t) =>
                new Date(t as number).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              }
              formatter={(v: number, name: string) => [fmt(v), name]}
            />
            <Area
              type="monotone"
              dataKey="c"
              name="Price"
              stroke="hsl(var(--chart-1))"
              strokeWidth={1.5}
              fill="url(#priceFill)"
              isAnimationActive={false}
              dot={false}
            />
            {showSma20 && (
              <Line
                type="monotone"
                dataKey="sma20"
                name="SMA 20"
                stroke="hsl(var(--chart-2))"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {showSma50 && (
              <Line
                type="monotone"
                dataKey="sma50"
                name="SMA 50"
                stroke="hsl(var(--chart-3))"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {showSma200 && (
              <Line
                type="monotone"
                dataKey="sma200"
                name="SMA 200"
                stroke="hsl(var(--chart-5))"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
                strokeDasharray="3 3"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SeriesToggle({
  on,
  onChange,
  color,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  color: string;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      data-testid={`button-toggle-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium hover-elevate",
        on ? "border-border text-foreground" : "border-border text-muted-foreground opacity-60",
      )}
    >
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </button>
  );
}
