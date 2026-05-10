// SEC 13F-HR filings provider.
//
// Pulls latest and previous 13F-HR filings for a fixed set of "superinvestor"
// managers via the SEC EDGAR submissions API and parses the information-table
// XML to compute portfolio-level metrics (top holdings, new positions,
// significant changes, exits).
//
// The SEC requires a descriptive User-Agent including a contact email.

import type {
  ManagerKey,
  Manager13FSummary,
  ThirteenFHolding,
  ThirteenFFiling,
  ThirteenFSummaryResponse,
  PositionChange,
} from "@shared/schema";

const SEC_USER_AGENT = "TreasuryLens rohanr@me.com";
const HEADERS_JSON: Record<string, string> = {
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/json",
};
const HEADERS_XML: Record<string, string> = {
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/xml, text/xml, */*",
};

// Cache TTL — 13F filings update at most once per quarter, but we still want
// to reflect amendments / new filings without manual restart. 6h is a fair
// trade-off between staleness and SEC politeness.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface ManagerDef {
  key: ManagerKey;
  cik: string; // 10-digit padded
  manager: string; // person
  firm: string;
}

const MANAGERS: ManagerDef[] = [
  {
    key: "berkshire",
    cik: "0001067983",
    manager: "Warren Buffett",
    firm: "Berkshire Hathaway Inc",
  },
  {
    key: "pershing",
    cik: "0001336528",
    manager: "Bill Ackman",
    firm: "Pershing Square Capital Management, L.P.",
  },
  {
    key: "bridgewater",
    cik: "0001350694",
    manager: "Ray Dalio",
    firm: "Bridgewater Associates, LP",
  },
  {
    key: "scion",
    cik: "0001649339",
    manager: "Michael Burry",
    firm: "Scion Asset Management, LLC",
  },
];

function pad10(cik: string | number): string {
  const s = String(cik).replace(/^0+/, "");
  return s.padStart(10, "0");
}

function noDashes(accession: string): string {
  return accession.replace(/-/g, "");
}

interface SubmissionsResponse {
  cik?: string;
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
    };
  };
}

interface IndexJson {
  directory?: {
    item?: { name: string; type?: string; size?: number }[];
  };
}

interface RawHolding {
  nameOfIssuer: string;
  titleOfClass: string;
  cusip: string;
  value: number; // dollars
  shares: number;
  shareType: string; // e.g. SH, PRN
  putCall: string | null;
  investmentDiscretion: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
}

interface ParsedFiling {
  accession: string;
  filingDate: string;
  reportDate: string;
  form: string;
  primaryDocUrl: string;
  filingIndexUrl: string;
  infoTableUrl: string | null;
  holdings: RawHolding[];
}

const summaryCache = new Map<
  string,
  { at: number; data: ThirteenFSummaryResponse }
>();

const filingCache = new Map<string, { at: number; data: ParsedFiling | null }>();

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: HEADERS_JSON });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: HEADERS_XML });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// Naive XML element value extractor — works for the well-formed information
// table SEC publishes. We deliberately avoid pulling a full XML parser
// dependency since the schema is fixed and small.
function getTagValue(xml: string, tag: string): string | null {
  // Match either <tag>val</tag> or <ns:tag>val</ns:tag>.
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return decodeXmlEntities(m[1].trim());
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseInformationTable(xml: string): RawHolding[] {
  const holdings: RawHolding[] = [];
  // <infoTable> blocks (sometimes namespaced n1:infoTable, ns1:infoTable, etc.)
  const blockRe = /<(?:[\w-]+:)?infoTable[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?infoTable>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const blk = m[1];
    const nameOfIssuer = (getTagValue(blk, "nameOfIssuer") ?? "").trim();
    const titleOfClass = (getTagValue(blk, "titleOfClass") ?? "").trim();
    const cusip = (getTagValue(blk, "cusip") ?? "").trim().toUpperCase();
    const valueRaw = getTagValue(blk, "value");
    // Pre-2022 13F filings reported value in thousands. From Q3 2022 the SEC
    // changed the form to require dollars. We auto-detect via a heuristic:
    // values < 1e9 and total < $1B suggests thousands; we resolve at the
    // filing-level after parsing all rows.
    const value = valueRaw ? Number(valueRaw) : 0;
    // shrsOrPrnAmt block contains <sshPrnamt> and <sshPrnamtType>
    const sshBlockMatch = blk.match(
      /<(?:[\w-]+:)?shrsOrPrnAmt[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?shrsOrPrnAmt>/i,
    );
    let shares = 0;
    let shareType = "SH";
    if (sshBlockMatch) {
      const inner = sshBlockMatch[1];
      const shr = getTagValue(inner, "sshPrnamt");
      const typ = getTagValue(inner, "sshPrnamtType");
      shares = shr ? Number(shr) : 0;
      shareType = (typ ?? "SH").trim();
    }
    const putCall = getTagValue(blk, "putCall");
    const investmentDiscretion = getTagValue(blk, "investmentDiscretion");
    const votingBlockMatch = blk.match(
      /<(?:[\w-]+:)?votingAuthority[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?votingAuthority>/i,
    );
    let votingSole: number | null = null;
    let votingShared: number | null = null;
    let votingNone: number | null = null;
    if (votingBlockMatch) {
      const inner = votingBlockMatch[1];
      const s = getTagValue(inner, "Sole");
      const sh = getTagValue(inner, "Shared");
      const n = getTagValue(inner, "None");
      votingSole = s ? Number(s) : null;
      votingShared = sh ? Number(sh) : null;
      votingNone = n ? Number(n) : null;
    }

    if (!cusip || !nameOfIssuer) continue;
    holdings.push({
      nameOfIssuer,
      titleOfClass,
      cusip,
      value: Number.isFinite(value) ? value : 0,
      shares: Number.isFinite(shares) ? shares : 0,
      shareType,
      putCall: putCall ? putCall.trim() : null,
      investmentDiscretion: investmentDiscretion
        ? investmentDiscretion.trim()
        : null,
      votingSole,
      votingShared,
      votingNone,
    });
  }
  return holdings;
}

// Pre-Q3 2022 13F filings reported value in thousands. We can detect this by
// parsing the primary doc when available, but a robust fallback is to use
// the totalReportedValue from the primary_doc (which SEC normalises) or
// alternately look at the magnitude of the largest holding vs shares*price.
// Simpler: normalize by report date — filings with reportDate before
// 2022-09-30 are in thousands.
function valueIsThousands(reportDate: string): boolean {
  // From the SEC: "Effective with the Form 13F filings for the calendar
  // quarter ending September 30, 2022 ... amounts are reported in dollars."
  // Anything strictly before 2022-09-30 is in thousands.
  return reportDate < "2022-09-30";
}

function normalizeHoldingValues(
  holdings: RawHolding[],
  reportDate: string,
): RawHolding[] {
  if (!valueIsThousands(reportDate)) return holdings;
  return holdings.map((h) => ({ ...h, value: h.value * 1000 }));
}

async function findInfoTableUrl(
  cik: string,
  accession: string,
  primaryDocument: string,
): Promise<string | null> {
  const accNoDash = noDashes(accession);
  const cikInt = String(Number(cik));
  const base = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}`;
  const idx = await fetchJson<IndexJson>(`${base}/index.json`);
  const items = idx?.directory?.item ?? [];
  // Heuristics — SEC publishes the info table as a separate XML named with
  // "informationtable" or "infotable" or simply "form13fInfoTable.xml".
  // Sometimes the primary document IS the info table (rare).
  const xmlItems = items.filter((i) => i.name.toLowerCase().endsWith(".xml"));
  // Drop the primary doc itself (cover page) so we don't pick it.
  const candidates = xmlItems.filter(
    (i) => i.name.toLowerCase() !== primaryDocument.toLowerCase(),
  );
  // Strong candidates: contain "infotable" or "information_table" or similar.
  const strong = candidates.find((i) => {
    const n = i.name.toLowerCase();
    return (
      n.includes("infotable") ||
      n.includes("information_table") ||
      n.includes("informationtable") ||
      n.includes("form13finfotable")
    );
  });
  if (strong) return `${base}/${strong.name}`;
  // Fallback: any other XML file that isn't the primary doc.
  if (candidates.length === 1) return `${base}/${candidates[0].name}`;
  // If multiple, prefer the largest XML file (info tables are typically large).
  if (candidates.length > 1) {
    const sorted = [...candidates].sort(
      (a, b) => (b.size ?? 0) - (a.size ?? 0),
    );
    return `${base}/${sorted[0].name}`;
  }
  return null;
}

async function loadFiling(
  cik: string,
  accession: string,
  primaryDocument: string,
  filingDate: string,
  reportDate: string,
  form: string,
): Promise<ParsedFiling | null> {
  const cacheKey = `${cik}|${accession}`;
  const now = Date.now();
  const cached = filingCache.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  const accNoDash = noDashes(accession);
  const cikInt = String(Number(cik));
  const base = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}`;
  const filingIndexUrl = `${base}/`;
  const primaryDocUrl = `${base}/${primaryDocument}`;
  const infoTableUrl = await findInfoTableUrl(cik, accession, primaryDocument);
  if (!infoTableUrl) {
    filingCache.set(cacheKey, { at: now, data: null });
    return null;
  }
  const xml = await fetchText(infoTableUrl);
  if (!xml) {
    filingCache.set(cacheKey, { at: now, data: null });
    return null;
  }
  const holdingsRaw = parseInformationTable(xml);
  const holdings = normalizeHoldingValues(holdingsRaw, reportDate);
  const parsed: ParsedFiling = {
    accession,
    filingDate,
    reportDate,
    form,
    primaryDocUrl,
    filingIndexUrl,
    infoTableUrl,
    holdings,
  };
  filingCache.set(cacheKey, { at: now, data: parsed });
  return parsed;
}

async function listLatest13FFilings(
  cik: string,
  limit = 4,
): Promise<
  {
    accession: string;
    filingDate: string;
    reportDate: string;
    form: string;
    primaryDocument: string;
  }[]
> {
  const padded = pad10(cik);
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const sub = await fetchJson<SubmissionsResponse>(url);
  const recent = sub?.filings?.recent;
  if (!recent?.accessionNumber || !recent.form) return [];
  const out: {
    accession: string;
    filingDate: string;
    reportDate: string;
    form: string;
    primaryDocument: string;
  }[] = [];
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i] ?? "";
    if (form !== "13F-HR" && form !== "13F-HR/A") continue;
    out.push({
      accession: recent.accessionNumber[i] ?? "",
      filingDate: recent.filingDate?.[i] ?? "",
      reportDate: recent.reportDate?.[i] ?? "",
      form,
      primaryDocument: recent.primaryDocument?.[i] ?? "primary_doc.xml",
    });
    if (out.length >= limit) break;
  }
  // Sort by reportDate desc — pick the most recent quarters.
  out.sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  return out;
}

interface AggregatedHolding extends ThirteenFHolding {}

function aggregateByCusip(
  raw: RawHolding[],
): Map<string, AggregatedHolding> {
  const map = new Map<string, AggregatedHolding>();
  for (const h of raw) {
    // Aggregate puts/calls separately by suffixing the cusip with the
    // putCall token, since a long position and a put are economically
    // distinct. Use uppercase to be safe.
    const suffix = h.putCall ? `:${h.putCall.toUpperCase()}` : "";
    const key = `${h.cusip}${suffix}`;
    const existing = map.get(key);
    if (existing) {
      existing.value += h.value;
      existing.shares += h.shares;
    } else {
      map.set(key, {
        cusip: h.cusip,
        issuer: h.nameOfIssuer,
        titleOfClass: h.titleOfClass,
        value: h.value,
        shares: h.shares,
        shareType: h.shareType,
        putCall: h.putCall,
        investmentDiscretion: h.investmentDiscretion,
        votingSole: h.votingSole,
        votingShared: h.votingShared,
        votingNone: h.votingNone,
        weight: 0, // filled below
      });
    }
  }
  return map;
}

function fillWeights(
  map: Map<string, AggregatedHolding>,
  totalValue: number,
): AggregatedHolding[] {
  return Array.from(map.values()).map((h) => ({
    ...h,
    weight: totalValue > 0 ? (h.value / totalValue) * 100 : 0,
  }));
}

function buildSummaryForManager(
  def: ManagerDef,
  latestParsed: ParsedFiling,
  prevParsed: ParsedFiling | null,
): Manager13FSummary {
  const latestAgg = aggregateByCusip(latestParsed.holdings);
  const prevAgg = prevParsed ? aggregateByCusip(prevParsed.holdings) : null;

  const totalValue = Array.from(latestAgg.values()).reduce(
    (acc, h) => acc + h.value,
    0,
  );
  const prevTotalValue = prevAgg
    ? Array.from(prevAgg.values()).reduce((acc, h) => acc + h.value, 0)
    : null;

  const latestHoldings = fillWeights(latestAgg, totalValue);
  // Sort by value desc.
  latestHoldings.sort((a, b) => b.value - a.value);

  const topHoldings = latestHoldings.slice(0, 10);

  const newPositions: PositionChange[] = [];
  const increasedPositions: PositionChange[] = [];
  const reducedPositions: PositionChange[] = [];
  const soldPositions: PositionChange[] = [];

  if (prevAgg) {
    const latestKeys = new Set<string>();
    for (const [key, h] of Array.from(latestAgg.entries())) {
      latestKeys.add(key);
      const prev = prevAgg.get(key);
      if (!prev) {
        newPositions.push({
          cusip: h.cusip,
          issuer: h.issuer,
          titleOfClass: h.titleOfClass,
          putCall: h.putCall,
          shareType: h.shareType,
          newShares: h.shares,
          previousShares: 0,
          shareChange: h.shares,
          shareChangePct: null,
          newValue: h.value,
          previousValue: 0,
          valueChange: h.value,
          weight: h.weight,
        });
        continue;
      }
      const shareDelta = h.shares - prev.shares;
      const sharePct =
        prev.shares > 0 ? (shareDelta / prev.shares) * 100 : null;
      const valueDelta = h.value - prev.value;
      // Significance threshold: >=20% change in shares OR new positions.
      // We bucket increases vs reductions accordingly.
      const change: PositionChange = {
        cusip: h.cusip,
        issuer: h.issuer,
        titleOfClass: h.titleOfClass,
        putCall: h.putCall,
        shareType: h.shareType,
        newShares: h.shares,
        previousShares: prev.shares,
        shareChange: shareDelta,
        shareChangePct: sharePct,
        newValue: h.value,
        previousValue: prev.value,
        valueChange: valueDelta,
        weight: h.weight,
      };
      if (sharePct != null) {
        if (sharePct >= 20) increasedPositions.push(change);
        else if (sharePct <= -20) reducedPositions.push(change);
      } else if (shareDelta > 0) {
        increasedPositions.push(change);
      } else if (shareDelta < 0) {
        reducedPositions.push(change);
      }
    }
    // Sold/exited positions: in prev but not in latest.
    for (const [key, prev] of Array.from(prevAgg.entries())) {
      if (latestKeys.has(key)) continue;
      soldPositions.push({
        cusip: prev.cusip,
        issuer: prev.issuer,
        titleOfClass: prev.titleOfClass,
        putCall: prev.putCall,
        shareType: prev.shareType,
        newShares: 0,
        previousShares: prev.shares,
        shareChange: -prev.shares,
        shareChangePct: -100,
        newValue: 0,
        previousValue: prev.value,
        valueChange: -prev.value,
        weight: 0,
      });
    }
  }

  // Sort changes for display:
  newPositions.sort((a, b) => b.newValue - a.newValue);
  increasedPositions.sort(
    (a, b) =>
      (b.shareChangePct ?? Number.POSITIVE_INFINITY) -
      (a.shareChangePct ?? Number.POSITIVE_INFINITY),
  );
  reducedPositions.sort(
    (a, b) =>
      (a.shareChangePct ?? Number.NEGATIVE_INFINITY) -
      (b.shareChangePct ?? Number.NEGATIVE_INFINITY),
  );
  soldPositions.sort((a, b) => b.previousValue - a.previousValue);

  const latestFiling: ThirteenFFiling = {
    accession: latestParsed.accession,
    filingDate: latestParsed.filingDate,
    reportDate: latestParsed.reportDate,
    form: latestParsed.form,
    primaryDocUrl: latestParsed.primaryDocUrl,
    filingIndexUrl: latestParsed.filingIndexUrl,
    infoTableUrl: latestParsed.infoTableUrl,
    holdingsCount: latestHoldings.length,
    totalValue,
  };

  const previousFiling: ThirteenFFiling | null = prevParsed
    ? {
        accession: prevParsed.accession,
        filingDate: prevParsed.filingDate,
        reportDate: prevParsed.reportDate,
        form: prevParsed.form,
        primaryDocUrl: prevParsed.primaryDocUrl,
        filingIndexUrl: prevParsed.filingIndexUrl,
        infoTableUrl: prevParsed.infoTableUrl,
        holdingsCount: prevAgg ? prevAgg.size : 0,
        totalValue: prevTotalValue ?? 0,
      }
    : null;

  return {
    key: def.key,
    manager: def.manager,
    firm: def.firm,
    cik: pad10(def.cik),
    status: "ok",
    error: null,
    latestFiling,
    previousFiling,
    totalValue,
    previousTotalValue: prevTotalValue,
    holdingsCount: latestHoldings.length,
    topHoldings,
    allHoldings: latestHoldings,
    newPositions,
    increasedPositions,
    reducedPositions,
    soldPositions,
  };
}

function emptyManager(
  def: ManagerDef,
  status: "error" | "no-filing",
  error: string,
): Manager13FSummary {
  return {
    key: def.key,
    manager: def.manager,
    firm: def.firm,
    cik: pad10(def.cik),
    status,
    error,
    latestFiling: null,
    previousFiling: null,
    totalValue: 0,
    previousTotalValue: null,
    holdingsCount: 0,
    topHoldings: [],
    allHoldings: [],
    newPositions: [],
    increasedPositions: [],
    reducedPositions: [],
    soldPositions: [],
  };
}

async function buildManagerSummary(
  def: ManagerDef,
): Promise<Manager13FSummary> {
  try {
    const filings = await listLatest13FFilings(def.cik, 4);
    if (!filings.length) {
      return emptyManager(def, "no-filing", "No 13F-HR filings found");
    }
    const latestEntry = filings[0];
    const prevEntry = filings.find(
      (f) => f.reportDate < latestEntry.reportDate,
    );
    const latest = await loadFiling(
      def.cik,
      latestEntry.accession,
      latestEntry.primaryDocument,
      latestEntry.filingDate,
      latestEntry.reportDate,
      latestEntry.form,
    );
    if (!latest) {
      return emptyManager(def, "error", "Failed to parse latest 13F filing");
    }
    let prev: ParsedFiling | null = null;
    if (prevEntry) {
      prev = await loadFiling(
        def.cik,
        prevEntry.accession,
        prevEntry.primaryDocument,
        prevEntry.filingDate,
        prevEntry.reportDate,
        prevEntry.form,
      );
    }
    return buildSummaryForManager(def, latest, prev);
  } catch (e) {
    return emptyManager(def, "error", (e as Error).message ?? "unknown error");
  }
}

export async function getThirteenFSummary(): Promise<ThirteenFSummaryResponse> {
  const cacheKey = "ALL";
  const now = Date.now();
  const cached = summaryCache.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  const managers = await Promise.all(MANAGERS.map((m) => buildManagerSummary(m)));
  const response: ThirteenFSummaryResponse = {
    managers,
    lastUpdated: now,
    sources: [
      {
        label: "SEC EDGAR submissions API",
        url: "https://www.sec.gov/edgar/sec-api-documentation",
      },
    ],
    notes:
      "13F-HR filings disclose long U.S. equity, convertible, and option positions held by institutional managers with $100M+ AUM. Filings are due 45 days after quarter-end and are not real-time.",
  };
  summaryCache.set(cacheKey, { at: now, data: response });
  return response;
}
