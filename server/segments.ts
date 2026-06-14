// Segment revenue intelligence — per-segment revenue / operating income by
// fiscal year for a single issuer, normalized into mix %, YoY growth, OP margin,
// profit mix and a "punch" (profit-vs-revenue-share) field, with multi-year
// history for trend rendering.
//
// Provider architecture
// ---------------------
// `getSegmentBreakdown(ticker)` resolves the best available source in priority
// order via the `SegmentProvider` interface:
//
//   1. financeSegmentProvider — a finance data connector (e.g. Perplexity
//      finance segment data). DEFERRED: the deployed app runtime does not have
//      finance-connector credentials available server-side, and we must never
//      expose connector credentials to the frontend. The provider is therefore
//      implemented as an interface that reports `unavailable` unless a future
//      server-side integration sets it live. It is NOT wired to any live call
//      today — see `financeSegmentProvider.available`.
//
//   2. secSegmentProvider — extracts the business-segment revenue / operating
//      income facts from the issuer's most recent 10-K XBRL instance document
//      (the `us-gaap:StatementBusinessSegmentsAxis` dimension), which the SEC
//      companyfacts/companyconcept APIs strip out. This is the live V1 source.
//
// The app must never break without connector/tool credentials: when no provider
// resolves data, we return a polished "not-available" / "not-meaningful" state.
//
// Caching: per-ticker, 6h TTL, mirroring secEdgar's companyfacts cache horizon
// (filings update at most daily, and the instance document is ~10MB so we avoid
// re-fetching it on rapid polls / ticker switches).

import type {
  SegmentBreakdownResponse,
  SegmentRow,
  SegmentSource,
  SegmentYearPoint,
} from "@shared/schema";
import { resolveCik } from "./secEdgar";

const SEC_USER_AGENT = "TreasuryLens rohanr@me.com";
const HEADERS: Record<string, string> = {
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/json",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Number of trailing fiscal years to keep per segment (the latest 10-K usually
// carries the current year + two priors on the segment axis).
const MAX_HISTORY_YEARS = 3;

// -----------------------------------------------------------------------------
// Provider interface
// -----------------------------------------------------------------------------

interface SegmentProvider {
  readonly name: string;
  readonly source: SegmentSource;
  // Whether this provider can run in the current runtime. When false, the
  // resolver skips it without attempting a call.
  readonly available: boolean;
  // Resolve a breakdown, or null when this provider has nothing for the ticker.
  resolve(ticker: string, cik: string | null): Promise<SegmentBreakdownResponse | null>;
}

// -----------------------------------------------------------------------------
// Finance segment provider — DEFERRED (interface only).
//
// A finance data connector (e.g. Perplexity finance segment data) could serve
// as the first-priority provider. However, the deployed TreasuryLens app
// runtime does not expose finance-connector credentials to the server process,
// and connector credentials must never be shipped to the frontend. We therefore
// keep the provider as a typed seam that reports `available = false` and is
// never invoked at runtime. A future server-side integration can implement
// `resolve()` and flip `available` to true (reading credentials from a
// server-only env var) WITHOUT changing the resolver, route, schema, or UI —
// rows would simply carry `source: "finance-segments"`.
// -----------------------------------------------------------------------------

const financeSegmentProvider: SegmentProvider = {
  name: "finance-segments",
  source: "finance-segments",
  available: false, // no server-side connector credentials in the app runtime
  async resolve() {
    // Intentionally unimplemented. See the block comment above: enabling this
    // requires a server-only credentialed integration that does not exist in
    // the deployed runtime. Returning null keeps the SEC fallback authoritative.
    return null;
  },
};

// -----------------------------------------------------------------------------
// SEC segment provider — live V1 source.
// -----------------------------------------------------------------------------

interface SubmissionsRecent {
  form: string[];
  accessionNumber: string[];
  primaryDocument: string[];
  filingDate: string[];
}

interface SubmissionsJson {
  cik?: number;
  entityName?: string;
  filings?: { recent?: SubmissionsRecent };
}

const submissionsCache = new Map<
  string,
  { at: number; data: SubmissionsJson | null }
>();
const instanceCache = new Map<string, { at: number; xml: string | null }>();

async function fetchSubmissions(cik: string): Promise<SubmissionsJson | null> {
  const padded = cik.replace(/^0+/, "").padStart(10, "0");
  const cached = submissionsCache.get(padded);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;
  try {
    const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) {
      submissionsCache.set(padded, { at: now, data: null });
      return null;
    }
    const j = (await r.json()) as SubmissionsJson;
    submissionsCache.set(padded, { at: now, data: j });
    return j;
  } catch {
    submissionsCache.set(padded, { at: now, data: null });
    return null;
  }
}

// Locate the most recent 10-K (annual) filing — segment tables are reported in
// the annual report. Falls back to 20-F for foreign filers that use it.
function latestAnnualFiling(
  sub: SubmissionsJson,
): { accession: string; primaryDoc: string } | null {
  const recent = sub.filings?.recent;
  if (!recent) return null;
  const { form, accessionNumber, primaryDocument } = recent;
  const n = Math.min(
    form?.length ?? 0,
    accessionNumber?.length ?? 0,
    primaryDocument?.length ?? 0,
  );
  for (const wanted of ["10-K", "20-F"]) {
    for (let i = 0; i < n; i++) {
      if (form[i] === wanted) {
        return { accession: accessionNumber[i], primaryDoc: primaryDocument[i] };
      }
    }
  }
  return null;
}

// Fetch the XBRL instance document for a filing. The instance is the companion
// `_htm.xml` to the primary `.htm` document and carries the dimensional
// (segment-axis) facts the companyfacts API drops. ~10MB for large filers, so
// the result is cached for 6h.
async function fetchInstanceXml(
  cik: string,
  accession: string,
  primaryDoc: string,
): Promise<string | null> {
  const accnNoDash = accession.replace(/-/g, "");
  const cacheKey = `${cik}:${accnNoDash}`;
  const cached = instanceCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.xml;

  const cikNum = cik.replace(/^0+/, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accnNoDash}`;
  // The instance file is the primary document's base name with `_htm.xml`.
  // e.g. msft-20250630.htm -> msft-20250630_htm.xml
  const stem = primaryDoc.replace(/\.htm[l]?$/i, "");
  const candidates = [`${stem}_htm.xml`, `${stem}.xml`];
  for (const file of candidates) {
    try {
      const r = await fetch(`${base}/${file}`, {
        headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/xml" },
      });
      if (!r.ok) continue;
      const xml = await r.text();
      if (xml && xml.includes("StatementBusinessSegmentsAxis")) {
        instanceCache.set(cacheKey, { at: now, xml });
        return xml;
      }
      // A valid instance without a segment axis still counts as "fetched" — we
      // cache it so a single-segment issuer doesn't get re-fetched every poll.
      if (xml && xml.includes("<xbrl")) {
        instanceCache.set(cacheKey, { at: now, xml });
        return xml;
      }
    } catch {
      // try next candidate
    }
  }
  instanceCache.set(cacheKey, { at: now, xml: null });
  return null;
}

interface SegContext {
  member: string; // e.g. "msft:IntelligentCloudMember"
  start: string;
  end: string;
}

// Parse all single-dimension business-segment period contexts from the XBRL
// instance. We accept a context only when its segment dimension is the business
// segment axis AND it carries no OTHER breakdown dimension that would
// double-count revenue. Two shapes qualify:
//   (a) the segment axis is the only explicit dimension (e.g. MSFT), or
//   (b) the segment axis plus a `ConsolidationItemsAxis = OperatingSegmentsMember`
//       companion — the canonical "operating-segment total" qualifier many
//       filers (e.g. NVDA) attach. Any other companion dimension (geography,
//       product, etc.) is rejected to avoid double-counting sub-breakdowns.
function parseSegmentContexts(xml: string): Map<string, SegContext> {
  const out = new Map<string, SegContext>();
  const ctxRe = /<context id="([^"]+)">([\s\S]*?)<\/context>/g;
  let m: RegExpExecArray | null;
  while ((m = ctxRe.exec(xml)) !== null) {
    const id = m[1];
    const body = m[2];
    const memberRe =
      /<xbrldi:explicitMember dimension="([^"]+)">([^<]+)<\/xbrldi:explicitMember>/g;
    const members: Array<{ dim: string; member: string }> = [];
    let mm: RegExpExecArray | null;
    while ((mm = memberRe.exec(body)) !== null) {
      members.push({ dim: mm[1], member: mm[2] });
    }
    const segDim = members.find((x) =>
      x.dim.includes("StatementBusinessSegmentsAxis"),
    );
    if (!segDim) continue;
    const others = members.filter(
      (x) => !x.dim.includes("StatementBusinessSegmentsAxis"),
    );
    const companionOk =
      others.length === 0 ||
      (others.length === 1 &&
        others[0].dim.includes("ConsolidationItemsAxis") &&
        others[0].member.includes("OperatingSegmentsMember"));
    if (!companionOk) continue;
    const period = body.match(
      /<startDate>([^<]+)<\/startDate>\s*<endDate>([^<]+)<\/endDate>/,
    );
    if (!period) continue;
    out.set(id, { member: segDim.member, start: period[1], end: period[2] });
  }
  return out;
}

// Extract values for a us-gaap duration tag keyed by the segment contexts we
// care about. Returns contextId -> numeric value.
function factsForTag(
  xml: string,
  tag: string,
  segCtx: Map<string, SegContext>,
): Map<string, number> {
  const out = new Map<string, number>();
  const re = new RegExp(
    `<us-gaap:${tag}\\b[^>]*\\bcontextRef="([^"]+)"[^>]*>([^<]+)</us-gaap:${tag}>`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const ctxId = m[1];
    if (!segCtx.has(ctxId)) continue;
    const val = Number(m[2]);
    if (Number.isFinite(val)) out.set(ctxId, val);
  }
  return out;
}

// "ProductivityAndBusinessProcessesMember" -> "Productivity and Business Processes"
function humanizeMember(member: string): string {
  const local = member.includes(":") ? member.split(":").pop()! : member;
  const noSuffix = local.replace(/Member$/, "");
  // Split camelCase / PascalCase into words.
  const words = noSuffix
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  // Lower-case connective words for readability.
  return words
    .split(/\s+/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && ["And", "Or", "Of", "The"].includes(w)) return lower;
      return w;
    })
    .join(" ");
}

function fyFromEnd(end: string): number {
  return Number(end.slice(0, 4));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const secSegmentProvider: SegmentProvider = {
  name: "sec-segments",
  source: "sec-segments",
  available: true,
  async resolve(ticker, cik) {
    if (!cik) return null;
    const sub = await fetchSubmissions(cik);
    if (!sub) return null;
    const filing = latestAnnualFiling(sub);
    if (!filing) return null;
    const xml = await fetchInstanceXml(cik, filing.accession, filing.primaryDoc);
    if (!xml) return null;

    const segCtx = parseSegmentContexts(xml);
    if (segCtx.size === 0) return null;

    // Revenue uses the post-2018 contract-revenue tag first, then legacy tags.
    const revTags = [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
    ];
    let revFacts = new Map<string, number>();
    for (const tag of revTags) {
      revFacts = factsForTag(xml, tag, segCtx);
      if (revFacts.size > 0) break;
    }
    const oiFacts = factsForTag(xml, "OperatingIncomeLoss", segCtx);
    if (revFacts.size === 0 && oiFacts.size === 0) return null;

    // Group by segment member -> per-fiscal-year points.
    const byMember = new Map<
      string,
      Map<number, { end: string; revenue: number | null; operatingIncome: number | null }>
    >();
    const ensure = (member: string, fy: number, end: string) => {
      let years = byMember.get(member);
      if (!years) {
        years = new Map();
        byMember.set(member, years);
      }
      let pt = years.get(fy);
      if (!pt) {
        pt = { end, revenue: null, operatingIncome: null };
        years.set(fy, pt);
      }
      return pt;
    };
    Array.from(segCtx.entries()).forEach(([ctxId, ctx]) => {
      const fy = fyFromEnd(ctx.end);
      const rev = revFacts.get(ctxId);
      const oi = oiFacts.get(ctxId);
      if (rev == null && oi == null) return;
      const pt = ensure(ctx.member, fy, ctx.end);
      if (rev != null) pt.revenue = rev;
      if (oi != null) pt.operatingIncome = oi;
    });
    if (byMember.size === 0) return null;

    // A single segment is not a meaningful breakdown — degrade gracefully.
    if (byMember.size < 2) {
      return {
        ticker,
        status: "not-meaningful",
        source: "sec-segments",
        currency: "USD",
        fiscalYear: null,
        periodEnd: null,
        segments: [],
        totalRevenue: null,
        totalOperatingIncome: null,
        hasMultiYear: false,
        confidence: null,
        cik,
        entityName: sub.entityName ?? null,
        asOf: Date.now(),
        note: "This issuer reports a single business segment in its latest 10-K, so a segment breakdown is not meaningful.",
      };
    }

    // Determine the latest fiscal year present across all members.
    let latestFy = -Infinity;
    let latestEnd: string | null = null;
    Array.from(byMember.values()).forEach((years) => {
      Array.from(years.entries()).forEach(([fy, pt]) => {
        if (fy > latestFy) {
          latestFy = fy;
          latestEnd = pt.end;
        }
      });
    });
    if (!Number.isFinite(latestFy) || latestEnd == null) return null;
    const resolvedLatestFy = latestFy as number;
    const resolvedLatestEnd = latestEnd as string;

    // Totals for the latest year (mix denominators).
    let totalRevenue = 0;
    let totalOi = 0;
    let anyRev = false;
    let anyOi = false;
    Array.from(byMember.values()).forEach((years) => {
      const pt = years.get(resolvedLatestFy);
      if (pt?.revenue != null) {
        totalRevenue += pt.revenue;
        anyRev = true;
      }
      if (pt?.operatingIncome != null) {
        totalOi += pt.operatingIncome;
        anyOi = true;
      }
    });

    let multiYear = false;
    const rows: SegmentRow[] = [];
    Array.from(byMember.entries()).forEach(([member, years]) => {
      const sortedFys = Array.from(years.keys()).sort((a, b) => a - b);
      const trimmed = sortedFys.slice(-MAX_HISTORY_YEARS);
      const history: SegmentYearPoint[] = trimmed.map((fy) => {
        const pt = years.get(fy)!;
        return {
          fy,
          label: `FY${fy}`,
          end: pt.end,
          revenue: pt.revenue,
          operatingIncome: pt.operatingIncome,
        };
      });
      if (history.length >= 2) multiYear = true;

      const latest = years.get(resolvedLatestFy) ?? null;
      const prior = years.get(resolvedLatestFy - 1) ?? null;
      const revenue = latest?.revenue ?? null;
      const operatingIncome = latest?.operatingIncome ?? null;

      const revenueMixPct =
        revenue != null && anyRev && totalRevenue !== 0
          ? round2((revenue / totalRevenue) * 100)
          : null;
      const revenueYoYPct =
        revenue != null && prior?.revenue != null && prior.revenue !== 0
          ? round2(((revenue - prior.revenue) / Math.abs(prior.revenue)) * 100)
          : null;
      const operatingMarginPct =
        operatingIncome != null && revenue != null && revenue !== 0
          ? round2((operatingIncome / revenue) * 100)
          : null;
      const profitMixPct =
        operatingIncome != null && anyOi && totalOi !== 0
          ? round2((operatingIncome / totalOi) * 100)
          : null;
      const punchPpts =
        profitMixPct != null && revenueMixPct != null
          ? round2(profitMixPct - revenueMixPct)
          : null;

      rows.push({
        name: humanizeMember(member),
        rawMember: member,
        revenue,
        operatingIncome,
        revenueMixPct,
        revenueYoYPct,
        operatingMarginPct,
        profitMixPct,
        punchPpts,
        history,
        source: "sec-segments",
      });
    });

    // Sort segments by latest revenue desc (largest first), nulls last.
    rows.sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity));

    // Confidence: high when revenue resolved for all rows in the latest year;
    // medium when partial; low when only a couple of figures resolved.
    const withRev = rows.filter((r) => r.revenue != null).length;
    const confidence: "high" | "medium" | "low" =
      withRev === rows.length && anyOi
        ? "high"
        : withRev >= Math.ceil(rows.length / 2)
          ? "medium"
          : "low";

    return {
      ticker,
      status: "available",
      source: "sec-segments",
      currency: "USD",
      fiscalYear: resolvedLatestFy,
      periodEnd: resolvedLatestEnd,
      segments: rows,
      totalRevenue: anyRev ? totalRevenue : null,
      totalOperatingIncome: anyOi ? totalOi : null,
      hasMultiYear: multiYear,
      confidence,
      cik,
      entityName: sub.entityName ?? null,
      asOf: Date.now(),
      note: `Business-segment revenue${anyOi ? " and operating income" : ""} extracted from the issuer's latest ${
        filing.accession ? "10-K" : "annual"
      } XBRL filing (us-gaap segment axis). Mix %, YoY, margins and profit mix are TreasuryLens-normalized.`,
    };
  },
};

// -----------------------------------------------------------------------------
// Resolver + cache
// -----------------------------------------------------------------------------

const PROVIDERS: SegmentProvider[] = [financeSegmentProvider, secSegmentProvider];

const breakdownCache = new Map<
  string,
  { at: number; data: SegmentBreakdownResponse }
>();

export async function getSegmentBreakdown(
  ticker: string,
): Promise<SegmentBreakdownResponse> {
  const t = ticker.toUpperCase();
  const now = Date.now();
  const cached = breakdownCache.get(t);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  const base: SegmentBreakdownResponse = {
    ticker: t,
    status: "not-available",
    source: "unavailable",
    currency: "USD",
    fiscalYear: null,
    periodEnd: null,
    segments: [],
    totalRevenue: null,
    totalOperatingIncome: null,
    hasMultiYear: false,
    confidence: null,
    cik: null,
    entityName: null,
    asOf: now,
    note: "Segment-level revenue is not available for this ticker from free SEC filings.",
  };

  const cik = await resolveCik(t);
  if (!cik) {
    const out: SegmentBreakdownResponse = {
      ...base,
      note: "This ticker does not map to a US SEC filer (it may be foreign-listed, an ETF/fund, or an unverified symbol). Segment-level revenue is not available.",
    };
    breakdownCache.set(t, { at: now, data: out });
    return out;
  }

  for (const provider of PROVIDERS) {
    if (!provider.available) continue;
    try {
      const resolved = await provider.resolve(t, cik);
      if (resolved) {
        breakdownCache.set(t, { at: now, data: resolved });
        return resolved;
      }
    } catch {
      // Provider failure must not break the panel — fall through to the next.
    }
  }

  // No provider resolved meaningful segment data.
  const out: SegmentBreakdownResponse = {
    ...base,
    cik,
    note: "No business-segment breakdown could be extracted from this issuer's filings. The Revenue bridge above reflects total reported revenue.",
  };
  breakdownCache.set(t, { at: now, data: out });
  return out;
}

// Exposed for diagnostics / docs: whether the finance connector provider is
// live in this runtime. Always false today (see financeSegmentProvider).
export function isFinanceSegmentProviderLive(): boolean {
  return financeSegmentProvider.available;
}
