// Shared "How this was derived" UI for the bull/base/bear scenario model.
//
// Renders the model method + coverage, the shared input rows, a compact
// bear/base/bull derivation table, and per-row source badges. Used by both the
// Conviction Signal scenario card and the Trade Ideas long detail drawer so the
// derivation looks identical wherever bull/base/bear are shown.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  ScenarioAnalystBlock,
  ScenarioCaseDerivation,
  ScenarioDerivationRow,
  ScenarioMethod,
  ScenarioSource,
} from "@shared/schema";

const SOURCE_META: Record<
  ScenarioSource,
  { label: string; className: string; title: string }
> = {
  "market-data": {
    label: "Market",
    className: "bg-sky-500/15 text-sky-500",
    title: "Live market data (price / market cap)",
  },
  "sec-fundamentals": {
    label: "SEC",
    className: "bg-emerald-500/15 text-emerald-500",
    title: "SEC EDGAR reported fundamentals",
  },
  "analyst-estimate": {
    label: "Analyst",
    className: "bg-violet-500/15 text-violet-500",
    title: "Analyst / consensus estimate",
  },
  "treasurylens-assumption": {
    label: "Assumption",
    className: "bg-amber-500/15 text-amber-500",
    title: "TreasuryLens modelling assumption",
  },
  "fallback-heuristic": {
    label: "Heuristic",
    className: "bg-orange-500/15 text-orange-500",
    title: "Curated-bands fallback heuristic",
  },
  unavailable: {
    label: "N/A",
    className: "bg-muted text-muted-foreground",
    title: "Input unavailable",
  },
};

export function SourceBadge({ source }: { source: ScenarioSource }) {
  const m = SOURCE_META[source] ?? SOURCE_META.unavailable;
  return (
    <span
      className={`inline-block rounded-sm px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${m.className}`}
      title={m.title}
      data-testid={`source-badge-${source}`}
    >
      {m.label}
    </span>
  );
}

const METHOD_META: Record<
  ScenarioMethod,
  { label: string; className: string }
> = {
  "fundamentals-driven": {
    label: "Fundamentals-driven",
    className: "bg-emerald-500/15 text-emerald-500",
  },
  hybrid: { label: "Hybrid", className: "bg-amber-500/15 text-amber-500" },
  "fallback-heuristic": {
    label: "Fallback heuristic",
    className: "bg-orange-500/15 text-orange-500",
  },
};

export function MethodBadge({
  method,
  coverage,
}: {
  method: ScenarioMethod | null | undefined;
  coverage?: "high" | "medium" | "low" | null;
}) {
  if (!method) return null;
  const m = METHOD_META[method];
  return (
    <span className="inline-flex items-center gap-1" data-testid="scenario-method-badge">
      <span
        className={`rounded-sm px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${m.className}`}
      >
        {m.label}
      </span>
      {coverage && (
        <span
          className="rounded-sm bg-muted px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
          title="Data coverage / model confidence"
        >
          {coverage} confidence
        </span>
      )}
    </span>
  );
}

function Row({ row }: { row: ScenarioDerivationRow }) {
  return (
    <div
      className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0"
      data-testid={`derivation-row-${row.key}`}
    >
      <span className="text-[11px] text-muted-foreground">
        {row.label}
        {row.note ? (
          <span className="text-[10px] text-muted-foreground/70"> · {row.note}</span>
        ) : null}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium tabular-nums text-foreground">
          {row.display}
        </span>
        <SourceBadge source={row.source} />
      </span>
    </div>
  );
}

// Compact per-case bridge: the ordered derivation rows for one case.
function CaseBridge({
  label,
  derivation,
}: {
  label: string;
  derivation: ScenarioCaseDerivation | null | undefined;
}) {
  if (!derivation) return null;
  return (
    <div className="space-y-0.5" data-testid={`case-bridge-${label.toLowerCase()}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
        {label} bridge
      </div>
      {derivation.rows.map((r) => (
        <Row key={r.key} row={r} />
      ))}
    </div>
  );
}

// Analyst-estimates section. Shows revenue/EPS/price-target estimate rows with
// a per-row "used" vs "reference" badge, the analyst source badge, and an
// explicit unavailable/error state so the UI never implies coverage that isn't
// there. Distinct from the SEC/market/assumption rows above it.
function AnalystSection({ analyst }: { analyst: ScenarioAnalystBlock }) {
  const available = analyst.status === "available" && analyst.rows.length > 0;
  return (
    <div data-testid="analyst-estimates-section">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Analyst estimates
        </span>
        <span className="flex items-center gap-1">
          <SourceBadge source="analyst-estimate" />
          {!available && (
            <span
              className="rounded-sm bg-muted px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
              title={analyst.message}
              data-testid="analyst-estimates-unavailable"
            >
              {analyst.status === "error" ? "Error" : "Unavailable"}
            </span>
          )}
        </span>
      </div>

      {available ? (
        <>
          {analyst.rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0"
              data-testid={`analyst-row-${r.key}`}
            >
              <span className="text-[11px] text-muted-foreground">
                {r.label}
                {r.note ? (
                  <span className="text-[10px] text-muted-foreground/70"> · {r.note}</span>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium tabular-nums text-foreground">
                  {r.display}
                </span>
                <span
                  className={`inline-block rounded-sm px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${
                    r.used
                      ? "bg-violet-500/15 text-violet-500"
                      : "bg-muted text-muted-foreground"
                  }`}
                  title={
                    r.used
                      ? "This estimate anchored a model assumption"
                      : "Shown for reference only — not used as a model target"
                  }
                >
                  {r.used ? "Used" : "Reference"}
                </span>
              </span>
            </div>
          ))}
          <p className="mt-1 text-[10px] text-muted-foreground/80 italic">
            {analyst.message}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground italic" data-testid="analyst-estimates-message">
          {analyst.message}
        </p>
      )}
    </div>
  );
}

export interface ScenarioDerivationProps {
  method: ScenarioMethod | null | undefined;
  coverage?: "high" | "medium" | "low" | null;
  methodology?: string | null;
  horizonYears?: number | null;
  inputs?: ScenarioDerivationRow[] | null;
  missingInputs?: string[] | null;
  modelWarnings?: string[] | null;
  bull?: ScenarioCaseDerivation | null;
  base?: ScenarioCaseDerivation | null;
  bear?: ScenarioCaseDerivation | null;
  analystEstimates?: ScenarioAnalystBlock | null;
  defaultOpen?: boolean;
}

// Collapsible "How this was derived" drawer. Safe to render even on the
// fallback-heuristic path (it shows the shared inputs + a note that no
// fundamentals bridge was available).
export function ScenarioDerivation(props: ScenarioDerivationProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const {
    method,
    coverage,
    methodology,
    inputs,
    missingInputs,
    modelWarnings,
    bull,
    base,
    bear,
    analystEstimates,
  } = props;

  const hasBridge = Boolean(bull || base || bear);

  return (
    <div
      className="rounded-md border border-border/60 bg-background/30"
      data-testid="scenario-derivation"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        data-testid="scenario-derivation-toggle"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            How this was derived
          </span>
        </span>
        <MethodBadge method={method} coverage={coverage} />
      </button>

      {open && (
        <div className="space-y-3 px-3 pb-3">
          {methodology && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {methodology}
            </p>
          )}

          {inputs && inputs.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Starting inputs
              </div>
              {inputs.map((r) => (
                <Row key={r.key} row={r} />
              ))}
            </div>
          )}

          {analystEstimates && <AnalystSection analyst={analystEstimates} />}

          {hasBridge ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <CaseBridge label="Bear" derivation={bear} />
              <CaseBridge label="Base" derivation={base} />
              <CaseBridge label="Bull" derivation={bull} />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              No fundamentals bridge available for this name — bull/base/bear use
              the curated-bands fallback heuristic. See warnings below.
            </p>
          )}

          {missingInputs && missingInputs.length > 0 && (
            <div className="text-[11px] text-amber-500/90">
              <span className="font-semibold uppercase tracking-wide text-[10px]">
                Missing data / fallback assumptions:{" "}
              </span>
              {missingInputs.join(", ")}.
            </div>
          )}

          {modelWarnings && modelWarnings.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              {modelWarnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
