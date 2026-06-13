import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  OptionStructureKind,
  RiskLevel,
  StockPickTheme,
  TradeIdeaLong,
  TradeIdeaOption,
  TradeIdeaTier,
  TradeIdeaUpsideClass,
  TradeIdeasResponse,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Target,
  Sun,
  Moon,
  Info,
  ShieldAlert,
  ArrowUpDown,
  Search,
  X,
  TrendingUp,
  Layers,
  Sparkles,
} from "lucide-react";
import { fmtAgo, fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ScenarioDerivation } from "@/components/ScenarioDerivation";
import { WordMark } from "@/components/Logo";
import { MobileNav } from "@/components/MobileNav";
import { PrimaryNav } from "@/components/PrimaryNav";
import { useTheme } from "@/lib/theme";

type SubTab = "longs" | "options";

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  elevated: "Elevated",
  high: "High",
  "very high": "Very high",
};

const RISK_RANK: Record<RiskLevel, number> = {
  low: 1,
  moderate: 2,
  elevated: 3,
  high: 4,
  "very high": 5,
};

const THEME_LABEL: Record<StockPickTheme, string> = {
  "ai-hardware": "AI Hardware",
  "ai-software": "AI Software",
  "ai-energy": "AI Energy",
};

const UPSIDE_LABEL: Record<TradeIdeaUpsideClass, string> = {
  defensive: "Defensive",
  compounder: "Compounder",
  "2x": "2x",
  "3x": "3x",
  "5x+": "5x+",
};

// ─── small presentational helpers ───────────────────────────────────────────

function pctTone(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "text-muted-foreground";
  if (p > 0) return "text-pos";
  if (p < 0) return "text-neg";
  return "text-muted-foreground";
}

function ScoreBadge({ score, tier }: { score: number; tier: TradeIdeaTier }) {
  const tone =
    tier === "high"
      ? "bg-pos/10 text-pos border-pos/30"
      : tier === "medium"
        ? "bg-primary/10 text-primary border-primary/30"
        : "bg-muted/40 text-muted-foreground border-border/60";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[2.25rem] px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums border",
        tone,
      )}
    >
      {score}
    </span>
  );
}

function RiskBadge({ value }: { value: RiskLevel }) {
  const tone =
    value === "low"
      ? "bg-pos/10 text-pos border-pos/30"
      : value === "moderate"
        ? "bg-primary/10 text-primary border-primary/30"
        : value === "elevated"
          ? "bg-warn/10 text-warn border-warn/30"
          : "bg-neg/10 text-neg border-neg/30";
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border",
        tone,
      )}
    >
      {RISK_LABEL[value]}
    </span>
  );
}

function UpsideBadge({ value }: { value: TradeIdeaUpsideClass }) {
  const tone =
    value === "3x" || value === "5x+"
      ? "bg-warn/10 text-warn border-warn/30"
      : value === "2x"
        ? "bg-primary/10 text-primary border-primary/30"
        : value === "defensive"
          ? "bg-muted/40 text-muted-foreground border-border/60"
          : "bg-pos/10 text-pos border-pos/30";
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border",
        tone,
      )}
    >
      {UPSIDE_LABEL[value]}
    </span>
  );
}

function MultipleBadge({ option }: { option: TradeIdeaOption }) {
  if (!option.multipleLabel) return <span className="text-muted-foreground">—</span>;
  const tone = option.tripleCandidate
    ? "bg-warn/15 text-warn border-warn/40"
    : "bg-primary/15 text-primary border-primary/40";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border",
        tone,
      )}
    >
      <Sparkles className="h-2.5 w-2.5" aria-hidden />
      {option.tripleCandidate ? "3x" : "2x"}
    </span>
  );
}

function ConvictionBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const tone =
    clamped >= 70 ? "bg-pos" : clamped >= 50 ? "bg-primary" : clamped >= 30 ? "bg-warn" : "bg-neg";
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 rounded bg-muted/40 overflow-hidden">
        <div className={cn("h-full", tone)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="tabular-nums text-[11px] text-muted-foreground">{clamped}</span>
    </div>
  );
}

function SortHeader<K extends string>({
  label,
  k,
  active,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  k: K;
  active: K;
  dir: "asc" | "desc";
  onSort: (k: K) => void;
  align?: "left" | "right";
}) {
  const isActive = active === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={cn(
        "inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors",
        align === "right" ? "justify-end w-full" : "",
        isActive ? "text-foreground" : "",
      )}
    >
      <span>{label}</span>
      <ArrowUpDown className={cn("h-3 w-3", isActive ? "opacity-100" : "opacity-40")} />
      {isActive && (
        <span className="text-[9px] tabular-nums opacity-70">{dir === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search ticker or company"}
        className="w-full h-9 pl-8 pr-8 rounded-md border border-border/70 bg-background/60 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-card/60"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function FilterChips<T extends string | number>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  selected: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-0.5">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = selected === o.key;
          return (
            <button
              key={o.key}
              onClick={() => onChange(o.key)}
              className={cn(
                "rounded-md border px-2.5 py-1 transition-colors text-[11px]",
                active
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/30 text-foreground/90 hover:bg-card/60",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Longs table ─────────────────────────────────────────────────────────────

type LongSortKey =
  | "ideaScore"
  | "ticker"
  | "conviction"
  | "bull"
  | "risk"
  | "entry";

function compareStr(a: string, b: string, dir: "asc" | "desc") {
  const r = a.localeCompare(b);
  return dir === "asc" ? r : -r;
}
function compareNum(a: number | null, b: number | null, dir: "asc" | "desc") {
  const av = a ?? -Infinity;
  const bv = b ?? -Infinity;
  return dir === "asc" ? av - bv : bv - av;
}

function LongsTable({
  rows,
  onSelect,
  selected,
}: {
  rows: TradeIdeaLong[];
  onSelect: (t: string) => void;
  selected: string | null;
}) {
  const [sortKey, setSortKey] = useState<LongSortKey>("ideaScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const onSort = (k: LongSortKey) => {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "ticker" || k === "entry" ? "asc" : "desc");
    }
  };
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "ticker":
          return compareStr(a.ticker, b.ticker, sortDir);
        case "conviction":
          return compareNum(a.convictionScore, b.convictionScore, sortDir);
        case "bull":
          return compareNum(a.bullUpsidePct, b.bullUpsidePct, sortDir);
        case "risk":
          return compareNum(RISK_RANK[a.riskLevel], RISK_RANK[b.riskLevel], sortDir);
        case "entry":
          return compareStr(a.entryLabel, b.entryLabel, sortDir);
        default:
          return compareNum(a.ideaScore, b.ideaScore, sortDir);
      }
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border/70 bg-background/35 px-4 py-8 text-center text-[12px] text-muted-foreground">
        No long ideas match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-md border border-border/70 bg-background/35">
      <table className="w-full text-[12px]">
        <thead className="border-b border-border/70 bg-card/60">
          <tr>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Score" k="ideaScore" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Ticker" k="ticker" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-left hidden sm:table-cell">Upside</th>
            <th className="px-3 py-2 text-left hidden md:table-cell">
              <SortHeader label="Conviction" k="conviction" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Entry" k="entry" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-right hidden md:table-cell">
              <SortHeader label="Bull" k="bull" active={sortKey} dir={sortDir} onSort={onSort} align="right" />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Risk" k="risk" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.ticker}
              onClick={() => onSelect(r.ticker)}
              className={cn(
                "border-b border-border/40 last:border-0 cursor-pointer transition-colors",
                r.ticker === selected ? "bg-primary/10" : "hover:bg-card/40",
              )}
            >
              <td className="px-3 py-2">
                <ScoreBadge score={r.ideaScore} tier={r.tier} />
              </td>
              <td className="px-3 py-2">
                <div className="font-medium tabular-nums">{r.ticker}</div>
                <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                  {r.companyName}
                </div>
              </td>
              <td className="px-3 py-2 hidden sm:table-cell">
                <UpsideBadge value={r.upsideClass} />
              </td>
              <td className="px-3 py-2 hidden md:table-cell">
                <ConvictionBar score={r.convictionScore} />
              </td>
              <td className="px-3 py-2 text-[11px] text-foreground/90">{r.entryLabel}</td>
              <td className={cn("px-3 py-2 text-right tabular-nums hidden md:table-cell", pctTone(r.bullUpsidePct))}>
                {fmtPct(r.bullUpsidePct, 0)}
              </td>
              <td className="px-3 py-2">
                <RiskBadge value={r.riskLevel} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Options table ─────────────────────────────────────────────────────────

type OptionSortKey =
  | "actionability"
  | "ticker"
  | "structure"
  | "thesis"
  | "pop"
  | "maxRisk"
  | "breakeven"
  | "payoff";

function OptionsTable({
  rows,
  onSelect,
  selected,
}: {
  rows: TradeIdeaOption[];
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  const [sortKey, setSortKey] = useState<OptionSortKey>("actionability");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const onSort = (k: OptionSortKey) => {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "ticker" || k === "structure" || k === "maxRisk" ? "asc" : "desc");
    }
  };
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "ticker":
          return compareStr(a.ticker, b.ticker, sortDir);
        case "structure":
          return compareStr(a.structureLabel, b.structureLabel, sortDir);
        case "thesis":
          return compareNum(a.thesisScore, b.thesisScore, sortDir);
        case "pop":
          return compareNum(a.estProfitProbability, b.estProfitProbability, sortDir);
        case "maxRisk":
          return compareNum(a.maxRisk, b.maxRisk, sortDir);
        case "breakeven":
          return compareNum(a.breakeven, b.breakeven, sortDir);
        case "payoff":
          return compareNum(a.bullPayoffMultiple, b.bullPayoffMultiple, sortDir);
        default:
          return compareNum(a.actionabilityScore, b.actionabilityScore, sortDir);
      }
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border/70 bg-background/35 px-4 py-8 text-center text-[12px] text-muted-foreground">
        No option ideas match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-md border border-border/70 bg-background/35">
      <table className="w-full text-[12px]">
        <thead className="border-b border-border/70 bg-card/60">
          <tr>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Score" k="actionability" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Ticker" k="ticker" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Structure" k="structure" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-left hidden lg:table-cell">Target</th>
            <th className="px-3 py-2 text-center">2x/3x</th>
            <th className="px-3 py-2 text-right hidden sm:table-cell">
              <SortHeader label="P(profit)" k="pop" active={sortKey} dir={sortDir} onSort={onSort} align="right" />
            </th>
            <th className="px-3 py-2 text-right hidden md:table-cell">
              <SortHeader label="Max risk" k="maxRisk" active={sortKey} dir={sortDir} onSort={onSort} align="right" />
            </th>
            <th className="px-3 py-2 text-right hidden lg:table-cell">
              <SortHeader label="Breakeven" k="breakeven" active={sortKey} dir={sortDir} onSort={onSort} align="right" />
            </th>
            <th className="px-3 py-2 text-right hidden md:table-cell">
              <SortHeader label="Bull ×" k="payoff" active={sortKey} dir={sortDir} onSort={onSort} align="right" />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => (
            <tr
              key={o.id}
              onClick={() => onSelect(o.id)}
              className={cn(
                "border-b border-border/40 last:border-0 cursor-pointer transition-colors",
                o.id === selected ? "bg-primary/10" : "hover:bg-card/40",
              )}
            >
              <td className="px-3 py-2">
                <ScoreBadge score={o.actionabilityScore} tier={o.tier} />
              </td>
              <td className="px-3 py-2">
                <div className="font-medium tabular-nums">{o.ticker}</div>
                <div className="text-[10px] text-muted-foreground truncate max-w-[130px]">
                  {o.companyName}
                </div>
              </td>
              <td className="px-3 py-2 text-[11px]">{o.structureLabel}</td>
              <td className="px-3 py-2 text-[11px] text-muted-foreground hidden lg:table-cell">
                {o.scenarioTargetLabel}
              </td>
              <td className="px-3 py-2 text-center">
                <MultipleBadge option={o} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                {o.estProfitProbability != null ? `${Math.round(o.estProfitProbability * 100)}%` : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                {o.maxRisk != null ? fmtPrice(o.maxRisk, o.priceCurrency ?? "USD") : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums hidden lg:table-cell">
                {o.breakeven != null ? fmtPrice(o.breakeven, o.priceCurrency ?? "USD") : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                {o.bullPayoffMultiple != null ? `${o.bullPayoffMultiple.toFixed(1)}x` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Detail drawers ──────────────────────────────────────────────────────────

function Bullets({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
        {label}
      </div>
      <ul className="list-disc list-inside text-[12px] leading-relaxed space-y-1">
        {items.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

function LongDetail({ long }: { long: TradeIdeaLong }) {
  const cur = long.priceCurrency ?? "USD";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={long.ideaScore} tier={long.tier} />
        <UpsideBadge value={long.upsideClass} />
        <RiskBadge value={long.riskLevel} />
        <span className="text-[11px] text-muted-foreground">Entry: {long.entryLabel}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Bear downside</div>
          <div className={cn("text-[13px] font-semibold tabular-nums", pctTone(long.bearDownsidePct))}>
            {fmtPct(long.bearDownsidePct, 0)}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {fmtPrice(long.bearTargetPrice, cur)}
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Base upside</div>
          <div className={cn("text-[13px] font-semibold tabular-nums", pctTone(long.baseUpsidePct))}>
            {fmtPct(long.baseUpsidePct, 0)}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {fmtPrice(long.baseTargetPrice, cur)}
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Bull upside</div>
          <div className={cn("text-[13px] font-semibold tabular-nums", pctTone(long.bullUpsidePct))}>
            {fmtPct(long.bullUpsidePct, 0)}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {fmtPrice(long.bullTargetPrice, cur)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">
          Price <span className="text-foreground tabular-nums">{fmtPrice(long.price, cur)}</span>
        </span>
        <span className="text-muted-foreground">
          Reward/Risk{" "}
          <span className="text-foreground tabular-nums">
            {long.rewardRisk != null ? `${long.rewardRisk.toFixed(1)}x` : "—"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Invalidation{" "}
          <span className="text-foreground tabular-nums">{fmtPrice(long.invalidationLevel, cur)}</span>
        </span>
      </div>

      <Bullets label="Why this idea" items={long.rationale} />
      <Bullets label="Thesis" items={long.thesis} />
      <Bullets label="Catalysts / what must be true" items={long.whatMustBeTrue} />

      <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warn" aria-hidden />
        <div>
          <span className="font-medium text-foreground/90">Downside guardrail: </span>
          {long.downsideGuardrail}
        </div>
      </div>

      <Bullets label="What would change the view" items={long.whatWouldChangeView} />

      <ScenarioDerivation
        method={long.scenarioMethod}
        coverage={long.scenarioCoverage}
        methodology={long.scenarioMethodology}
        horizonYears={long.scenarioHorizonYears}
        inputs={long.scenarioInputs}
        missingInputs={long.scenarioMissingInputs}
        modelWarnings={long.scenarioModelWarnings}
        bull={long.bullDerivation}
        base={long.baseDerivation}
        bear={long.bearDerivation}
        analystEstimates={long.scenarioAnalystEstimates}
      />

      <div className="text-[10px] text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
        Source / model: {long.sourceNote} · Data confidence: {long.dataConfidence}. Idea score is a
        transparent blend of conviction, scenario reward/risk, entry quality and base-case room.
        Research only — not financial advice.
      </div>
    </div>
  );
}

const STRUCTURE_BIAS: Record<OptionStructureKind, string> = {
  "long-call": "Bullish · convex · max loss = premium",
  "bull-call-spread": "Bullish · defined risk + defined reward",
  "call-diagonal": "Bullish · time spread · finances the long leg",
  "cash-secured-put": "Bullish/neutral · income + entry below market",
  "bull-put-spread": "Bullish · defined-risk credit",
};

function OptionDetail({ option }: { option: TradeIdeaOption }) {
  const cur = option.priceCurrency ?? "USD";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={option.actionabilityScore} tier={option.tier} />
        {option.multipleLabel && <MultipleBadge option={option} />}
        <span className="text-[11px] text-muted-foreground">{STRUCTURE_BIAS[option.kind]}</span>
      </div>

      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
        <span>
          Modeled fallback — no live option chain. Premiums, breakeven, max-loss and probability are
          illustrative estimates from current price, a {option.ivProxyPct}% volatility/risk proxy and
          the scenario target. Verify with your broker.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Stat label="Underlying" value={fmtPrice(option.price, cur)} />
        <Stat label="Scenario target" value={`${fmtPrice(option.scenarioTargetPrice, cur)} (${option.scenarioTargetLabel})`} />
        <Stat label="Breakeven" value={fmtPrice(option.breakeven, cur)} />
        <Stat
          label="Est. P(profit)"
          value={option.estProfitProbability != null ? `${Math.round(option.estProfitProbability * 100)}%` : "—"}
        />
        <Stat
          label={option.netCredit != null ? "Net credit /sh" : "Net debit /sh"}
          value={fmtPrice(option.netCredit ?? option.netDebit, cur)}
        />
        <Stat label="Max risk /sh" value={fmtPrice(option.maxRisk, cur)} />
        <Stat label="Max reward /sh" value={option.maxReward != null ? fmtPrice(option.maxReward, cur) : "Uncapped"} />
        <Stat
          label="Bull payoff on risk"
          value={option.bullPayoffMultiple != null ? `${option.bullPayoffMultiple.toFixed(1)}x` : "—"}
        />
        <Stat label="Horizon" value={option.expiryHorizonLabel} />
        <Stat label="Vol proxy" value={`${option.ivProxyPct}%`} />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Legs (modeled)</div>
        <div className="rounded-md border border-border/60 bg-background/35 divide-y divide-border/40">
          {option.legs.map((leg, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[11px]">
              <span className={cn("font-medium uppercase", leg.action === "buy" ? "text-pos" : "text-neg")}>
                {leg.action} {leg.right}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {fmtPrice(leg.strike, cur)} · ~{leg.expiryMonths}m · prem {fmtPrice(leg.premium, cur)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Bullets label="Why selected" items={option.whySelected} />
      <Bullets label="What must happen" items={option.whatMustHappen} />

      <div className="rounded-md border border-border/60 bg-background/35 px-3 py-2 text-[11px]">
        <span className="font-medium text-foreground/90">Why not just buy the stock? </span>
        {option.whyNotJustStock}
      </div>

      <Bullets label="Limitations" items={option.limitations} />

      <div className="text-[10px] text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
        Ranked by payoff-adjusted actionability (thesis score + estimated profit probability + capped
        payoff multiple), not raw upside. 2x/3x flags describe a modeled bull scenario, not a
        guaranteed outcome. Options can expire worthless. Research only — not financial advice.
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/30 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-[12px] font-medium tabular-nums">{value}</div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TradeIdeas() {
  const { dark, setDark } = useTheme();
  const [tab, setTab] = useState<SubTab>("longs");

  const { data, isLoading, isError, error } = useQuery<TradeIdeasResponse>({
    queryKey: ["/api/trade-ideas"],
  });

  // Filters (shared search + per-tab specifics).
  const [search, setSearch] = useState("");
  const [themeFilter, setThemeFilter] = useState<StockPickTheme | "all">("all");
  const [upsideFilter, setUpsideFilter] = useState<TradeIdeaUpsideClass | "all">("all");
  const [maxRisk, setMaxRisk] = useState<RiskLevel>("very high");
  const [minScore, setMinScore] = useState<0 | 50 | 60 | 70>(0);
  const [entryAttractiveOnly, setEntryAttractiveOnly] = useState(false);
  const [catalystOnly, setCatalystOnly] = useState(false);

  const [structureFilter, setStructureFilter] = useState<OptionStructureKind | "all">("all");
  const [multipleOnly, setMultipleOnly] = useState(false);

  const [selectedLong, setSelectedLong] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const longs = data?.longs ?? [];
  const options = data?.options ?? [];

  const norm = search.trim().toLowerCase();

  const filteredLongs = useMemo(() => {
    return longs.filter((l) => {
      if (themeFilter !== "all" && !l.themes.includes(themeFilter)) return false;
      if (upsideFilter !== "all" && l.upsideClass !== upsideFilter) return false;
      if (RISK_RANK[l.riskLevel] > RISK_RANK[maxRisk]) return false;
      if (l.ideaScore < minScore) return false;
      if (entryAttractiveOnly && l.entryQuality !== "attractive") return false;
      if (catalystOnly && !l.hasCatalysts) return false;
      if (norm) {
        const hay = `${l.ticker} ${l.companyName}`.toLowerCase();
        if (!hay.includes(norm)) return false;
      }
      return true;
    });
  }, [longs, themeFilter, upsideFilter, maxRisk, minScore, entryAttractiveOnly, catalystOnly, norm]);

  const filteredOptions = useMemo(() => {
    return options.filter((o) => {
      if (structureFilter !== "all" && o.kind !== structureFilter) return false;
      if (multipleOnly && !o.doubleCandidate) return false;
      if (o.actionabilityScore < minScore) return false;
      if (norm) {
        const hay = `${o.ticker} ${o.companyName} ${o.structureLabel}`.toLowerCase();
        if (!hay.includes(norm)) return false;
      }
      return true;
    });
  }, [options, structureFilter, multipleOnly, minScore, norm]);

  const selectedLongRow = longs.find((l) => l.ticker === selectedLong) ?? null;
  const selectedOptionRow = options.find((o) => o.id === selectedOption) ?? null;

  const clearFilters = () => {
    setSearch("");
    setThemeFilter("all");
    setUpsideFilter("all");
    setMaxRisk("very high");
    setMinScore(0);
    setEntryAttractiveOnly(false);
    setCatalystOnly(false);
    setStructureFilter("all");
    setMultipleOnly(false);
  };

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-background text-foreground pb-16 md:pb-0"
      data-testid="trade-ideas-page"
    >
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <WordMark />
          <span className="hidden md:inline text-[11px] text-muted-foreground border-l border-border pl-3">
            Trade Ideas — actionable longs &amp; bullish option structures
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
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1500px] mx-auto px-4 md:px-6 py-5 space-y-4">
        {/* Intro */}
        <div className="space-y-1.5">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Target className="h-5 w-5 text-primary" aria-hidden />
            Trade Ideas
          </h1>
          <p className="text-[12px] text-muted-foreground leading-relaxed max-w-3xl">
            The most actionable ideas distilled from the curated universe. <b>Longs</b> ranks equity
            ideas by conviction, entry quality and scenario reward/risk. <b>Options</b> converts those
            same theses into ranked bullish structures, surfacing modeled 2x/3x scenarios. These are
            research ideas, not personalized financial advice.
          </p>
          <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 max-w-3xl">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>
              Option structures are <b>modeled fallbacks</b> — no live option chain is wired.
              Premiums, breakevens, max-loss and probabilities are illustrative estimates. 2x/3x flags
              describe a modeled bull scenario, never a promise. Options can expire worthless.
            </span>
          </div>
        </div>

        {/* Sub-tabs */}
        <div
          className="inline-flex rounded-md border border-border/70 overflow-hidden text-[12px]"
          role="tablist"
          data-testid="trade-ideas-tabs"
        >
          <button
            role="tab"
            aria-selected={tab === "longs"}
            data-testid="tab-longs"
            onClick={() => setTab("longs")}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-1.5 transition-colors",
              tab === "longs"
                ? "bg-primary/15 text-foreground"
                : "bg-background/30 text-muted-foreground hover:bg-card/60",
            )}
          >
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            Longs {longs.length > 0 && <span className="tabular-nums opacity-70">{longs.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={tab === "options"}
            data-testid="tab-options"
            onClick={() => setTab("options")}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-1.5 transition-colors border-l border-border/70",
              tab === "options"
                ? "bg-primary/15 text-foreground"
                : "bg-background/30 text-muted-foreground hover:bg-card/60",
            )}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden />
            Options {options.length > 0 && <span className="tabular-nums opacity-70">{options.length}</span>}
          </button>
        </div>

        {isError && (
          <div className="rounded-md border border-neg/40 bg-neg/10 px-3 py-2 text-[12px] text-neg">
            Couldn't load Trade Ideas: {(error as Error)?.message ?? "unknown error"}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[230px_minmax(0,1fr)] gap-4">
            {/* Filters */}
            <aside className="md:sticky md:top-[72px] md:self-start space-y-4">
              <SearchBox value={search} onChange={setSearch} />
              <FilterChips
                label="Min score"
                selected={minScore}
                onChange={(k) => setMinScore(k)}
                options={[
                  { key: 0, label: "Any" },
                  { key: 50, label: "50+" },
                  { key: 60, label: "60+" },
                  { key: 70, label: "70+" },
                ]}
              />
              {tab === "longs" ? (
                <>
                  <FilterChips
                    label="Theme"
                    selected={themeFilter}
                    onChange={setThemeFilter}
                    options={[
                      { key: "all", label: "All" },
                      { key: "ai-hardware", label: "Hardware" },
                      { key: "ai-software", label: "Software" },
                      { key: "ai-energy", label: "Energy" },
                    ]}
                  />
                  <FilterChips
                    label="Upside class"
                    selected={upsideFilter}
                    onChange={setUpsideFilter}
                    options={[
                      { key: "all", label: "All" },
                      { key: "compounder", label: "Compounder" },
                      { key: "2x", label: "2x" },
                      { key: "3x", label: "3x" },
                      { key: "5x+", label: "5x+" },
                    ]}
                  />
                  <FilterChips
                    label="Max risk"
                    selected={maxRisk}
                    onChange={setMaxRisk}
                    options={[
                      { key: "moderate", label: "≤ Moderate" },
                      { key: "elevated", label: "≤ Elevated" },
                      { key: "high", label: "≤ High" },
                      { key: "very high", label: "Any" },
                    ]}
                  />
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-0.5">
                      Quick filters
                    </div>
                    <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entryAttractiveOnly}
                        onChange={(e) => setEntryAttractiveOnly(e.target.checked)}
                        className="accent-primary"
                      />
                      Attractive entry only
                    </label>
                    <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={catalystOnly}
                        onChange={(e) => setCatalystOnly(e.target.checked)}
                        className="accent-primary"
                      />
                      Has catalysts
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <FilterChips
                    label="Structure"
                    selected={structureFilter}
                    onChange={setStructureFilter}
                    options={[
                      { key: "all", label: "All" },
                      { key: "long-call", label: "Long call" },
                      { key: "bull-call-spread", label: "Bull call spread" },
                      { key: "call-diagonal", label: "Call diagonal" },
                      { key: "cash-secured-put", label: "Cash-secured put" },
                      { key: "bull-put-spread", label: "Bull put spread" },
                    ]}
                  />
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-0.5">
                      Quick filters
                    </div>
                    <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={multipleOnly}
                        onChange={(e) => setMultipleOnly(e.target.checked)}
                        className="accent-primary"
                      />
                      2x / 3x scenarios only
                    </label>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={clearFilters}
                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Clear filters
              </button>
            </aside>

            {/* Table */}
            <div className="min-w-0 space-y-3">
              {tab === "longs" ? (
                <>
                  <div className="text-[11px] text-muted-foreground">
                    {filteredLongs.length} of {longs.length} long ideas
                  </div>
                  <LongsTable rows={filteredLongs} onSelect={setSelectedLong} selected={selectedLong} />
                </>
              ) : (
                <>
                  <div className="text-[11px] text-muted-foreground">
                    {filteredOptions.length} of {options.length} option ideas · ranked by
                    payoff-adjusted actionability
                  </div>
                  <OptionsTable
                    rows={filteredOptions}
                    onSelect={setSelectedOption}
                    selected={selectedOption}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {data && (
          <footer className="text-[10px] text-muted-foreground py-3 leading-relaxed border-t border-border/50">
            {data.disclaimer}
            {data.asOf ? ` · Updated ${fmtAgo(data.asOf)}.` : ""}
          </footer>
        )}
      </main>

      {/* Long detail drawer */}
      <Sheet open={!!selectedLongRow} onOpenChange={(o) => !o && setSelectedLong(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedLongRow && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <span className="tabular-nums">{selectedLongRow.ticker}</span>
                  <span className="text-[12px] font-normal text-muted-foreground truncate">
                    {selectedLongRow.companyName}
                  </span>
                </SheetTitle>
                <SheetDescription className="text-[11px]">
                  Long idea · {THEME_LABEL[selectedLongRow.themes[0]] ?? "Research"}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <LongDetail long={selectedLongRow} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Option detail drawer */}
      <Sheet open={!!selectedOptionRow} onOpenChange={(o) => !o && setSelectedOption(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedOptionRow && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <span className="tabular-nums">{selectedOptionRow.ticker}</span>
                  <span className="text-[12px] font-normal text-muted-foreground">
                    {selectedOptionRow.structureLabel}
                  </span>
                </SheetTitle>
                <SheetDescription className="text-[11px] truncate">
                  {selectedOptionRow.companyName}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <OptionDetail option={selectedOptionRow} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <MobileNav />
    </div>
  );
}
