import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type {
  ConvictionIdea,
  ConvictionIdeasResponse,
  ConvictionRole,
  ConvictionRoleInfo,
  ScenarioModel,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Anchor,
  Scale,
  Sparkles,
  Info,
  Sun,
  Moon,
  Target,
  ShieldAlert,
  AlertTriangle,
  ListChecks,
  CheckCircle2,
} from "lucide-react";
import { fmtAgo, fmtPrice, fmtCompactCurrency, fmtPct } from "@/lib/format";
import { WordMark } from "@/components/Logo";
import { MobileNav } from "@/components/MobileNav";

function useTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);
  return { dark, setDark };
}

const ROLE_ICON: Record<ConvictionRole, typeof Anchor> = {
  "core-compounder": Anchor,
  "asymmetric-candidate": Scale,
  "high-variance-optionality": Sparkles,
};

const SIZING_LABEL: Record<string, string> = {
  watchlist: "Watchlist band",
  starter: "Starter band",
  core: "Core band",
};

const REVIEW_LABEL: Record<string, string> = {
  fresh: "Fresh",
  monitoring: "Monitoring",
  "needs-review": "Needs review",
};

function perfTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-muted-foreground";
  return v >= 0 ? "text-pos" : "text-neg";
}

function MetricCard({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: string;
  testId: string;
}) {
  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 px-3 py-2"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm font-semibold ${tone ?? "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function BulletSection({
  heading,
  icon: Icon,
  items,
  testId,
  tone,
}: {
  heading: string;
  icon: typeof Target;
  items: string[];
  testId: string;
  tone?: string;
}) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${tone ?? "text-primary/80"}`} aria-hidden />
        {heading}
      </div>
      <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/90">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function ScenarioCard({ model }: { model: ScenarioModel }) {
  const km = (c: ScenarioModel["bear"]) => c.outputs;
  const cases = [
    { c: model.bear, color: "text-neg" },
    { c: model.base, color: "text-foreground" },
    { c: model.bull, color: "text-pos" },
  ];
  return (
    <div
      className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
      data-testid="idea-scenario-card"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Target className="h-3.5 w-3.5 text-primary/80" aria-hidden />
          Scenario model ({model.horizonYears}y, {model.classification})
        </div>
        <div className="text-[11px] text-muted-foreground">
          Reward/risk:{" "}
          <span className="font-semibold text-foreground">
            {model.rewardRiskRatio != null
              ? `${model.rewardRiskRatio.toFixed(2)}×`
              : "—"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {cases.map(({ c, color }) => (
          <div
            key={c.key}
            className="rounded border border-border/60 bg-background/40 px-2 py-2 text-center"
            data-testid={`scenario-case-${c.key}`}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
            <div className={`text-sm font-semibold ${color}`}>
              {fmtPct(km(c).impliedReturnPct, 0)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {km(c).targetPrice != null
                ? fmtPrice(km(c).targetPrice)
                : `${km(c).targetMultipleOfCurrent}×`}
            </div>
          </div>
        ))}
      </div>
      {model.modelWarnings.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {model.modelWarnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500/80" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground italic">{model.disclaimer}</p>
    </div>
  );
}

function ChecklistRow({
  label,
  score,
  note,
}: {
  label: string;
  score: number;
  note: string;
}) {
  const tone =
    score >= 70 ? "bg-pos" : score >= 45 ? "bg-amber-500" : "bg-neg";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{score}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{note}</p>
    </div>
  );
}

function IdeaSelectorGroup({
  role,
  ideas,
  selectedId,
  onSelect,
}: {
  role: ConvictionRoleInfo;
  ideas: ConvictionIdea[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (ideas.length === 0) return null;
  const Icon = ROLE_ICON[role.key];
  return (
    <div className="space-y-1.5" data-testid={`selector-group-${role.key}`}>
      <div className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary/80" aria-hidden />
        {role.label}
      </div>
      <ul className="space-y-1">
        {ideas.map((idea) => {
          const active = idea.id === selectedId;
          return (
            <li key={idea.id}>
              <button
                type="button"
                data-testid={`selector-item-${idea.id}`}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(idea.id)}
                className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border/70 bg-card/40 hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-foreground">
                    {idea.ticker}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {idea.convictionScore}/100
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {idea.companyName}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function IdeaDetail({ idea }: { idea: ConvictionIdea }) {
  const km = idea.keyMetrics;
  const perf = km?.performance ?? null;
  return (
    <div className="space-y-4" data-testid="idea-detail">
      {/* Summary header */}
      <div className="rounded-md border border-border/70 bg-card/40 p-4 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2
              className="text-xl font-bold text-foreground"
              data-testid="idea-title"
            >
              {idea.ticker}
            </h2>
            <p className="text-sm text-muted-foreground">{idea.companyName}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Conviction
            </div>
            <div className="text-xl font-bold text-primary">
              {idea.convictionScore}
              <span className="text-sm text-muted-foreground">/100</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5">
            {idea.roleLabel}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/80">
            {idea.targetOutcome}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/80">
            {idea.timeHorizon}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/80">
            {REVIEW_LABEL[idea.reviewStatus] ?? idea.reviewStatus}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {idea.themes.map((t) => (
            <span
              key={t}
              className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Metrics row */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2"
        data-testid="idea-metrics"
      >
        <MetricCard
          label="Price"
          value={km?.price != null ? fmtPrice(km.price, km.priceCurrency ?? "USD") : "N/A"}
          testId="metric-price"
        />
        <MetricCard
          label="Market cap"
          value={km?.marketCap != null ? fmtCompactCurrency(km.marketCap) : "N/A"}
          testId="metric-marketcap"
        />
        <MetricCard
          label="P/E (TTM)"
          value={km?.peRatio != null ? km.peRatio.toFixed(1) : "N/A"}
          testId="metric-pe"
        />
        <MetricCard
          label="12m return"
          value={fmtPct(perf?.change12mPct, 1)}
          tone={perfTone(perf?.change12mPct)}
          testId="metric-perf12m"
        />
        <MetricCard
          label="Reward / risk"
          value={
            idea.scenarioModel?.rewardRiskRatio != null
              ? `${idea.scenarioModel.rewardRiskRatio.toFixed(2)}×`
              : "N/A"
          }
          testId="metric-rewardrisk"
        />
      </div>

      {km?.metricWarnings && km.metricWarnings.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground" data-testid="idea-metric-warnings">
          {km.metricWarnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500/80" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}

      {/* Scenario card */}
      {idea.scenarioModel ? (
        <ScenarioCard model={idea.scenarioModel} />
      ) : (
        <div
          className="rounded-md border border-border/70 bg-card/40 p-3 text-sm text-muted-foreground"
          data-testid="idea-scenario-card"
        >
          Scenario model unavailable for this idea.
        </div>
      )}

      {/* Thesis / what must be true */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BulletSection
          heading="Thesis"
          icon={Target}
          items={idea.thesis}
          testId="idea-thesis"
        />
        <BulletSection
          heading="What must be true"
          icon={CheckCircle2}
          items={idea.whatMustBeTrue}
          testId="idea-whatmustbetrue"
        />
        <BulletSection
          heading="Catalysts"
          icon={Sparkles}
          items={idea.catalysts}
          testId="idea-catalysts"
        />
        <BulletSection
          heading="Risks"
          icon={ShieldAlert}
          items={idea.risks}
          testId="idea-risks"
          tone="text-amber-500/90"
        />
      </div>

      {/* Kill criteria */}
      <BulletSection
        heading="Kill criteria (what removes it)"
        icon={AlertTriangle}
        items={idea.killCriteria}
        testId="idea-killcriteria"
        tone="text-neg"
      />

      {/* Guardrails */}
      <div
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        data-testid="idea-guardrails"
      >
        <div className="rounded-md border border-border/70 bg-card/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Downside guardrail
          </div>
          <p className="text-xs text-foreground/90 mt-0.5">
            {idea.downsideGuardrail}
          </p>
        </div>
        <div className="rounded-md border border-border/70 bg-card/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Position sizing (educational)
          </div>
          <div className="text-sm font-semibold text-foreground mt-0.5">
            {SIZING_LABEL[idea.positionSizingBand] ?? idea.positionSizingBand}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {idea.positionSizingNote}
          </p>
        </div>
        <div className="rounded-md border border-border/70 bg-card/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Review cadence
          </div>
          <p className="text-xs text-foreground/90 mt-0.5">
            {idea.reviewFrequency}
          </p>
        </div>
      </div>

      {/* Evidence checklist */}
      <div
        className="rounded-md border border-border/70 bg-card/40 p-3 space-y-3"
        data-testid="idea-checklist"
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5 text-primary/80" aria-hidden />
          Evidence checklist (qualitative self-assessment)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {idea.checklist.map((item) => (
            <ChecklistRow
              key={item.key}
              label={item.label}
              score={item.score}
              note={item.note}
            />
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        {idea.sourceNote}
      </p>
    </div>
  );
}

export default function ConvictionIdeas() {
  const { dark, setDark } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useQuery<ConvictionIdeasResponse>({
    queryKey: ["/api/conviction-ideas"],
  });

  const data = query.data;
  const ideas = data?.ideas ?? [];
  const roles = data?.roles ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;

  // Default-select the first idea once data loads.
  useEffect(() => {
    if (!selectedId && ideas.length > 0) {
      setSelectedId(ideas[0].id);
    }
  }, [ideas, selectedId]);

  const selected = useMemo(
    () => ideas.find((i) => i.id === selectedId) ?? null,
    [ideas, selectedId],
  );

  const ideasByRole = useMemo(() => {
    const map = new Map<ConvictionRole, ConvictionIdea[]>();
    for (const idea of ideas) {
      const arr = map.get(idea.role) ?? [];
      arr.push(idea);
      map.set(idea.role, arr);
    }
    return map;
  }, [ideas]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="page-conviction">
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-back-dashboard"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <span className="text-muted-foreground">·</span>
          <WordMark />
          <span className="text-muted-foreground hidden md:inline">·</span>
          <h1
            className="hidden md:inline text-base font-semibold"
            data-testid="text-page-title"
          >
            Conviction Ideas
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {data?.lastUpdated && (
            <span
              className="hidden lg:inline text-[11px] text-muted-foreground"
              data-testid="text-last-updated"
            >
              Updated {fmtAgo(data.lastUpdated)}
            </span>
          )}
          <Link
            href="/stock-picks"
            className="hidden sm:inline-flex items-center gap-1 h-8 px-2 rounded text-[12px] text-muted-foreground hover:text-foreground"
            data-testid="link-stock-picks"
          >
            Stock Picks
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDark(!dark)}
            aria-label="Toggle theme"
            data-testid="button-theme"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <div className="px-4 md:px-6 py-5 space-y-5 max-w-[1600px] mx-auto pb-20 md:pb-5">
          <div className="md:hidden">
            <h1 className="text-lg font-semibold">Conviction Ideas</h1>
          </div>

          <div
            className="flex items-start gap-2 rounded-md border border-border/70 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground"
            data-testid="page-disclaimer"
          >
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/80" />
            <p className="leading-relaxed">
              <span className="text-foreground">
                Starter research ideas, not recommendations.
              </span>{" "}
              A small, deliberate research book — not personalized financial
              advice. Conviction scores, checklist scores, and scenario models
              are hypothetical research inputs, not predictions or targets.
              Position-sizing bands are educational labels, not allocation
              guidance. Investments can lose value. Consult a qualified
              financial professional before acting.
            </p>
          </div>

          {isError && (
            <div
              className="rounded-md border border-neg/30 bg-neg/5 px-3 py-3 text-sm text-neg"
              data-testid="error-banner"
            >
              Failed to load conviction ideas:{" "}
              {(query.error as Error)?.message ?? "unknown"}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-4">
            <aside
              className="md:sticky md:top-[72px] md:self-start space-y-4"
              data-testid="conviction-selector"
            >
              {isLoading && ideas.length === 0 ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 rounded-md" />
                  ))}
                </div>
              ) : (
                roles.map((role) => (
                  <IdeaSelectorGroup
                    key={role.key}
                    role={role}
                    ideas={ideasByRole.get(role.key) ?? []}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ))
              )}
            </aside>

            <div className="min-w-0" data-testid="conviction-pane">
              {isLoading && !selected ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 rounded-md" />
                  <Skeleton className="h-16 rounded-md" />
                  <Skeleton className="h-40 rounded-md" />
                </div>
              ) : selected ? (
                <IdeaDetail idea={selected} />
              ) : (
                !isError && (
                  <div className="text-sm text-muted-foreground">
                    No idea selected.
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </main>

      <MobileNav />
    </div>
  );
}
