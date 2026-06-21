import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  OptionStructureKind,
  RiskLevel,
  TacticalFactor,
  TacticalHorizon,
  TacticalIdea,
  TacticalIdeasResponse,
  TacticalOption,
  TacticalSetupKind,
  TradeIdeaTier,
} from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Info,
  ShieldAlert,
  ArrowUpDown,
  Search,
  X,
  Zap,
  Layers,
  Gauge,
} from "lucide-react";
import { fmtAgo, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type SubTab = "setups" | "options";

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

const HORIZON_RANK: Record<TacticalHorizon, number> = {
  "2-6 weeks": 1,
  "1-3 months": 2,
  "3-6 months": 3,
};

// ─── small presentational helpers ───────────────────────────────────────────

function pctTone(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "text-muted-foreground";
  if (p > 0) return "text-pos";
  if (p < 0) return "text-neg";
  return "text-muted-foreground";
}

function fmtSignedPct(p: number | null | undefined, digits = 0): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p.toFixed(digits);
  return `${p >= 0 ? "+" : ""}${v}%`;
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

function SetupBadge({ label }: { label: string }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border border-primary/30 bg-primary/10 text-primary">
      {label}
    </span>
  );
}

function SignalDot({
  label,
}: {
  label: TacticalIdea["signalQualityLabel"];
}) {
  const tone =
    label === "strong"
      ? "bg-pos/10 text-pos border-pos/30"
      : label === "moderate"
        ? "bg-warn/10 text-warn border-warn/30"
        : "bg-muted/40 text-muted-foreground border-border/60";
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border",
        tone,
      )}
    >
      {label}
    </span>
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

function compareStr(a: string, b: string, dir: "asc" | "desc") {
  const r = a.localeCompare(b);
  return dir === "asc" ? r : -r;
}
function compareNum(a: number | null, b: number | null, dir: "asc" | "desc") {
  const av = a ?? -Infinity;
  const bv = b ?? -Infinity;
  return dir === "asc" ? av - bv : bv - av;
}

// ─── Setups table ────────────────────────────────────────────────────────────

type SetupSortKey =
  | "tacticalScore"
  | "ticker"
  | "upside"
  | "invalidation"
  | "horizon"
  | "risk"
  | "signal";

function SetupsTable({
  rows,
  onSelect,
  selected,
}: {
  rows: TacticalIdea[];
  onSelect: (t: string) => void;
  selected: string | null;
}) {
  const [sortKey, setSortKey] = useState<SetupSortKey>("tacticalScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const onSort = (k: SetupSortKey) => {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "ticker" || k === "horizon" ? "asc" : "desc");
    }
  };
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "ticker":
          return compareStr(a.ticker, b.ticker, sortDir);
        case "upside":
          return compareNum(a.upsideHighPct, b.upsideHighPct, sortDir);
        case "invalidation":
          return compareNum(a.invalidationPct, b.invalidationPct, sortDir);
        case "horizon":
          return compareNum(HORIZON_RANK[a.horizon], HORIZON_RANK[b.horizon], sortDir);
        case "risk":
          return compareNum(RISK_RANK[a.riskLevel], RISK_RANK[b.riskLevel], sortDir);
        case "signal":
          return compareNum(a.signalQuality, b.signalQuality, sortDir);
        default:
          return compareNum(a.tacticalScore, b.tacticalScore, sortDir);
      }
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border/70 bg-background/35 px-4 py-8 text-center text-[12px] text-muted-foreground">
        No tactical setups match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-md border border-border/70 bg-background/35">
      <table className="w-full text-[12px]">
        <thead className="border-b border-border/70 bg-card/60">
          <tr>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Score" k="tacticalScore" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-left">
              <SortHeader label="Ticker" k="ticker" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-left hidden sm:table-cell">Setup</th>
            <th className="px-3 py-2 text-left hidden md:table-cell">
              <SortHeader label="Horizon" k="horizon" active={sortKey} dir={sortDir} onSort={onSort} />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader label="Upside" k="upside" active={sortKey} dir={sortDir} onSort={onSort} align="right" />
            </th>
            <th className="px-3 py-2 text-right hidden md:table-cell">
              <SortHeader label="Invalidation" k="invalidation" active={sortKey} dir={sortDir} onSort={onSort} align="right" />
            </th>
            <th className="px-3 py-2 text-left hidden lg:table-cell">
              <SortHeader label="Signal" k="signal" active={sortKey} dir={sortDir} onSort={onSort} />
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
                <ScoreBadge score={r.tacticalScore} tier={r.tier} />
              </td>
              <td className="px-3 py-2">
                <div className="font-medium tabular-nums">{r.ticker}</div>
                <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                  {r.companyName}
                </div>
              </td>
              <td className="px-3 py-2 hidden sm:table-cell">
                <SetupBadge label={r.setupLabel} />
              </td>
              <td className="px-3 py-2 text-[11px] text-foreground/90 hidden md:table-cell">
                {r.horizon}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-[11px] text-pos">
                {r.upsideLowPct != null && r.upsideHighPct != null
                  ? `+${r.upsideLowPct}–${r.upsideHighPct}%`
                  : "—"}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums text-[11px] hidden md:table-cell", pctTone(r.invalidationPct))}>
                {fmtSignedPct(r.invalidationPct)}
              </td>
              <td className="px-3 py-2 hidden lg:table-cell">
                <SignalDot label={r.signalQualityLabel} />
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

// ─── Options table ───────────────────────────────────────────────────────────

type OptionSortKey =
  | "actionability"
  | "ticker"
  | "structure"
  | "pop"
  | "maxRisk"
  | "breakeven";

function MultipleBadge({ option }: { option: TacticalOption }) {
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
      {option.tripleCandidate ? "3x" : "2x"}
    </span>
  );
}

function OptionsTable({
  rows,
  onSelect,
  selected,
}: {
  rows: TacticalOption[];
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
        case "pop":
          return compareNum(a.estProfitProbability, b.estProfitProbability, sortDir);
        case "maxRisk":
          return compareNum(a.maxRisk, b.maxRisk, sortDir);
        case "breakeven":
          return compareNum(a.breakeven, b.breakeven, sortDir);
        default:
          return compareNum(a.actionabilityScore, b.actionabilityScore, sortDir);
      }
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border/70 bg-background/35 px-4 py-8 text-center text-[12px] text-muted-foreground">
        No tactical option ideas match the current filters.
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
            <th className="px-3 py-2 text-left hidden lg:table-cell">Setup</th>
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
                {o.setupLabel}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/30 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-[12px] font-medium tabular-nums">{value}</div>
    </div>
  );
}

function FactorBar({ factor }: { factor: TacticalFactor }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-foreground/90">{factor.label}</span>
        <span className="text-muted-foreground tabular-nums">
          {factor.score} · {Math.round(factor.weight * 100)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div
          className="h-full bg-primary/60"
          style={{ width: `${Math.max(0, Math.min(100, factor.score))}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground leading-snug">{factor.note}</div>
    </div>
  );
}

function SetupDetail({ idea }: { idea: TacticalIdea }) {
  const cur = idea.priceCurrency ?? "USD";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={idea.tacticalScore} tier={idea.tier} />
        <SetupBadge label={idea.setupLabel} />
        <RiskBadge value={idea.riskLevel} />
        <SignalDot label={idea.signalQualityLabel} />
        <span className="text-[11px] text-muted-foreground">Horizon: {idea.horizon}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Tactical upside</div>
          <div className="text-[13px] font-semibold tabular-nums text-pos">
            {idea.upsideLowPct != null && idea.upsideHighPct != null
              ? `+${idea.upsideLowPct}–${idea.upsideHighPct}%`
              : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">model-implied range</div>
        </div>
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Invalidation</div>
          <div className={cn("text-[13px] font-semibold tabular-nums", pctTone(idea.invalidationPct))}>
            {fmtSignedPct(idea.invalidationPct)}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {idea.invalidationLevel != null ? fmtPrice(idea.invalidationLevel, cur) : "—"}
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Signal quality</div>
          <div className="text-[13px] font-semibold tabular-nums">{idea.signalQuality}</div>
          <div className="text-[10px] text-muted-foreground">{idea.signalQualityLabel}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">
          Price <span className="text-foreground tabular-nums">{fmtPrice(idea.price, cur)}</span>
        </span>
        <span className="text-muted-foreground">
          1m <span className={cn("tabular-nums", pctTone(idea.change1mPct))}>{fmtSignedPct(idea.change1mPct)}</span>
        </span>
        <span className="text-muted-foreground">
          6m <span className={cn("tabular-nums", pctTone(idea.change6mPct))}>{fmtSignedPct(idea.change6mPct)}</span>
        </span>
        <span className="text-muted-foreground">
          12m <span className={cn("tabular-nums", pctTone(idea.change12mPct))}>{fmtSignedPct(idea.change12mPct)}</span>
        </span>
        {idea.analystTargetGapPct != null && (
          <span className="text-muted-foreground">
            Analyst gap{" "}
            <span className={cn("tabular-nums", pctTone(idea.analystTargetGapPct))}>
              {fmtSignedPct(idea.analystTargetGapPct)}
            </span>
          </span>
        )}
      </div>

      <Bullets label="Why this is mispriced" items={idea.whyMispriced} />

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Why this is ranked
        </div>
        <div className="space-y-3">
          {idea.factors.map((f) => (
            <FactorBar key={f.key} factor={f} />
          ))}
        </div>
      </div>

      <Bullets label="Invalidation rules" items={idea.invalidationRules} />

      <div className="text-[10px] text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
        Tactical Score is a transparent weighted blend of trailing momentum, remaining
        base-case room, entry quality, scenario reward/risk and catalyst presence — a
        model-implied read, never a promise. Short-term and options ideas carry elevated
        risk. Data confidence: {idea.dataConfidence}. Research only — not financial advice.
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

function OptionDetail({ option }: { option: TacticalOption }) {
  const cur = option.priceCurrency ?? "USD";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={option.actionabilityScore} tier={option.tier} />
        {option.multipleLabel && <MultipleBadge option={option} />}
        <SetupBadge label={option.setupLabel} />
        <span className="text-[11px] text-muted-foreground">{STRUCTURE_BIAS[option.kind]}</span>
      </div>

      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
        <span>
          Modeled fallback — no live option chain. Premiums, breakeven, max-loss and probability are
          illustrative estimates from current price, a {option.ivProxyPct}% volatility/risk proxy and
          the scenario target, re-tagged to the {option.horizon} tactical horizon. Verify with your
          broker.
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
        <Stat label="Tactical horizon" value={option.horizon} />
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

// ─── Body (embeddable) ───────────────────────────────────────────────────────

export function TacticalIdeasBody() {
  const [tab, setTab] = useState<SubTab>("setups");

  const { data, isLoading, isError, error } = useQuery<TacticalIdeasResponse>({
    queryKey: ["/api/tactical-ideas"],
  });

  const [search, setSearch] = useState("");
  const [setupFilter, setSetupFilter] = useState<TacticalSetupKind | "all">("all");
  const [horizonFilter, setHorizonFilter] = useState<TacticalHorizon | "all">("all");
  const [maxRisk, setMaxRisk] = useState<RiskLevel>("very high");
  const [minScore, setMinScore] = useState<0 | 50 | 60 | 70>(0);
  const [optionsOnly, setOptionsOnly] = useState(false);

  const [structureFilter, setStructureFilter] = useState<OptionStructureKind | "all">("all");
  const [multipleOnly, setMultipleOnly] = useState(false);

  const [selectedSetup, setSelectedSetup] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const ideas = data?.ideas ?? [];
  const options = data?.options ?? [];

  const norm = search.trim().toLowerCase();

  const filteredIdeas = useMemo(() => {
    return ideas.filter((i) => {
      if (setupFilter !== "all" && i.setupKind !== setupFilter) return false;
      if (horizonFilter !== "all" && i.horizon !== horizonFilter) return false;
      if (RISK_RANK[i.riskLevel] > RISK_RANK[maxRisk]) return false;
      if (i.tacticalScore < minScore) return false;
      if (optionsOnly && !i.optionsAvailable) return false;
      if (norm) {
        const hay = `${i.ticker} ${i.companyName}`.toLowerCase();
        if (!hay.includes(norm)) return false;
      }
      return true;
    });
  }, [ideas, setupFilter, horizonFilter, maxRisk, minScore, optionsOnly, norm]);

  const filteredOptions = useMemo(() => {
    return options.filter((o) => {
      if (structureFilter !== "all" && o.kind !== structureFilter) return false;
      if (setupFilter !== "all" && o.setupKind !== setupFilter) return false;
      if (multipleOnly && !o.doubleCandidate) return false;
      if (o.actionabilityScore < minScore) return false;
      if (norm) {
        const hay = `${o.ticker} ${o.companyName} ${o.structureLabel}`.toLowerCase();
        if (!hay.includes(norm)) return false;
      }
      return true;
    });
  }, [options, structureFilter, setupFilter, multipleOnly, minScore, norm]);

  const selectedSetupRow = ideas.find((i) => i.ticker === selectedSetup) ?? null;
  const selectedOptionRow = options.find((o) => o.id === selectedOption) ?? null;

  const setupOptions = useMemo(
    () => [
      { key: "all" as const, label: "All" },
      ...(data?.setups ?? []).map((s) => ({ key: s.kind, label: s.label })),
    ],
    [data?.setups],
  );

  const clearFilters = () => {
    setSearch("");
    setSetupFilter("all");
    setHorizonFilter("all");
    setMaxRisk("very high");
    setMinScore(0);
    setOptionsOnly(false);
    setStructureFilter("all");
    setMultipleOnly(false);
  };

  return (
    <>
      <div
        className="w-full max-w-[1500px] mx-auto px-4 md:px-6 py-5 space-y-4"
        data-testid="tactical-ideas-body"
      >
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground leading-relaxed max-w-3xl">
            <b>Tactical Ideas</b> ranks SHORT-TERM, actionable setups from the same curated
            universe — surfacing names where the model sees a near-term mispricing: a
            constructive trend, remaining base-case room, a contained invalidation level and,
            where present, a catalyst. <b>Setups</b> ranks the equity ideas; <b>Options</b>{" "}
            maps each thesis to modeled bullish structures. Research ideas, not personalized
            financial advice.
          </p>
          <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 max-w-3xl">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>
              Short-term and options ideas carry <b>elevated risk</b> and can move against you
              quickly. The expected upside is a model-implied <b>range</b> over a tactical
              horizon, never a promise. Option structures are <b>modeled fallbacks</b> — no live
              chain is wired.
            </span>
          </div>
        </div>

        {/* Sub-tabs */}
        <div
          className="inline-flex rounded-md border border-border/70 overflow-hidden text-[12px]"
          role="tablist"
          data-testid="tactical-ideas-tabs"
        >
          <button
            role="tab"
            aria-selected={tab === "setups"}
            data-testid="tab-setups"
            onClick={() => setTab("setups")}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-1.5 transition-colors",
              tab === "setups"
                ? "bg-primary/15 text-foreground"
                : "bg-background/30 text-muted-foreground hover:bg-card/60",
            )}
          >
            <Zap className="h-3.5 w-3.5" aria-hidden />
            Setups {ideas.length > 0 && <span className="tabular-nums opacity-70">{ideas.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={tab === "options"}
            data-testid="tab-tactical-options"
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
            Couldn't load Tactical Ideas: {(error as Error)?.message ?? "unknown error"}
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
              <FilterChips
                label="Setup"
                selected={setupFilter}
                onChange={setSetupFilter}
                options={setupOptions}
              />
              {tab === "setups" ? (
                <>
                  <FilterChips
                    label="Horizon"
                    selected={horizonFilter}
                    onChange={setHorizonFilter}
                    options={[
                      { key: "all", label: "All" },
                      { key: "2-6 weeks", label: "2-6 weeks" },
                      { key: "1-3 months", label: "1-3 months" },
                      { key: "3-6 months", label: "3-6 months" },
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
                        checked={optionsOnly}
                        onChange={(e) => setOptionsOnly(e.target.checked)}
                        className="accent-primary"
                      />
                      Options available only
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
              {tab === "setups" ? (
                <>
                  <div className="text-[11px] text-muted-foreground">
                    {filteredIdeas.length} of {ideas.length} tactical setups
                  </div>
                  <SetupsTable rows={filteredIdeas} onSelect={setSelectedSetup} selected={selectedSetup} />
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
            <div className="flex items-center gap-1.5 mb-1 text-foreground/80">
              <Gauge className="h-3 w-3" aria-hidden />
              <span className="font-medium">Methodology</span>
            </div>
            {tab === "setups" ? data.methodology.tactical : data.methodology.options}
            <div className="mt-2">{data.disclaimer}</div>
            {data.asOf ? ` Updated ${fmtAgo(data.asOf)}.` : ""}
          </footer>
        )}
      </div>

      {/* Setup detail drawer */}
      <Sheet open={!!selectedSetupRow} onOpenChange={(o) => !o && setSelectedSetup(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedSetupRow && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <span className="tabular-nums">{selectedSetupRow.ticker}</span>
                  <span className="text-[12px] font-normal text-muted-foreground truncate">
                    {selectedSetupRow.companyName}
                  </span>
                </SheetTitle>
                <SheetDescription className="text-[11px]">
                  Tactical setup · {selectedSetupRow.setupLabel} · {selectedSetupRow.horizon}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <SetupDetail idea={selectedSetupRow} />
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
                  {selectedOptionRow.companyName} · {selectedOptionRow.setupLabel}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <OptionDetail option={selectedOptionRow} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
