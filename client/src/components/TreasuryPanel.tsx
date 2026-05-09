import { useState } from "react";
import type { InstrumentSnapshot, Treasury } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bitcoin, Pencil, Save, X } from "lucide-react";
import { fmtCompact, fmtNum, fmtPct, fmtPrice } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function TreasuryPanel({ snap }: { snap: InstrumentSnapshot }) {
  const [editing, setEditing] = useState(false);
  const { data: t } = useQuery<Treasury | null>({
    queryKey: ["/api/instruments", snap.instrument.id, "treasury"],
  });

  const initial = {
    btcHoldings: t?.btcHoldings ?? null,
    sharesOutstanding: t?.sharesOutstanding ?? null,
    fxRate: t?.fxRate ?? null,
    notes: t?.notes ?? "",
  };
  const [form, setForm] = useState(initial);
  const { toast } = useToast();

  // re-init when treasury data arrives
  const fkey = `${t?.btcHoldings ?? "n"}-${t?.sharesOutstanding ?? "n"}-${t?.fxRate ?? "n"}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useQuery({ queryKey: ["__treasury_form_init", snap.instrument.id, fkey], enabled: false });

  const treasury = snap.treasury;

  const save = async () => {
    try {
      await apiRequest("POST", `/api/instruments/${snap.instrument.id}/treasury`, {
        btcHoldings:
          form.btcHoldings != null && !Number.isNaN(form.btcHoldings)
            ? Number(form.btcHoldings)
            : null,
        sharesOutstanding:
          form.sharesOutstanding != null && !Number.isNaN(form.sharesOutstanding)
            ? Number(form.sharesOutstanding)
            : null,
        fxRate:
          form.fxRate != null && !Number.isNaN(form.fxRate)
            ? Number(form.fxRate)
            : null,
        notes: form.notes ?? null,
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/instruments", snap.instrument.id, "treasury"],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/snapshots"] });
      await queryClient.invalidateQueries({
        queryKey: ["/api/instruments", snap.instrument.id, "snapshot"],
      });
      setEditing(false);
      toast({ title: "Treasury data saved" });
    } catch (e) {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  return (
    <div
      className="rounded-md border border-card-border bg-card flex flex-col"
      data-testid="treasury-panel"
    >
      <div className="flex items-center justify-between border-b border-card-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Bitcoin className="h-4 w-4 text-warn" />
          <span className="text-[11px] font-semibold tracking-widest uppercase">
            Bitcoin Treasury
          </span>
          <span className="ml-2 inline-flex items-center text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
            Manual input
          </span>
        </div>
        {!editing ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setForm({
                btcHoldings: t?.btcHoldings ?? null,
                sharesOutstanding: t?.sharesOutstanding ?? null,
                fxRate: t?.fxRate ?? null,
                notes: t?.notes ?? "",
              });
              setEditing(true);
            }}
            data-testid="button-edit-treasury"
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setEditing(false)}
              data-testid="button-cancel-treasury"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={save}
              data-testid="button-save-treasury"
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              Save
            </Button>
          </div>
        )}
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {!editing && (
          <>
            <Field
              label="BTC Holdings"
              value={treasury?.btcHoldings != null ? `${fmtNum(treasury.btcHoldings, 2)} BTC` : "—"}
              sub="Latest disclosed"
              testId="treasury-btc-holdings"
            />
            <Field
              label="BTC NAV (USD)"
              value={
                treasury?.btcNavUsd != null
                  ? `$${fmtCompact(treasury.btcNavUsd)}`
                  : "—"
              }
              sub="holdings × BTC spot"
              testId="treasury-btc-nav-usd"
            />
            <Field
              label="BTC NAV / Share"
              value={
                treasury?.btcNavPerShare != null
                  ? fmtPrice(treasury.btcNavPerShare, snap.currency)
                  : "—"
              }
              sub={
                t?.sharesOutstanding != null
                  ? `${fmtCompact(t.sharesOutstanding)} shares`
                  : "share count required"
              }
              testId="treasury-btc-nav-per-share"
            />
            <Field
              label="BTC / Share"
              value={
                treasury?.btcPerShare != null
                  ? `${fmtNum(treasury.btcPerShare, 8)} BTC`
                  : "—"
              }
              sub={
                treasury?.btcPerShare != null
                  ? "holdings ÷ shares"
                  : "holdings + shares required"
              }
              testId="treasury-btc-per-share"
            />
            <Field
              label="BTC Yield"
              value={
                treasury?.btcYieldPct != null ? (
                  <span
                    className={
                      treasury.btcYieldPct > 0
                        ? "text-pos"
                        : treasury.btcYieldPct < 0
                        ? "text-neg"
                        : ""
                    }
                  >
                    {fmtPct(treasury.btcYieldPct, 2)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">N/A</span>
                )
              }
              sub={
                treasury?.btcYieldPct != null && treasury.yieldSinceMs
                  ? `since ${new Date(treasury.yieldSinceMs).toLocaleDateString()} · ${treasury.historyPoints} snapshots`
                  : (treasury?.historyPoints ?? 0) < 2
                  ? "needs history (save ≥ 2 edits)"
                  : "Δ BTC/share over time"
              }
              testId="treasury-btc-yield"
            />
            <Field
              label="mNAV"
              value={
                treasury?.mNav != null
                  ? `${fmtNum(treasury.mNav, 2)}×`
                  : "—"
              }
              sub="market cap ÷ BTC NAV"
              testId="treasury-mnav"
            />
            <Field
              label="Market Cap"
              value={
                treasury?.marketCap != null
                  ? `${snap.currency === "JPY" ? "¥" : "$"}${fmtCompact(treasury.marketCap)}`
                  : "—"
              }
              sub="from quote (or computed)"
              testId="treasury-mcap"
            />
            <Field
              label={`FX Rate (${snap.currency}/USD)`}
              value={
                t?.fxRate != null ? fmtNum(t.fxRate, 4) : (snap.currency === "USD" ? "1.0000" : "—")
              }
              sub="quote currency per 1 USD"
              testId="treasury-fx"
            />
            {t?.notes && (
              <div className="col-span-full text-[12px] text-muted-foreground leading-relaxed">
                <span className="text-[10px] font-semibold tracking-widest uppercase block mb-1">Notes</span>
                {t.notes}
              </div>
            )}
            {!t?.btcHoldings && (
              <div className="col-span-full rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] text-foreground/80">
                No treasury values configured. Click <span className="font-medium">Edit</span> to enter the latest disclosed BTC holdings, share count, and (for non-USD listings) FX rate.
              </div>
            )}
          </>
        )}
        {editing && (
          <>
            <FormField
              label="BTC Holdings"
              hint="number of BTC, e.g. 18000"
              value={form.btcHoldings ?? ""}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  btcHoldings: v === "" ? null : Number(v),
                }))
              }
              testId="input-btc-holdings"
            />
            <FormField
              label="Shares Outstanding"
              hint="e.g. 500000000"
              value={form.sharesOutstanding ?? ""}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  sharesOutstanding: v === "" ? null : Number(v),
                }))
              }
              testId="input-shares-outstanding"
            />
            <FormField
              label={`FX (${snap.currency} per 1 USD)`}
              hint={
                snap.currency === "USD"
                  ? "leave blank for USD"
                  : `e.g. JPY ≈ 150, EUR ≈ 0.92`
              }
              value={form.fxRate ?? ""}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  fxRate: v === "" ? null : Number(v),
                }))
              }
              testId="input-fx-rate"
            />
            <div className="col-span-full">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Notes
              </Label>
              <Textarea
                value={form.notes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="mt-1 text-sm"
                rows={2}
                data-testid="input-treasury-notes"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="rounded border border-border/60 bg-background/50 px-3 py-2" data-testid={testId}>
      <div className="text-[10px] tracking-widest uppercase text-muted-foreground">
        {label}
      </div>
      <div className="tabular-nums font-semibold text-base mt-0.5">{value}</div>
      {sub != null && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      )}
    </div>
  );
}

function FormField({
  label,
  hint,
  value,
  onChange,
  testId,
}: {
  label: string;
  hint?: string;
  value: number | string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Input
        type="number"
        step="any"
        value={value as any}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="text-sm tabular-nums"
      />
      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
