import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Layers, Compass } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type {
  AllWeatherRegimeNote,
  AllWeatherResolved,
  AllWeatherResponse,
  AllWeatherRisk,
  AllWeatherSleeve,
} from "@shared/schema";

const RISK_LABEL: Record<AllWeatherRisk, string> = {
  defensive: "Defensive",
  balanced: "Balanced",
  growth: "Growth",
};

const EXPECTATION_TONE: Record<AllWeatherRegimeNote["expectation"], string> = {
  strong: "bg-pos/10 text-pos border-pos/30",
  ok: "bg-primary/10 text-primary border-primary/30",
  neutral: "bg-muted/40 text-muted-foreground border-border/60",
  headwind: "bg-warn/10 text-warn border-warn/30",
  weak: "bg-neg/10 text-neg border-neg/30",
};

const EXPECTATION_LABEL: Record<AllWeatherRegimeNote["expectation"], string> = {
  strong: "Strong",
  ok: "OK",
  neutral: "Neutral",
  headwind: "Headwind",
  weak: "Weak",
};

// Distinct sleeve hues for the allocation bar — kept calm and consistent with
// the rest of the palette (primary-leaning, with a couple of warm accents).
const SLEEVE_COLOR: Record<AllWeatherSleeve, string> = {
  equities: "bg-sky-500/70",
  "ai-growth": "bg-violet-500/70",
  gold: "bg-amber-500/70",
  bitcoin: "bg-orange-500/70",
  bonds: "bg-emerald-500/70",
  cash: "bg-slate-400/70",
  commodities: "bg-rose-500/70",
  "real-assets": "bg-teal-500/70",
};

function SleeveDot({ sleeve }: { sleeve: AllWeatherSleeve }) {
  return (
    <span className={cn("inline-block h-2.5 w-2.5 rounded-sm shrink-0", SLEEVE_COLOR[sleeve])} />
  );
}

function AllocationBar({
  sleeves,
}: {
  sleeves: AllWeatherResolved["sleeves"];
}) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full border border-border/60">
      {sleeves.map((s) => (
        <div
          key={s.sleeve}
          className={cn("h-full", SLEEVE_COLOR[s.sleeve])}
          style={{ width: `${s.weightPct}%` }}
          title={`${s.label} ${s.weightPct}%`}
        />
      ))}
    </div>
  );
}

export function AllWeatherBody() {
  const { data, isLoading, isError, error } = useQuery<AllWeatherResponse>({
    queryKey: ["/api/all-weather"],
  });

  const templates = useMemo(() => data?.templates ?? [], [data?.templates]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [risk, setRisk] = useState<AllWeatherRisk>("balanced");

  const activeId = selectedId ?? templates[0]?.id ?? null;

  const resolvedQuery = useQuery<AllWeatherResolved>({
    queryKey: ["/api/all-weather", { templateId: activeId, risk }],
    queryFn: async () => {
      const url = `/api/all-weather?templateId=${encodeURIComponent(activeId!)}&risk=${risk}`;
      const res = await apiRequest("GET", url);
      return (await res.json()) as AllWeatherResolved;
    },
    enabled: !!activeId,
  });

  const resolved = resolvedQuery.data ?? null;

  if (isError) {
    return (
      <div className="rounded-md border border-neg/40 bg-neg/10 px-3 py-2 text-[12px] text-neg">
        Couldn't load All-Weather Portfolios: {(error as Error)?.message ?? "unknown error"}
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="all-weather-body">
      <div className="space-y-1.5">
        <p className="text-[12px] text-muted-foreground leading-relaxed max-w-3xl">
          <b>All-Weather Portfolios</b> are curated multi-asset model{" "}
          <b>templates</b> that allocate across asset <b>sleeves</b> — equities, AI/growth,
          gold, bitcoin, bonds, cash, commodities and real assets — using a small, transparent
          set of broad proxy ETFs/assets. Pick a template and a risk dial to see the sleeve
          weights, the role of each sleeve and how the mix is expected to behave across regimes.
        </p>
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 max-w-3xl">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>
            Curated, research-only model templates — <b>not optimised, not backtested, not
            personalized advice</b>, and they place no orders. Regime expectations are
            qualitative author judgements, not forecasts. Crypto and commodity sleeves are
            volatile; verify every proxy and weight before acting.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5">
        {/* Template + risk picker */}
        <aside className="space-y-4">
          <section className="rounded-lg border border-border/70 bg-card/40 p-3 space-y-2">
            <h2 className="text-[12px] font-semibold flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-primary" aria-hidden />
              Template
            </h2>
            <div className="space-y-1.5">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  data-testid={`aw-template-${t.id}`}
                  className={cn(
                    "w-full rounded-md border px-2.5 py-1.5 text-left transition-colors",
                    activeId === t.id
                      ? "border-primary bg-primary/10"
                      : "border-border/70 hover:border-border",
                  )}
                >
                  <div className="text-[12px] font-medium flex items-center justify-between gap-2">
                    {t.name}
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      {RISK_LABEL[t.baseRisk]}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-snug">
                    {t.blurb}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-card/40 p-3 space-y-2">
            <h2 className="text-[12px] font-semibold flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5 text-primary" aria-hidden />
              Risk dial
            </h2>
            <div className="inline-flex rounded-md border border-border/70 overflow-hidden text-[11px] w-full">
              {(["defensive", "balanced", "growth"] as AllWeatherRisk[]).map((r, i) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRisk(r)}
                  data-testid={`aw-risk-${r}`}
                  className={cn(
                    "flex-1 px-2 py-1.5 transition-colors",
                    i > 0 && "border-l border-border/70",
                    risk === r
                      ? "bg-primary/15 text-foreground"
                      : "bg-background/30 text-muted-foreground hover:bg-card/60",
                  )}
                >
                  {RISK_LABEL[r]}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              The dial scales growth sleeves (equities, AI/growth, bitcoin) against defensive
              sleeves (bonds, cash, gold) by a fixed factor, then renormalises every sleeve to
              100%.
            </p>
          </section>
        </aside>

        {/* Resolved template */}
        <div className="min-w-0 space-y-4">
          {resolvedQuery.isLoading || !resolved ? (
            <div className="space-y-3">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-48 rounded-lg" />
            </div>
          ) : (
            <>
              <section className="rounded-lg border border-border/70 bg-card/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-base font-semibold">{resolved.name}</h2>
                    <p className="text-[11px] text-muted-foreground">
                      {RISK_LABEL[resolved.risk]} tilt · {resolved.sleeves.length} sleeves ·
                      Rebalance: {resolved.rebalanceCadence}
                    </p>
                  </div>
                </div>
                <AllocationBar sleeves={resolved.sleeves} />
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {resolved.sleeves.map((s) => (
                    <span key={s.sleeve} className="inline-flex items-center gap-1.5 text-[11px]">
                      <SleeveDot sleeve={s.sleeve} />
                      <span className="text-foreground/90">{s.label}</span>
                      <span className="tabular-nums text-muted-foreground">{s.weightPct}%</span>
                    </span>
                  ))}
                </div>
              </section>

              {/* Sleeves / holdings */}
              <section className="rounded-lg border border-border/70 bg-card/40 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Sleeve</th>
                        <th className="text-left px-3 py-2 font-medium">Proxy</th>
                        <th className="text-right px-3 py-2 font-medium">Weight</th>
                        <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resolved.holdings.map((h) => (
                        <tr key={h.ticker} className="border-t border-border/50" data-testid={`aw-holding-${h.ticker}`}>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              <SleeveDot sleeve={h.sleeve} />
                              <span className="text-foreground/90">
                                {resolved.sleeves.find((s) => s.sleeve === h.sleeve)?.label ?? h.sleeve}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-semibold tabular-nums">{h.ticker}</div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">
                              {h.name}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {h.weightPct}%
                          </td>
                          <td className="px-3 py-2 text-[11px] text-muted-foreground hidden md:table-cell">
                            {h.role}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Regime expectations */}
              <section className="rounded-lg border border-border/70 bg-card/40 p-3">
                <h3 className="text-[12px] font-semibold mb-2">Regime expectations</h3>
                <div className="space-y-1.5">
                  {resolved.regimeNotes.map((rn) => (
                    <div
                      key={rn.regime}
                      className="flex items-start gap-2 text-[11px] border-b border-border/40 last:border-0 pb-1.5 last:pb-0"
                    >
                      <span className="w-32 shrink-0 text-foreground/90">{rn.label}</span>
                      <span
                        className={cn(
                          "shrink-0 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider border",
                          EXPECTATION_TONE[rn.expectation],
                        )}
                      >
                        {EXPECTATION_LABEL[rn.expectation]}
                      </span>
                      <span className="text-muted-foreground leading-snug">{rn.note}</span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* How it works */}
                <section className="rounded-lg border border-border/70 bg-card/40 p-3">
                  <h3 className="text-[12px] font-semibold mb-2">How it works</h3>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] text-muted-foreground">
                    {resolved.howItWorks.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </section>

                {/* Key risks */}
                <section className="rounded-lg border border-border/70 bg-card/40 p-3">
                  <h3 className="text-[12px] font-semibold mb-2">Key risks</h3>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] text-muted-foreground">
                    {resolved.keyRisks.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </section>
              </div>
            </>
          )}

          <footer className="text-[10px] text-muted-foreground py-2 leading-relaxed border-t border-border/50">
            {data.disclaimer}
          </footer>
        </div>
      </div>
    </div>
  );
}
