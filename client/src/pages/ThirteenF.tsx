import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type {
  Manager13FSummary,
  ThirteenFHolding,
  ThirteenFSummaryResponse,
  PositionChange,
  ManagerKey,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpDown,
  ArrowUpRight,
  ExternalLink,
  Info,
  Sun,
  Moon,
  RefreshCcw,
} from "lucide-react";
import { fmtAgo, fmtCompact, fmtPct } from "@/lib/format";
import { WordMark } from "@/components/Logo";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function useTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);
  return { dark, setDark };
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtShares(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return fmtCompact(value);
}

function deltaTone(v: number | null | undefined) {
  if (v == null) return "text-muted-foreground";
  if (v > 0) return "text-pos";
  if (v < 0) return "text-neg";
  return "text-muted-foreground";
}

type SortDir = "asc" | "desc";
type HoldingSortKey =
  | "issuer"
  | "value"
  | "weight"
  | "shares";
type ChangeSortKey =
  | "issuer"
  | "newValue"
  | "previousValue"
  | "valueChange"
  | "newShares"
  | "previousShares"
  | "shareChange"
  | "shareChangePct"
  | "weight";

function compareStr(a: string, b: string, dir: SortDir): number {
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

function compareNum(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDir,
): number {
  const av = a == null || !Number.isFinite(a) ? Number.NEGATIVE_INFINITY : a;
  const bv = b == null || !Number.isFinite(b) ? Number.NEGATIVE_INFINITY : b;
  return dir === "asc" ? av - bv : bv - av;
}

function SortHeader<K extends string>({
  label,
  k,
  active,
  dir,
  onSort,
  align = "left",
  testId,
}: {
  label: string;
  k: K;
  active: K;
  dir: SortDir;
  onSort: (k: K) => void;
  align?: "left" | "right";
  testId?: string;
}) {
  const isActive = active === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors ${
        align === "right" ? "justify-end w-full" : ""
      } ${isActive ? "text-foreground" : ""}`}
      data-testid={testId}
    >
      <span>{label}</span>
      <ArrowUpDown className={`h-3 w-3 ${isActive ? "opacity-100" : "opacity-40"}`} />
      {isActive && (
        <span className="text-[9px] tabular-nums opacity-70">
          {dir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </button>
  );
}

function FilingLink({
  url,
  label,
  testId,
}: {
  url: string | null | undefined;
  label: string;
  testId?: string;
}) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
      data-testid={testId}
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function HoldingsTable({
  holdings,
  testIdPrefix,
}: {
  holdings: ThirteenFHolding[];
  testIdPrefix: string;
}) {
  const [sortKey, setSortKey] = useState<HoldingSortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const arr = [...holdings];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "issuer":
          return compareStr(a.issuer, b.issuer, sortDir);
        case "value":
          return compareNum(a.value, b.value, sortDir);
        case "weight":
          return compareNum(a.weight, b.weight, sortDir);
        case "shares":
          return compareNum(a.shares, b.shares, sortDir);
      }
    });
    return arr;
  }, [holdings, sortKey, sortDir]);

  const onSort = (k: HoldingSortKey) => {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "issuer" ? "asc" : "desc");
    }
  };

  if (!holdings.length) {
    return (
      <div
        className="rounded-md border border-border/70 bg-background/35 p-6 text-center text-sm text-muted-foreground"
        data-testid={`${testIdPrefix}-empty`}
      >
        No holdings to display.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-md border border-border/70 bg-background/35">
      <table className="w-full text-[12px]">
        <thead className="border-b border-border/70 bg-card/60">
          <tr>
            <th className="px-3 py-2 text-left">
              <SortHeader<HoldingSortKey>
                label="Issuer"
                k="issuer"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId={`${testIdPrefix}-sort-issuer`}
              />
            </th>
            <th className="px-3 py-2 text-left">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                CUSIP
              </span>
            </th>
            <th className="px-3 py-2 text-left">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Class
              </span>
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader<HoldingSortKey>
                label="Value"
                k="value"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId={`${testIdPrefix}-sort-value`}
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader<HoldingSortKey>
                label="Weight"
                k="weight"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId={`${testIdPrefix}-sort-weight`}
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader<HoldingSortKey>
                label="Shares"
                k="shares"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId={`${testIdPrefix}-sort-shares`}
              />
            </th>
            <th className="px-3 py-2 text-left">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Type
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h, i) => (
            <tr
              key={`${h.cusip}-${h.putCall ?? "long"}-${i}`}
              className="border-b border-border/40 last:border-0 hover:bg-card/40 transition-colors"
              data-testid={`${testIdPrefix}-row-${i}`}
            >
              <td className="px-3 py-2 max-w-[280px]">
                <div className="font-medium truncate">{h.issuer}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {h.titleOfClass}
                </div>
              </td>
              <td className="px-3 py-2 mono text-[11px] text-muted-foreground">
                {h.cusip}
              </td>
              <td className="px-3 py-2 text-[11px] text-muted-foreground">
                {h.shareType}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtUsd(h.value)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtPct(h.weight, 2, false)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtShares(h.shares)}
              </td>
              <td className="px-3 py-2">
                {h.putCall ? (
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                      h.putCall.toUpperCase() === "PUT"
                        ? "bg-neg/10 text-neg border border-neg/30"
                        : "bg-pos/10 text-pos border border-pos/30"
                    }`}
                  >
                    {h.putCall}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">long</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChangeTable({
  changes,
  variant,
  testIdPrefix,
}: {
  changes: PositionChange[];
  variant: "new" | "increased" | "reduced" | "sold";
  testIdPrefix: string;
}) {
  const defaultKey: ChangeSortKey =
    variant === "new"
      ? "newValue"
      : variant === "sold"
      ? "previousValue"
      : variant === "increased"
      ? "shareChangePct"
      : "shareChangePct";
  const defaultDir: SortDir = variant === "reduced" ? "asc" : "desc";

  const [sortKey, setSortKey] = useState<ChangeSortKey>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const sorted = useMemo(() => {
    const arr = [...changes];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "issuer":
          return compareStr(a.issuer, b.issuer, sortDir);
        case "newValue":
          return compareNum(a.newValue, b.newValue, sortDir);
        case "previousValue":
          return compareNum(a.previousValue, b.previousValue, sortDir);
        case "valueChange":
          return compareNum(a.valueChange, b.valueChange, sortDir);
        case "newShares":
          return compareNum(a.newShares, b.newShares, sortDir);
        case "previousShares":
          return compareNum(a.previousShares, b.previousShares, sortDir);
        case "shareChange":
          return compareNum(a.shareChange, b.shareChange, sortDir);
        case "shareChangePct":
          return compareNum(a.shareChangePct, b.shareChangePct, sortDir);
        case "weight":
          return compareNum(a.weight, b.weight, sortDir);
      }
    });
    return arr;
  }, [changes, sortKey, sortDir]);

  const onSort = (k: ChangeSortKey) => {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "issuer" ? "asc" : "desc");
    }
  };

  if (!changes.length) {
    return (
      <div
        className="rounded-md border border-border/70 bg-background/35 p-6 text-center text-sm text-muted-foreground"
        data-testid={`${testIdPrefix}-empty`}
      >
        {variant === "new" && "No new positions vs prior quarter."}
        {variant === "increased" &&
          "No significant increases (≥20%) vs prior quarter."}
        {variant === "reduced" &&
          "No significant reductions (≥20%) vs prior quarter."}
        {variant === "sold" && "No exited positions vs prior quarter."}
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-md border border-border/70 bg-background/35">
      <table className="w-full text-[12px]">
        <thead className="border-b border-border/70 bg-card/60">
          <tr>
            <th className="px-3 py-2 text-left">
              <SortHeader<ChangeSortKey>
                label="Issuer"
                k="issuer"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                testId={`${testIdPrefix}-sort-issuer`}
              />
            </th>
            <th className="px-3 py-2 text-left">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                CUSIP
              </span>
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader<ChangeSortKey>
                label={variant === "sold" ? "Prev Value" : "Value"}
                k={variant === "sold" ? "previousValue" : "newValue"}
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
                testId={`${testIdPrefix}-sort-value`}
              />
            </th>
            {variant !== "sold" && variant !== "new" && (
              <th className="px-3 py-2 text-right">
                <SortHeader<ChangeSortKey>
                  label="Prev Value"
                  k="previousValue"
                  active={sortKey}
                  dir={sortDir}
                  onSort={onSort}
                  align="right"
                />
              </th>
            )}
            <th className="px-3 py-2 text-right">
              <SortHeader<ChangeSortKey>
                label="Weight"
                k="weight"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader<ChangeSortKey>
                label="New Shrs"
                k="newShares"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader<ChangeSortKey>
                label="Prev Shrs"
                k="previousShares"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader<ChangeSortKey>
                label="Δ Shares"
                k="shareChange"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
              />
            </th>
            <th className="px-3 py-2 text-right">
              <SortHeader<ChangeSortKey>
                label="Δ %"
                k="shareChangePct"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
                align="right"
              />
            </th>
            <th className="px-3 py-2 text-left">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Type
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => (
            <tr
              key={`${c.cusip}-${c.putCall ?? "long"}-${i}`}
              className="border-b border-border/40 last:border-0 hover:bg-card/40 transition-colors"
              data-testid={`${testIdPrefix}-row-${i}`}
            >
              <td className="px-3 py-2 max-w-[280px]">
                <div className="font-medium truncate">{c.issuer}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {c.titleOfClass}
                </div>
              </td>
              <td className="px-3 py-2 mono text-[11px] text-muted-foreground">
                {c.cusip}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtUsd(variant === "sold" ? c.previousValue : c.newValue)}
              </td>
              {variant !== "sold" && variant !== "new" && (
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {fmtUsd(c.previousValue)}
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums">
                {variant === "sold" ? "—" : fmtPct(c.weight, 2, false)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtShares(c.newShares)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtShares(c.previousShares)}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${deltaTone(c.shareChange)}`}
              >
                {c.shareChange >= 0 ? "+" : ""}
                {fmtShares(c.shareChange)}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${deltaTone(c.shareChangePct)}`}
              >
                {c.shareChangePct == null
                  ? "new"
                  : `${c.shareChangePct >= 0 ? "+" : ""}${c.shareChangePct.toFixed(1)}%`}
              </td>
              <td className="px-3 py-2">
                {c.putCall ? (
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                      c.putCall.toUpperCase() === "PUT"
                        ? "bg-neg/10 text-neg border border-neg/30"
                        : "bg-pos/10 text-pos border border-pos/30"
                    }`}
                  >
                    {c.putCall}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">long</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManagerCard({ m }: { m: Manager13FSummary }) {
  const portfolioChange =
    m.previousTotalValue && m.previousTotalValue > 0
      ? ((m.totalValue - m.previousTotalValue) / m.previousTotalValue) * 100
      : null;

  if (m.status !== "ok" || !m.latestFiling) {
    return (
      <section
        className="rounded-lg border border-border/70 bg-card/40 p-5 space-y-2"
        data-testid={`manager-card-${m.key}`}
      >
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-base font-semibold">{m.manager}</h2>
            <div className="text-[12px] text-muted-foreground">{m.firm}</div>
          </div>
        </div>
        <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[12px]">
          {m.status === "no-filing"
            ? "No 13F-HR filings found for this manager."
            : `Could not load latest 13F filing: ${m.error ?? "unknown error"}.`}
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-border/70 bg-card/40 p-5 space-y-4"
      data-testid={`manager-card-${m.key}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" data-testid={`manager-name-${m.key}`}>
            {m.manager}
          </h2>
          <div className="text-[12px] text-muted-foreground">{m.firm}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            CIK <span className="mono">{m.cik}</span>
            {" · "}
            <FilingLink
              url={m.latestFiling.filingIndexUrl}
              label={`${m.latestFiling.form} filed ${m.latestFiling.filingDate}`}
              testId={`manager-filing-link-${m.key}`}
            />
            {" · Q/E "}
            <span className="mono">{m.latestFiling.reportDate}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Portfolio value
          </div>
          <div
            className="text-lg font-semibold tabular-nums"
            data-testid={`manager-total-${m.key}`}
          >
            {fmtUsd(m.totalValue)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {m.holdingsCount} positions
            {portfolioChange != null && (
              <>
                {" · "}
                <span className={deltaTone(portfolioChange)}>
                  {portfolioChange >= 0 ? "+" : ""}
                  {portfolioChange.toFixed(1)}% q/q
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="top" className="w-full">
        <TabsList className="bg-background/40">
          <TabsTrigger value="top" data-testid={`tab-top-${m.key}`}>
            Top 10
          </TabsTrigger>
          <TabsTrigger value="new" data-testid={`tab-new-${m.key}`}>
            New ({m.newPositions.length})
          </TabsTrigger>
          <TabsTrigger value="up" data-testid={`tab-up-${m.key}`}>
            <ArrowUpRight className="h-3 w-3 mr-1" />
            Increases ({m.increasedPositions.length})
          </TabsTrigger>
          <TabsTrigger value="down" data-testid={`tab-down-${m.key}`}>
            <ArrowDownRight className="h-3 w-3 mr-1" />
            Reductions ({m.reducedPositions.length})
          </TabsTrigger>
          <TabsTrigger value="sold" data-testid={`tab-sold-${m.key}`}>
            Exits ({m.soldPositions.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="top" className="mt-3">
          <HoldingsTable
            holdings={m.topHoldings}
            testIdPrefix={`top-${m.key}`}
          />
        </TabsContent>
        <TabsContent value="new" className="mt-3">
          <ChangeTable
            changes={m.newPositions}
            variant="new"
            testIdPrefix={`new-${m.key}`}
          />
        </TabsContent>
        <TabsContent value="up" className="mt-3">
          <ChangeTable
            changes={m.increasedPositions}
            variant="increased"
            testIdPrefix={`inc-${m.key}`}
          />
        </TabsContent>
        <TabsContent value="down" className="mt-3">
          <ChangeTable
            changes={m.reducedPositions}
            variant="reduced"
            testIdPrefix={`red-${m.key}`}
          />
        </TabsContent>
        <TabsContent value="sold" className="mt-3">
          <ChangeTable
            changes={m.soldPositions}
            variant="sold"
            testIdPrefix={`sold-${m.key}`}
          />
        </TabsContent>
      </Tabs>

      {m.previousFiling && (
        <div className="text-[10px] text-muted-foreground">
          Compared against{" "}
          <FilingLink
            url={m.previousFiling.filingIndexUrl}
            label={`${m.previousFiling.form} filed ${m.previousFiling.filingDate} (Q/E ${m.previousFiling.reportDate})`}
            testId={`manager-prev-link-${m.key}`}
          />
          .
        </div>
      )}
    </section>
  );
}

const MANAGER_ORDER: ManagerKey[] = [
  "berkshire",
  "pershing",
  "bridgewater",
  "scion",
];

export default function ThirteenFPage() {
  const { dark, setDark } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useQuery<ThirteenFSummaryResponse>({
    queryKey: ["/api/13f/summary"],
  });

  const refresh = async () => {
    setRefreshing(true);
    try {
      await apiRequest("GET", "/api/13f/summary");
      await queryClient.invalidateQueries({ queryKey: ["/api/13f/summary"] });
      toast({ title: "Refreshed" });
    } catch {
      toast({ title: "Refresh failed", variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const orderedManagers = useMemo(() => {
    if (!data?.managers) return [];
    const byKey = new Map(data.managers.map((m) => [m.key, m]));
    return MANAGER_ORDER.map((k) => byKey.get(k)).filter(
      (m): m is Manager13FSummary => !!m,
    );
  }, [data]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-back-dashboard"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <span className="text-muted-foreground">·</span>
          <WordMark />
          <span className="text-muted-foreground hidden md:inline">·</span>
          <h1 className="hidden md:inline text-base font-semibold" data-testid="text-page-title">
            13F Tracker
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {data?.lastUpdated && (
            <span className="hidden lg:inline text-[11px] text-muted-foreground" data-testid="text-last-updated">
              Updated {fmtAgo(data.lastUpdated)}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={refresh}
            disabled={refreshing}
            data-testid="button-refresh"
          >
            <RefreshCcw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
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

      <main className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        <div className="px-4 md:px-6 py-5 space-y-5 max-w-[1600px] mx-auto">
          <div className="md:hidden">
            <h1 className="text-lg font-semibold">13F Tracker</h1>
          </div>

          <div
            className="flex items-start gap-2 rounded-md border border-border/70 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground"
            data-testid="data-status-note"
          >
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/80" />
            <p className="leading-relaxed">
              <span className="text-foreground">
                Latest available 13F-HR filings.
              </span>{" "}
              Form 13F-HR is filed with the SEC by institutional investment
              managers with $100M+ in U.S. equity AUM, due 45 days after each
              quarter-end. Holdings shown are <em>not</em> real-time — they are
              the most recent reported positions and may have changed since the
              quarter ended. Data parsed from public SEC EDGAR filings; CUSIP
              shown rather than ticker since 13F filings identify issuers by
              CUSIP. Short positions, foreign securities, and many derivatives
              are not required to be reported.
            </p>
          </div>

          {isLoading && (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-lg" />
              ))}
            </div>
          )}

          {isError && (
            <div
              className="rounded-md border border-neg/30 bg-neg/5 px-3 py-3 text-sm text-neg"
              data-testid="error-banner"
            >
              Failed to load 13F summary: {(error as Error)?.message ?? "unknown"}
            </div>
          )}

          {!isLoading && data && orderedManagers.length === 0 && (
            <div
              className="rounded-md border border-warn/30 bg-warn/5 px-3 py-3 text-sm"
              data-testid="empty-banner"
            >
              No managers available.
            </div>
          )}

          {orderedManagers.map((m) => (
            <ManagerCard key={m.key} m={m} />
          ))}

          {data?.sources?.length ? (
            <footer className="text-[10px] text-muted-foreground py-3 leading-relaxed">
              Sources:{" "}
              {data.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && " · "}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    {s.label}
                  </a>
                </span>
              ))}
              . {data.notes}
            </footer>
          ) : null}
        </div>
      </main>
    </div>
  );
}
