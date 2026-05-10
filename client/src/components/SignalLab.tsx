import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  InstrumentSnapshot,
  ModelSignal,
  ModelProfile,
  SignalLabel,
  ConfidenceLabel,
} from "@shared/schema";
import { fmtPrice, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { apiRequest } from "@/lib/queryClient";
import {
  Beaker,
  ShieldAlert,
  Target,
  TrendingUp,
  TrendingDown,
  CircleCheck,
  CircleAlert,
  ArrowDownUp,
} from "lucide-react";

// ---------- shared signal styling helpers (also exported for badges) ----------

export function signalTone(label: SignalLabel): string {
  switch (label) {
    case "Strong Buy":
      return "border-pos/40 bg-pos/15 text-pos";
    case "Buy":
      return "border-pos/30 bg-pos/10 text-pos";
    case "Watch":
      return "border-primary/30 bg-primary/10 text-primary";
    case "Hold":
      return "border-border bg-muted/40 text-muted-foreground";
    case "Trim":
      return "border-warn/30 bg-warn/10 text-warn";
    case "Sell":
      return "border-neg/30 bg-neg/10 text-neg";
    case "Invalid Setup":
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function confidenceTone(c: ConfidenceLabel): string {
  if (c === "High") return "text-pos";
  if (c === "Medium") return "text-primary";
  return "text-muted-foreground";
}

// ---------- compact badge for ticker / sidebar / table ----------

export function SignalBadge({
  label,
  score,
  testId,
  compact = false,
}: {
  label: SignalLabel;
  score?: number;
  testId?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5",
        signalTone(label),
      )}
      data-testid={testId}
      title={`Model signal: ${label}${score != null ? ` · score ${score.toFixed(0)}` : ""}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
      {!compact && score != null && (
        <span className="ml-0.5 tabular-nums opacity-80">
          {score.toFixed(0)}
        </span>
      )}
    </span>
  );
}

// ---------- inputs row ----------

const HORIZON_OPTIONS: { label: string; value: 7 | 30 | 90 }[] = [
  { label: "7D", value: 7 },
  { label: "30D", value: 30 },
  { label: "90D", value: 90 },
];

const PROFILE_OPTIONS: { label: string; value: ModelProfile }[] = [
  { label: "Conservative", value: "conservative" },
  { label: "Balanced", value: "balanced" },
  { label: "Aggressive", value: "aggressive" },
];

// ---------- main panel ----------

export function SignalLab({ snap }: { snap: InstrumentSnapshot }) {
  const [downside, setDownside] = useState(5);
  const [upside, setUpside] = useState(20);
  const [horizon, setHorizon] = useState<7 | 30 | 90>(30);
  const [profile, setProfile] = useState<ModelProfile>("balanced");
  const [threshold, setThreshold] = useState(60);

  const url = useMemo(
    () =>
      `/api/instruments/${snap.instrument.id}/signal?downside=${downside}&upside=${upside}&horizon=${horizon}&profile=${profile}&threshold=${threshold}`,
    [snap.instrument.id, downside, upside, horizon, profile, threshold],
  );

  const { data: signal, isLoading } = useQuery<ModelSignal>({
    queryKey: [
      "/api/instruments",
      snap.instrument.id,
      "signal",
      downside,
      upside,
      horizon,
      profile,
      threshold,
    ],
    queryFn: async () => {
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const currency = snap.currency;
  const isDemo = snap.status === "demo" || snap.status === "error";

  return (
    <section
      className="rounded-md border border-card-border bg-card"
      data-testid="signal-lab"
    >
      <header className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Beaker className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold tracking-widest uppercase">
            Signal Lab — Entry / Exit Model
          </span>
        </div>
        <div className="flex items-center gap-2">
          {signal && (
            <SignalBadge
              label={signal.signal}
              score={signal.compositeScore}
              testId="signal-lab-badge-header"
            />
          )}
          {signal && (
            <span
              className={cn(
                "text-[10px] tracking-wide uppercase",
                confidenceTone(signal.confidence),
              )}
              data-testid="signal-lab-confidence"
            >
              {signal.confidence} confidence
            </span>
          )}
        </div>
      </header>

      {/* Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 py-4 border-b border-card-border">
        <div className="space-y-3">
          <NumberSlider
            label="Max downside"
            value={downside}
            min={1}
            max={50}
            step={0.5}
            unit="%"
            testId="input-downside"
            onChange={setDownside}
          />
          <NumberSlider
            label="Upside target"
            value={upside}
            min={1}
            max={200}
            step={1}
            unit="%"
            testId="input-upside"
            onChange={setUpside}
          />
          <NumberSlider
            label="Confidence threshold"
            value={threshold}
            min={0}
            max={100}
            step={1}
            unit=""
            testId="input-threshold"
            onChange={setThreshold}
          />
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-[10px] tracking-widest uppercase text-muted-foreground">
              Time horizon
            </Label>
            <div className="flex gap-1 mt-1.5" role="group">
              {HORIZON_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={horizon === o.value ? "default" : "outline"}
                  className="h-8 px-3 flex-1"
                  onClick={() => setHorizon(o.value)}
                  data-testid={`btn-horizon-${o.value}`}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] tracking-widest uppercase text-muted-foreground">
              Model profile
            </Label>
            <div className="flex gap-1 mt-1.5" role="group">
              {PROFILE_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={profile === o.value ? "default" : "outline"}
                  className="h-8 px-2 flex-1 text-[11px]"
                  onClick={() => setProfile(o.value)}
                  data-testid={`btn-profile-${o.value}`}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground leading-relaxed pt-1">
            Defaults: 5% downside / 20% upside / 30D / Balanced. Tune to your own
            framework — outputs update instantly.
          </div>
        </div>
      </div>

      {/* Levels grid */}
      {isLoading && !signal && (
        <div className="px-4 py-6 text-[12px] text-muted-foreground">
          Computing model signal…
        </div>
      )}

      {signal && (
        <>
          {signal.invalidReasons.length > 0 && (
            <div
              className="mx-4 mt-4 rounded border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] text-warn flex items-start gap-2"
              data-testid="signal-invalid"
            >
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold uppercase tracking-wide text-[10px] mb-0.5">
                  Invalid setup
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {signal.invalidReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 px-4 py-4">
            <Cell
              label="Current"
              value={fmtPrice(signal.currentPrice, currency)}
              testId="cell-current"
              icon={<ArrowDownUp className="h-3 w-3" />}
            />
            <Cell
              label="Stop"
              value={fmtPrice(signal.stopPrice, currency)}
              sub={`-${signal.config.downsidePct}% from current`}
              tone="text-neg"
              testId="cell-stop"
              icon={<TrendingDown className="h-3 w-3" />}
            />
            <Cell
              label="Target"
              value={fmtPrice(signal.targetPrice, currency)}
              sub={`+${signal.config.upsidePct}% from current`}
              tone="text-pos"
              testId="cell-target"
              icon={<Target className="h-3 w-3" />}
            />
            <Cell
              label="Reward / Risk"
              value={
                signal.rewardRiskRatio != null
                  ? `${signal.rewardRiskRatio.toFixed(2)}×`
                  : "—"
              }
              sub={
                signal.rewardRiskRatio != null && signal.rewardRiskRatio < 2
                  ? "low"
                  : signal.rewardRiskRatio != null && signal.rewardRiskRatio >= 4
                  ? "strong"
                  : "ok"
              }
              tone={
                signal.rewardRiskRatio != null && signal.rewardRiskRatio >= 3
                  ? "text-pos"
                  : signal.rewardRiskRatio != null && signal.rewardRiskRatio < 2
                  ? "text-warn"
                  : ""
              }
              testId="cell-reward-risk"
            />
            <Cell
              label="Composite"
              value={signal.compositeScore.toFixed(0)}
              sub={signal.signal}
              tone={signalTone(signal.signal).split(" ").find((c) => c.startsWith("text-")) ?? ""}
              testId="cell-composite"
              icon={<TrendingUp className="h-3 w-3" />}
            />
          </div>

          {/* Entry / exit zones */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-card-border">
            <ZoneBlock
              kind="entry"
              currency={currency}
              low={signal.entryZoneLow}
              high={signal.entryZoneHigh}
              maxChase={signal.maxChasePrice}
              conditions={signal.entryConditions}
              testId="zone-entry"
            />
            <ZoneBlock
              kind="exit"
              currency={currency}
              low={signal.exitZoneLow}
              high={signal.exitZoneHigh}
              conditions={signal.exitConditions}
              testId="zone-exit"
            />
          </div>

          {/* Sub-models */}
          <div className="border-t border-card-border px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] tracking-widest uppercase text-muted-foreground">
                Model ensemble · {profile} profile · {horizon}D horizon
              </h4>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                weighted composite {signal.compositeScore.toFixed(0)} / 100
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {signal.models.map((m) => (
                <SubModelCard key={m.key} model={m} />
              ))}
            </div>
          </div>

          {signal.notes.length > 0 && (
            <div className="border-t border-card-border px-4 py-3 text-[11px] text-muted-foreground space-y-1">
              {signal.notes.map((n) => (
                <div key={n} className="flex items-start gap-1.5">
                  <CircleAlert className="h-3 w-3 mt-0.5 shrink-0 text-warn" />
                  <span>{n}</span>
                </div>
              ))}
            </div>
          )}

          <footer
            className="border-t border-card-border px-4 py-2.5 text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5"
            data-testid="signal-disclaimer"
          >
            <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Model signals are research tools, not financial advice. Levels and
              labels are derived deterministically from public price data;
              there is no trade execution and no LLM in this calculation.
              {isDemo && (
                <>
                  {" "}
                  <span className="text-warn">Provider returned demo/error data — interpret with extra caution.</span>
                </>
              )}
            </span>
          </footer>
        </>
      )}
    </section>
  );
}

// ---------- helpers ----------

function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  testId?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label
          className="text-[10px] tracking-widest uppercase text-muted-foreground"
          htmlFor={testId}
        >
          {label}
        </Label>
        <Input
          id={testId}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          className="h-7 w-20 text-right tabular-nums text-[12px]"
          data-testid={testId}
        />
      </div>
      <div className="mt-1.5">
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={(vs) => onChange(vs[0])}
          aria-label={label}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
          <span>
            {min}
            {unit}
          </span>
          <span>
            {max}
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
  testId,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  testId?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-3 py-2 min-w-0"
      data-testid={testId}
    >
      <div className="flex items-center gap-1 text-[10px] tracking-widest uppercase text-muted-foreground truncate">
        {icon}
        {label}
      </div>
      <div className={cn("tabular-nums font-semibold text-sm mt-0.5 truncate", tone)}>
        {value}
      </div>
      {sub != null && (
        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
          {sub}
        </div>
      )}
    </div>
  );
}

function ZoneBlock({
  kind,
  currency,
  low,
  high,
  maxChase,
  conditions,
  testId,
}: {
  kind: "entry" | "exit";
  currency: string;
  low: number | null;
  high: number | null;
  maxChase?: number | null;
  conditions: { label: string; pass?: boolean; trigger?: boolean }[];
  testId?: string;
}) {
  const isEntry = kind === "entry";
  return (
    <div
      className={cn(
        "px-4 py-4 space-y-2.5",
        isEntry ? "md:border-r border-card-border" : "",
      )}
      data-testid={testId}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] tracking-widest uppercase text-muted-foreground flex items-center gap-1.5">
          {isEntry ? (
            <TrendingDown className="h-3 w-3 text-pos" />
          ) : (
            <TrendingUp className="h-3 w-3 text-warn" />
          )}
          {isEntry ? "Entry zone" : "Exit zone"}
        </h4>
        <span className="text-xs tabular-nums">
          {low != null && high != null
            ? `${fmtPrice(low, currency)} – ${fmtPrice(high, currency)}`
            : "—"}
        </span>
      </div>
      {isEntry && maxChase != null && (
        <div className="text-[11px] text-muted-foreground tabular-nums">
          Max chase price:{" "}
          <span className="text-foreground">{fmtPrice(maxChase, currency)}</span>
        </div>
      )}
      <ul className="space-y-1">
        {conditions.map((c) => {
          const ok = isEntry ? c.pass : !c.trigger;
          return (
            <li
              key={c.label}
              className="flex items-start gap-1.5 text-[11px] leading-snug"
            >
              {ok ? (
                <CircleCheck className="h-3 w-3 mt-0.5 shrink-0 text-pos" />
              ) : (
                <CircleAlert
                  className={cn(
                    "h-3 w-3 mt-0.5 shrink-0",
                    isEntry ? "text-muted-foreground" : "text-warn",
                  )}
                />
              )}
              <span
                className={cn(
                  ok ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {c.label}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="text-[10px] text-muted-foreground leading-snug">
        {isEntry
          ? "Enter only when all conditions are met. The model is a checklist, not a trigger."
          : "Trim or exit when any trigger fires. Each is independent."}
      </div>
    </div>
  );
}

function SubModelCard({ model }: { model: import("@shared/schema").SubModelOutput }) {
  const tone =
    model.score >= 65
      ? "text-pos"
      : model.score >= 50
      ? "text-primary"
      : model.score >= 35
      ? "text-muted-foreground"
      : "text-neg";
  return (
    <div
      className="rounded border border-border/60 bg-background/40 px-3 py-2.5 flex flex-col min-w-0"
      data-testid={`submodel-${model.key}`}
      data-unavailable={!model.available ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] tracking-widest uppercase text-muted-foreground truncate">
          {model.name}
        </span>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            tone,
            !model.available && "opacity-60",
          )}
        >
          {model.score.toFixed(0)}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
        weight {(model.weight * 100).toFixed(0)}%
        {!model.available && " · partial data"}
      </div>
      <ul className="mt-2 space-y-0.5 text-[11px] leading-snug">
        {model.bullets.slice(0, 5).map((b, i) => (
          <li key={i} className="text-muted-foreground">
            <span className="text-foreground/90">·</span> {b}
          </li>
        ))}
      </ul>
    </div>
  );
}
