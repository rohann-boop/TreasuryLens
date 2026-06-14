import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type {
  InvestmentGroupsResponse,
  InvestmentGroupTemplateId,
  InvestmentGroupMember,
  QuantBacktestVerdict,
  RiskLevel,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Boxes,
  Sun,
  Moon,
  ShieldAlert,
  Sparkles,
  HelpCircle,
  RefreshCw,
  Plus,
  CheckCircle2,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { WordMark } from "@/components/Logo";
import { MobileNav } from "@/components/MobileNav";
import { PrimaryNav } from "@/components/PrimaryNav";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";

const RISK_LEVELS: RiskLevel[] = [
  "low",
  "moderate",
  "elevated",
  "high",
  "very high",
];

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  elevated: "Elevated",
  high: "High",
  "very high": "Very high",
};

function fmtPctVal(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtPct0(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${Math.round(n)}%`;
}

function toneClass(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground";
  return n > 0 ? "text-pos" : n < 0 ? "text-neg" : "text-foreground/90";
}

function verdictTone(v: QuantBacktestVerdict): string {
  switch (v) {
    case "edge":
      return "border-pos/40 bg-pos/10 text-pos";
    case "no-edge":
      return "border-neg/40 bg-neg/10 text-neg";
    case "mixed":
      return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function verdictLabel(v: QuantBacktestVerdict): string {
  switch (v) {
    case "edge":
      return "Edge";
    case "no-edge":
      return "No edge";
    case "mixed":
      return "Mixed";
    default:
      return "Thin";
  }
}

function buildQuery(args: {
  templateId: InvestmentGroupTemplateId;
  minScore: number;
  maxRisk: RiskLevel;
  maxHoldings: number;
}): string {
  const p = new URLSearchParams({
    template: args.templateId,
    minScore: String(args.minScore),
    maxRisk: args.maxRisk,
    maxHoldings: String(args.maxHoldings),
  });
  return `/api/investment-groups?${p.toString()}`;
}

export default function InvestmentGroups() {
  const { dark, setDark } = useTheme();
  const { toast } = useToast();

  const [templateId, setTemplateId] =
    useState<InvestmentGroupTemplateId>("core-compounders");
  const [minScore, setMinScore] = useState(50);
  const [maxRisk, setMaxRisk] = useState<RiskLevel>("high");
  const [maxHoldings, setMaxHoldings] = useState(8);
  const [added, setAdded] = useState(false);

  const queryUrl = useMemo(
    () => buildQuery({ templateId, minScore, maxRisk, maxHoldings }),
    [templateId, minScore, maxRisk, maxHoldings],
  );

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<InvestmentGroupsResponse>({
      queryKey: [queryUrl],
    });

  // Reset the "added" confirmation whenever the generated set changes.
  useEffect(() => {
    setAdded(false);
  }, [queryUrl]);

  const templates = data?.templates ?? [];
  const group = data?.group ?? null;

  const addToWatchlist = useMutation({
    mutationFn: async () => {
      if (!group || group.members.length === 0) return;
      // Ticker-only adds — the existing POST infers name/role and slots each
      // ticker into a watchlist group named after this basket. Sequential to
      // keep the server's per-add cache invalidation simple.
      for (const m of group.members) {
        await apiRequest("POST", "/api/conviction-ideas", {
          ticker: m.ticker,
          theme: group.name,
        });
      }
    },
    onSuccess: () => {
      setAdded(true);
      toast({
        title: `Added ${group?.members.length ?? 0} names to “${group?.name}”`,
        description: "Open the Dashboard watchlist to review the new group.",
      });
    },
    onError: (e) =>
      toast({
        title: "Couldn't add to watchlist",
        description: (e as Error).message,
        variant: "destructive",
      }),
  });

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-background text-foreground pb-16 md:pb-0"
      data-testid="investment-groups-page"
    >
      {/* Header */}
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <WordMark />
          <span className="hidden md:inline text-[11px] text-muted-foreground border-l border-border pl-3">
            Investment Groups — model-driven research baskets
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PrimaryNav className="mr-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDark(!dark)}
            aria-label="Toggle theme"
            data-testid="button-theme"
          >
            {dark ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-6 py-5 space-y-5">
        {/* Intro / framing */}
        <div className="space-y-1.5">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Boxes className="h-5 w-5 text-primary" aria-hidden />
            Investment Groups
          </h1>
          <p className="text-[12px] text-muted-foreground leading-relaxed max-w-3xl">
            Turn the Quant / model-scored universe into{" "}
            <span className="font-medium text-foreground/90">
              explainable research baskets
            </span>
            . Pick a template, set your controls, and the model ranks the
            existing universe into a named group — with the factor reads and the
            reasoning shown for every name. These are research watchlists, not
            personalized financial advice.
          </p>
          <div
            className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 max-w-3xl"
            data-testid="investment-groups-disclaimer"
          >
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>
              Baskets are assembled deterministically from the model score, the
              scenario model and trailing performance. Validation
              badges come from a technical-only backtest of the momentum/risk
              slice — they do not validate these baskets as portfolios.
            </span>
          </div>
        </div>

        {/* Template chooser */}
        <section data-testid="investment-groups-templates" className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Template
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {templates.map((t) => {
              const active = t.id === templateId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  data-testid={`template-${t.id}`}
                  aria-pressed={active}
                  className={cn(
                    "text-left rounded-md border px-3 py-2.5 transition-colors hover-elevate",
                    active
                      ? "border-primary/60 bg-primary/5"
                      : "border-border/60 bg-card/40",
                  )}
                >
                  <p className="text-[12px] font-medium text-foreground/90 flex items-center gap-1.5">
                    {active && (
                      <Sparkles
                        className="h-3 w-3 text-primary shrink-0"
                        aria-hidden
                      />
                    )}
                    {t.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                    {t.blurb}
                  </p>
                </button>
              );
            })}
            {templates.length === 0 &&
              Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] rounded-md" />
              ))}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] gap-5">
          {/* Controls */}
          <section
            className="rounded-md border border-border/70 bg-card/40 p-4 space-y-4 h-fit"
            data-testid="investment-groups-controls"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Controls
            </h2>

            <div className="space-y-1.5" data-testid="control-min-score">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[12px] font-medium text-foreground/90">
                  Minimum model score
                </label>
                <span className="text-[12px] tabular-nums font-semibold text-foreground/90">
                  {minScore}
                </span>
              </div>
              <Slider
                value={[minScore]}
                min={0}
                max={100}
                step={5}
                onValueChange={(v) => setMinScore(v[0] ?? 0)}
                aria-label="Minimum model score"
              />
            </div>

            <div className="space-y-1.5" data-testid="control-max-risk">
              <label className="text-[12px] font-medium text-foreground/90">
                Max risk tolerance
              </label>
              <div className="flex flex-wrap gap-1.5">
                {RISK_LEVELS.map((r) => {
                  const active = r === maxRisk;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setMaxRisk(r)}
                      aria-pressed={active}
                      data-testid={`risk-${r.replace(/\s+/g, "-")}`}
                      className={cn(
                        "rounded border px-2 py-1 text-[11px] hover-elevate",
                        active
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border bg-background/60 text-muted-foreground",
                      )}
                    >
                      {RISK_LABEL[r]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5" data-testid="control-max-holdings">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[12px] font-medium text-foreground/90">
                  Max holdings
                </label>
                <span className="text-[12px] tabular-nums font-semibold text-foreground/90">
                  {maxHoldings}
                </span>
              </div>
              <Slider
                value={[maxHoldings]}
                min={3}
                max={20}
                step={1}
                onValueChange={(v) => setMaxHoldings(v[0] ?? 8)}
                aria-label="Max holdings"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-[11px]"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-regenerate"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")}
              />
              {isFetching ? "Generating…" : "Regenerate"}
            </Button>

            {group && !group.empty && (
              <Button
                size="sm"
                className="w-full h-8 text-[11px]"
                onClick={() => addToWatchlist.mutate()}
                disabled={addToWatchlist.isPending || added}
                data-testid="button-add-to-watchlist"
              >
                {added ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Added to watchlist
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    {addToWatchlist.isPending
                      ? "Adding…"
                      : `Add ${group.members.length} to watchlist group`}
                  </>
                )}
              </Button>
            )}

            {data && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Universe: {data.universeSize} names.{" "}
                {data.metricsStatus.livePricing
                  ? "Live pricing attached."
                  : "Pricing unavailable — curated factors only."}
              </p>
            )}
          </section>

          {/* Generated group */}
          <section className="space-y-4" data-testid="investment-groups-result">
            {isLoading ? (
              <Skeleton className="h-[320px] rounded-md" />
            ) : isError ? (
              <div
                className="rounded-md border border-neg/40 bg-neg/10 p-3 text-xs text-neg"
                data-testid="investment-groups-error"
              >
                Failed to build group: {(error as Error)?.message ?? "unknown"}
              </div>
            ) : group ? (
              <>
                {/* Group header + thesis */}
                <div className="rounded-md border border-border/70 bg-card/40 p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-primary" aria-hidden />
                      {group.name}
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge>{group.riskProfile}</Badge>
                      {group.validation && (
                        <span
                          className={cn(
                            "inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                            verdictTone(group.validation.verdict),
                          )}
                          title={group.validation.note}
                          data-testid="group-validation-badge"
                        >
                          {group.validation.badge}:{" "}
                          {verdictLabel(group.validation.verdict)}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    {group.thesis}
                  </p>
                  <p className="text-[11px] text-muted-foreground/90 leading-relaxed">
                    <span className="font-medium text-foreground/80">
                      Model lens:
                    </span>{" "}
                    {group.modelLens}
                  </p>
                  {group.upsideProfile && (
                    <p className="text-[11px] text-muted-foreground/90">
                      <span className="font-medium text-foreground/80">
                        Upside:
                      </span>{" "}
                      {group.upsideProfile}
                    </p>
                  )}
                  {group.validation && (
                    <div className="rounded border border-border/60 bg-background/40 px-2.5 py-1.5 text-[10px] text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground/80">
                        Validation ({group.validation.presetLabel}
                        {group.validation.windowKey
                          ? `, ${group.validation.windowKey}`
                          : ""}
                        ):
                      </span>{" "}
                      top-cohort {fmtPctVal(group.validation.selectedAvgReturnPct)}{" "}
                      ({fmtPctVal(group.validation.excessVsBenchmarkPct)} vs
                      benchmark
                      {group.validation.hitRatePct != null
                        ? `, ${Math.round(group.validation.hitRatePct)}% hit`
                        : ""}
                      ). {group.validation.note}
                    </div>
                  )}
                </div>

                {/* Members */}
                {group.empty ? (
                  <div
                    className="rounded-md border border-dashed border-border bg-card/30 p-4 text-[12px] text-muted-foreground"
                    data-testid="group-empty"
                  >
                    {group.emptyNote}
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="group-members">
                    {group.members.map((m) => (
                      <MemberCard key={m.ticker} m={m} />
                    ))}
                  </div>
                )}

                {/* Explainability: why these names + what would change */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Explainer
                    title="Why these names?"
                    icon={<Sparkles className="h-3.5 w-3.5 text-primary" />}
                    items={group.whyTheseNames}
                    testId="why-these-names"
                  />
                  <Explainer
                    title="What would change this group?"
                    icon={<HelpCircle className="h-3.5 w-3.5 text-primary/80" />}
                    items={group.whatWouldChange}
                    testId="what-would-change"
                  />
                </div>

                {data && (
                  <p
                    className="text-[10px] text-muted-foreground italic leading-relaxed"
                    data-testid="investment-groups-footer-disclaimer"
                  >
                    {data.disclaimer}
                  </p>
                )}
              </>
            ) : null}
          </section>
        </div>
      </main>

      <MobileNav />
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function MemberCard({ m }: { m: InvestmentGroupMember }) {
  const f = m.factors;
  return (
    <div
      className="rounded-md border border-border/60 bg-card/40 px-3 py-2.5 space-y-1.5"
      data-testid={`member-${m.ticker}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <span className="text-[13px] font-semibold text-foreground/90">
            {m.ticker}
          </span>
          <span className="ml-2 text-[11px] text-muted-foreground truncate">
            {m.companyName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {f.scenarioClassification && (
            <Badge>{f.scenarioClassification}</Badge>
          )}
          {f.riskLevel && <Badge>{f.riskLevel} risk</Badge>}
          <span
            className="inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary"
            title="Template fit score (0-100)"
          >
            Fit {m.fitScore}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {m.rationale}
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
        <Factor label="Upside" value={fmtPct0(f.upsidePct)} tone="text-pos" />
        <Factor
          label="Downside"
          value={fmtPct0(f.downsidePct)}
          tone="text-neg"
        />
        <Factor
          label="6m"
          value={fmtPct0(f.change6mPct)}
          tone={toneClass(f.change6mPct)}
        />
        <Factor
          label="12m"
          value={fmtPct0(f.change12mPct)}
          tone={toneClass(f.change12mPct)}
        />
      </div>

      {m.themes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {m.themes.slice(0, 4).map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded bg-muted/50 px-1.5 py-0.5 text-[9px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Factor({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <span className="text-muted-foreground">
      {label}{" "}
      <span className={cn("font-semibold text-foreground/90", tone)}>
        {value}
      </span>
    </span>
  );
}

function Explainer({
  title,
  icon,
  items,
  testId,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  testId: string;
}) {
  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-1.5"
      data-testid={testId}
    >
      <h3 className="text-[12px] font-semibold flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      <ul className="space-y-1 list-disc pl-4 text-[11px] text-muted-foreground leading-relaxed">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
