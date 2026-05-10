import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: number) => void;
}

const initial = {
  symbol: "",
  displayName: "",
  assetClass: "equity" as "crypto" | "equity" | "index",
  quoteCurrency: "USD",
  dataSource: "massive" as "yahoo" | "coingecko" | "massive",
  notes: "",
};

export function AddInstrumentDialog({ open, onOpenChange, onCreated }: Props) {
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.symbol.trim() || !form.displayName.trim()) {
      toast({ title: "Symbol and name are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/instruments", {
        ...form,
        symbol: form.symbol.trim(),
        displayName: form.displayName.trim(),
        notes: form.notes.trim() || null,
      });
      const data = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/instruments"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/snapshots"] });
      toast({ title: `Added ${data.displayName}` });
      onCreated?.(data.id);
      setForm(initial);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to add",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-instrument">
        <DialogHeader>
          <DialogTitle>Add Instrument</DialogTitle>
          <DialogDescription>
            Track US equities through Massive when configured, with Yahoo/Stooq
            fallback. For crypto try <span className="mono">BTC-USD</span>; for
            Metaplanet US OTC use <span className="mono">MTPLF</span>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="symbol" className="text-xs">Symbol</Label>
              <Input
                id="symbol"
                value={form.symbol}
                onChange={(e) =>
                  setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))
                }
                placeholder="e.g. MSTR, MTPLF, ETH-USD"
                className="mono mt-1"
                data-testid="input-symbol"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="displayName" className="text-xs">Display name</Label>
              <Input
                id="displayName"
                value={form.displayName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, displayName: e.target.value }))
                }
                placeholder="e.g. Microstrategy"
                className="mt-1"
                data-testid="input-display-name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Asset class</Label>
              <Select
                value={form.assetClass}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, assetClass: v as any }))
                }
              >
                <SelectTrigger className="mt-1" data-testid="select-asset-class">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="equity">Equity</SelectItem>
                  <SelectItem value="index">Index</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Quote currency</Label>
              <Input
                value={form.quoteCurrency}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    quoteCurrency: e.target.value.toUpperCase(),
                  }))
                }
                className="mt-1 mono"
                data-testid="input-quote-currency"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Data source</Label>
            <Select
              value={form.dataSource}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, dataSource: v as any }))
              }
            >
              <SelectTrigger className="mt-1" data-testid="select-data-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="massive">Massive / Stock Market API</SelectItem>
                <SelectItem value="yahoo">Yahoo Finance</SelectItem>
                <SelectItem value="coingecko">CoinGecko (BTC only)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="mt-1 text-sm"
              data-testid="input-notes"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-add"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              data-testid="button-submit-add"
            >
              {submitting ? "Adding…" : "Add to watchlist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
