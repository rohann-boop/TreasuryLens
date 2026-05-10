import { useQuery } from "@tanstack/react-query";
import type {
  BuffettCategory,
  BuffettIndex,
  EquityFundamentals,
  InstrumentSnapshot,
} from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BadgeCheck, Building2, CircleAlert, Scale, ShieldCheck } from "lucide-react";

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return v.toFixed(digits);
}

function tone(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-pos";
  if (score >= 45) return "text-warn";
  return "text-neg";
}

function CategoryCard({ c }: { c: BuffettCategory }) {
  return (
    <div
      className="rounded-md border border-border/70 bg-background/35 p-3"
      data-testid={`buffett-category-${c.key}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {c.name}
        </div>
        <div className={cn("tabular-nums text-sm font-semibold", tone(c.score))}>
          {c.score == null ? "N/A" : c.score.toFixed(0)}
        </div>
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground leading-relaxed">
        {c.bullets.map((b) => (
          <div key={b}>{b}</div>
        ))}
      </div>
    </div>
  );
}

export function BuffettIndexPanel({ snap }: { snap: InstrumentSnapshot }) {
  const { data, isLoading } = useQuery<BuffettIndex>({
    queryKey: ["/api/instruments", snap.instrument.id, "buffett"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/instruments/${snap.instrument.id}/buffett`);
      return res.json();
    },
  });

  return (
    <section
      className="rounded-md border border-card-border bg-card overflow-hidden"
      data-testid="buffett-index-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold tracking-widest uppercase">
            Buffett Index — business quality
          </span>
        </div>
        {data && (
          <span
            className={cn("text-[10px] uppercase tracking-wide tabular-nums", tone(data.overallScore))}
            data-testid="buffett-score-header"
          >
            {data.overallScore == null ? "N/A" : `${data.overallScore.toFixed(0)} / 100`}
          </span>
        )}
      </header>

      {isLoading && (
        <div className="px-4 py-6 text-[12px] text-muted-foreground">
          Calculating Buffett Index…
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-4 px-4 py-4">
            <div className="rounded-md border border-border/70 bg-background/35 p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Scale className="h-4 w-4" />
                <span className="text-[10px] uppercase tracking-widest">Long-term score</span>
              </div>
              <div
                className={cn("mt-3 text-3xl font-semibold tabular-nums", tone(data.overallScore))}
                data-testid="buffett-overall-score"
              >
                {data.overallScore == null ? "N/A" : data.overallScore.toFixed(0)}
              </div>
              <div className="mt-1 text-sm font-medium" data-testid="buffett-label">
                {data.label}
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                Data coverage: {(data.dataCoverage * 100).toFixed(0)}%
              </div>
              <div className="mt-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                Framework: {data.framework.replace("_", " ")}
              </div>
            </div>

            <div>
              {!data.applicable ? (
                <div className="rounded-md border border-border/70 bg-background/35 p-4 text-sm text-muted-foreground">
                  Bitcoin is not an operating business, so Buffett metrics like ROIC,
                  owner earnings, debt, and management quality do not apply.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {data.categories.map((c) => (
                    <CategoryCard key={c.key} c={c} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {data.fundamentals && data.applicable && data.framework === "equity" && (
            <FundamentalsBlock f={data.fundamentals} />
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-card-border">
            <ListBlock title="Strengths" icon="check" items={data.strengths} empty="No strong category yet." />
            <ListBlock title="Watchouts" icon="alert" items={data.watchouts} empty="No major quantified watchout." />
            <ListBlock title="Missing data" icon="shield" items={data.missingData} empty="No missing category data." />
          </div>

          <footer className="border-t border-card-border px-4 py-2.5 text-[10px] text-muted-foreground leading-relaxed">
            Buffett Index is a research framework for business quality and valuation, not a
            timing model and not financial advice. Equity fundamentals from SEC EDGAR (free,
            no key) when available; balance-sheet items reflect the most recent 10-K/10-Q.
          </footer>
        </>
      )}
    </section>
  );
}

function MetricCell({
  label,
  value,
  testid,
  hint,
}: {
  label: string;
  value: string;
  testid: string;
  hint?: string;
}) {
  return (
    <div className="px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-[12px] tabular-nums font-medium" data-testid={testid}>
        {value}
      </div>
      {hint && (
        <div className="text-[9px] text-muted-foreground/70">{hint}</div>
      )}
    </div>
  );
}

function FundamentalsBlock({ f }: { f: EquityFundamentals }) {
  const filing = f.latestFiling;
  return (
    <section
      className="border-t border-card-border bg-background/20"
      data-testid="buffett-fundamentals"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>SEC EDGAR fundamentals</span>
        <span data-testid="buffett-fundamentals-source">
          Source: SEC EDGAR · CIK {f.cik}
          {filing
            ? ` · ${filing.form} filed ${filing.filed} (period ${filing.periodEnd})`
            : ""}
        </span>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y divide-border/50 border-t border-border/50">
        <MetricCell
          label="Revenue (TTM)"
          value={fmtMoney(f.revenue?.value)}
          testid="fund-revenue"
        />
        <MetricCell
          label="Net income"
          value={fmtMoney(f.netIncome?.value)}
          testid="fund-net-income"
        />
        <MetricCell
          label="Free cash flow"
          value={fmtMoney(f.freeCashFlow?.value)}
          testid="fund-fcf"
        />
        <MetricCell
          label="Operating CF"
          value={fmtMoney(f.operatingCashFlow?.value)}
          testid="fund-ocf"
        />
        <MetricCell
          label="Capex"
          value={fmtMoney(f.capex?.value)}
          testid="fund-capex"
        />
        <MetricCell
          label="Diluted EPS"
          value={fmtNum(f.eps?.value)}
          testid="fund-eps"
        />
        <MetricCell
          label="Gross margin"
          value={fmtPct(f.grossMargin)}
          testid="fund-gross-margin"
        />
        <MetricCell
          label="Operating margin"
          value={fmtPct(f.operatingMargin)}
          testid="fund-op-margin"
        />
        <MetricCell
          label="Net margin"
          value={fmtPct(f.netMargin)}
          testid="fund-net-margin"
        />
        <MetricCell
          label="ROE"
          value={fmtPct(f.roe)}
          testid="fund-roe"
        />
        <MetricCell
          label="Debt / equity"
          value={fmtNum(f.debtToEquity)}
          testid="fund-de"
        />
        <MetricCell
          label="Total debt"
          value={fmtMoney(f.totalDebt?.value)}
          testid="fund-total-debt"
        />
        <MetricCell
          label="Assets"
          value={fmtMoney(f.assets?.value)}
          testid="fund-assets"
        />
        <MetricCell
          label="Equity"
          value={fmtMoney(f.equity?.value)}
          testid="fund-equity"
        />
        <MetricCell
          label="Cash"
          value={fmtMoney(f.cashAndEquivalents?.value)}
          testid="fund-cash"
        />
        <MetricCell
          label="Revenue growth"
          value={fmtPct(f.revenueGrowth)}
          hint="YoY (annual)"
          testid="fund-rev-growth"
        />
        <MetricCell
          label="EPS growth"
          value={fmtPct(f.epsGrowth)}
          hint="YoY (annual)"
          testid="fund-eps-growth"
        />
        <MetricCell
          label="Share count"
          value={
            f.shareCountTrend
              ? `${f.shareCountTrend} ${
                  f.shareCountChangePct != null
                    ? `(${fmtPct(f.shareCountChangePct, 1)})`
                    : ""
                }`.trim()
              : "N/A"
          }
          testid="fund-share-trend"
        />
      </div>
    </section>
  );
}

function ListBlock({
  title,
  items,
  empty,
  icon,
}: {
  title: string;
  items: string[];
  empty: string;
  icon: "check" | "alert" | "shield";
}) {
  const Icon = icon === "check" ? BadgeCheck : icon === "alert" ? CircleAlert : ShieldCheck;
  return (
    <div className="p-4 border-b md:border-b-0 md:border-r border-card-border last:border-r-0">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        {(items.length ? items : [empty]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
