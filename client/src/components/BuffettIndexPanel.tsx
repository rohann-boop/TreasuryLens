import { useQuery } from "@tanstack/react-query";
import type { BuffettCategory, BuffettIndex, InstrumentSnapshot } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BadgeCheck, Building2, CircleAlert, Scale, ShieldCheck } from "lucide-react";

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-card-border">
            <ListBlock title="Strengths" icon="check" items={data.strengths} empty="No strong category yet." />
            <ListBlock title="Watchouts" icon="alert" items={data.watchouts} empty="No major quantified watchout." />
            <ListBlock title="Missing data" icon="shield" items={data.missingData} empty="No missing category data." />
          </div>

          <footer className="border-t border-card-border px-4 py-2.5 text-[10px] text-muted-foreground leading-relaxed">
            Buffett Index is a research framework for business quality and valuation, not a
            timing model and not financial advice. Connect a fundamentals provider later for
            ROIC, FCF, debt, and owner-earnings coverage.
          </footer>
        </>
      )}
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
