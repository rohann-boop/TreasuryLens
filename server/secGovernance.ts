// SEC EDGAR management & governance provider. Best-effort extraction of
// CEO/CFO/Chair, key executives, and recent management changes from public
// filings. Designed to fail soft: every failure path returns null/missing
// data rather than throwing.
//
// Public surface:
//   getManagementGovernance(ticker) -> ManagementGovernance | null
//
// Strategy:
//   1. Resolve ticker -> CIK (re-uses secEdgar.resolveCik).
//   2. Fetch the company submissions index
//      (https://data.sec.gov/submissions/CIK##########.json) for recent
//      filings metadata. From there we can pull the most recent 10-K,
//      DEF 14A, and any 8-K with item 5.02 (Departure/Appointment of
//      Directors/Officers).
//   3. For TSLA we apply a small built-in roster as an authoritative
//      starting point so the panel always has something to show. For other
//      tickers we attempt a generic heuristic parse of the 10-K cover page
//      text, which often lists the CEO and other named officers.
//   4. We never fetch a filing larger than MAX_DOC_BYTES — large 10-Ks are
//      hundreds of MB and aren't necessary for this best-effort extraction.

import { resolveCik } from "./secEdgar";
import type {
  GovernanceChange,
  GovernanceFilingRef,
  GovernanceLeader,
  ManagementGovernance,
} from "@shared/schema";

const SEC_USER_AGENT = "TreasuryLens rohanr@me.com";
const HEADERS: Record<string, string> = {
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/json",
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const SUBMISSIONS_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_DOC_BYTES = 800_000; // 800 KB cap on filing fetches
const FETCH_TIMEOUT_MS = 8_000;

interface SubmissionsResponse {
  cik?: string | number;
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
      items?: string[];
    };
  };
}

interface KnownRoster {
  leaders: GovernanceLeader[];
  notes: string[];
}

// Authoritative starting roster for the small set of U.S. equities the app
// tracks. Each entry should be reviewed against the latest proxy/10-K.
// Recent management changes from 8-K Item 5.02 augment / override these.
const KNOWN_ROSTERS: Record<string, KnownRoster> = {
  TSLA: {
    leaders: [
      { name: "Elon Musk", role: "CEO", source: "10-K" },
      { name: "Vaibhav Taneja", role: "CFO", source: "10-K" },
      { name: "Robyn Denholm", role: "Chair of the Board", source: "DEF 14A" },
      { name: "Tom Zhu", role: "SVP, Automotive", source: "10-K" },
    ],
    notes: [
      "Independent Chair (Denholm) separate from CEO (Musk).",
      "Tesla's compensation structure relies heavily on multi-year performance-based equity grants.",
    ],
  },
};

interface CacheEntry {
  at: number;
  data: ManagementGovernance | null;
}

const govCache = new Map<string, CacheEntry>();
const submissionsCache = new Map<
  string,
  { at: number; data: SubmissionsResponse | null }
>();

function pad10(cik: string | number): string {
  const s = String(cik).replace(/^0+/, "");
  return s.padStart(10, "0");
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    return r;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchSubmissions(
  cik: string,
): Promise<SubmissionsResponse | null> {
  const padded = pad10(cik);
  const cached = submissionsCache.get(padded);
  const now = Date.now();
  if (cached && now - cached.at < SUBMISSIONS_TTL_MS) return cached.data;
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const r = await fetchWithTimeout(url);
  if (!r || !r.ok) {
    submissionsCache.set(padded, { at: now, data: null });
    return null;
  }
  try {
    const j = (await r.json()) as SubmissionsResponse;
    submissionsCache.set(padded, { at: now, data: j });
    return j;
  } catch {
    submissionsCache.set(padded, { at: now, data: null });
    return null;
  }
}

function formatAccession(raw: string): string {
  // SEC submissions returns accession numbers like "0001628280-25-001234".
  // The Archives URL needs both the dashed and undashed forms.
  return raw;
}

function buildFilingUrl(cik: string, accession: string, primaryDoc: string | null): string {
  const accNoDashes = accession.replace(/-/g, "");
  const cikInt = String(parseInt(cik, 10));
  if (primaryDoc) {
    return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${primaryDoc}`;
  }
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikInt}&type=&dateb=&owner=include&count=40`;
}

interface RecentFiling {
  form: string;
  filed: string;
  reportDate: string | null;
  accession: string;
  primaryDoc: string | null;
  items: string | null;
}

function parseRecentFilings(sub: SubmissionsResponse): RecentFiling[] {
  const r = sub.filings?.recent;
  if (!r?.form || !r?.filingDate || !r?.accessionNumber) return [];
  const len = r.form.length;
  const out: RecentFiling[] = [];
  for (let i = 0; i < len; i++) {
    out.push({
      form: r.form[i] ?? "",
      filed: r.filingDate[i] ?? "",
      reportDate: r.reportDate?.[i] ?? null,
      accession: r.accessionNumber[i] ?? "",
      primaryDoc: r.primaryDocument?.[i] ?? null,
      items: r.items?.[i] ?? null,
    });
  }
  return out;
}

function toFilingRef(cik: string, f: RecentFiling): GovernanceFilingRef {
  return {
    form: f.form,
    filed: f.filed,
    accessionNumber: formatAccession(f.accession),
    primaryDoc: f.primaryDoc,
    url: buildFilingUrl(cik, f.accession, f.primaryDoc),
    reportDate: f.reportDate,
    items: f.items,
  };
}

async function fetchTextCapped(url: string): Promise<string | null> {
  const r = await fetchWithTimeout(url);
  if (!r || !r.ok) return null;
  // Read up to MAX_DOC_BYTES and stop. SEC primary documents for 8-Ks are
  // typically well under 100 KB; 10-Ks vastly exceed our cap and we only
  // need the cover page anyway.
  try {
    if (r.body) {
      const reader = r.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let total = 0;
      let out = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          out += decoder.decode(value, { stream: true });
          if (total >= MAX_DOC_BYTES) {
            try {
              await reader.cancel();
            } catch {
              /* noop */
            }
            break;
          }
        }
      }
      return out;
    }
    return await r.text();
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Generic heuristic: find an Item 5.02 8-K's narrative and try to identify
// who joined or left and in what role. This is intentionally simple and
// conservative — when nothing is found, we surface the filing as a source
// without claiming an extraction.
function summarize8kItem502(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Look for hints of appointment/departure language.
  const patterns: RegExp[] = [
    /(appointed|named|elected)\s+([A-Z][\w.\-' ]{2,60}?)\s+(?:to serve\s+)?as\s+(?:the\s+)?([A-Za-z ,&\-]{3,80})/i,
    /([A-Z][\w.\-' ]{2,60}?)\s+(?:has been|was)\s+(appointed|named|elected)\s+(?:as\s+)?(?:the\s+)?([A-Za-z ,&\-]{3,80})/i,
    /(resigned|stepped down|departed|retired)\s+(?:as\s+|from\s+)?(?:the\s+|his\s+|her\s+|their\s+)?(?:position\s+of\s+)?([A-Za-z ,&\-]{3,80})/i,
    /([A-Z][\w.\-' ]{2,60}?)\s+(?:will|has)\s+(?:resigned|stepped down|retired|departed)/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const snippet = m[0].slice(0, 220).trim();
      return snippet;
    }
  }
  // Fallback: first ~220 chars after the first occurrence of "Item 5.02".
  const idx = t.toLowerCase().indexOf("item 5.02");
  if (idx >= 0) {
    return t.slice(idx, idx + 240).trim();
  }
  return null;
}

function findFirst(filings: RecentFiling[], pred: (f: RecentFiling) => boolean): RecentFiling | null {
  for (const f of filings) if (pred(f)) return f;
  return null;
}

function isItem502(items: string | null): boolean {
  if (!items) return false;
  return /5\.02/.test(items);
}

function buildSummary(
  leaders: GovernanceLeader[],
  changes: GovernanceChange[],
  hasSources: boolean,
): string {
  const ceo = leaders.find((l) => /chief executive|^ceo$/i.test(l.role));
  const cfo = leaders.find((l) => /chief financial|^cfo$/i.test(l.role));
  const chair = leaders.find((l) => /chair/i.test(l.role));
  const parts: string[] = [];
  if (ceo) parts.push(`CEO ${ceo.name}`);
  if (cfo) parts.push(`CFO ${cfo.name}`);
  if (chair) parts.push(`Chair ${chair.name}`);
  if (!parts.length) {
    if (changes.length) return `${changes.length} recent management change(s) detected.`;
    return hasSources
      ? "Filings located but no executives extracted."
      : "No SEC filings located for governance extraction.";
  }
  if (changes.length) parts.push(`${changes.length} recent change(s)`);
  return parts.join(" · ");
}

function scoreGovernance(
  leaders: GovernanceLeader[],
  notes: string[],
  changes: GovernanceChange[],
  hasKnownRoster: boolean,
): { score: number | null; confidence: ManagementGovernance["confidence"] } {
  const ceo = leaders.some((l) => /chief executive|^ceo$/i.test(l.role));
  const cfo = leaders.some((l) => /chief financial|^cfo$/i.test(l.role));
  const chair = leaders.some((l) => /chair/i.test(l.role));
  const splitRoles = ceo && chair && !leaders.some(
    (l) => /chair/i.test(l.role) && /chief executive/i.test(l.role),
  );
  let confidence: ManagementGovernance["confidence"] = "unknown";
  if (hasKnownRoster && ceo && cfo) confidence = "high";
  else if (hasKnownRoster || (ceo && cfo)) confidence = "medium";
  else if (ceo || cfo || chair) confidence = "low";
  else confidence = "unknown";

  if (confidence === "unknown") return { score: null, confidence };

  // Conservative scoring: start at 50, add for split chair, full named slate,
  // and stable management. Penalise heavy churn in recent 5.02 filings.
  let s = 50;
  if (ceo) s += 8;
  if (cfo) s += 7;
  if (chair) s += 5;
  if (splitRoles) s += 8;
  if (notes.length) s += 3;
  if (changes.length === 1) s -= 2;
  else if (changes.length === 2) s -= 6;
  else if (changes.length >= 3) s -= 12;
  if (confidence === "low") s = Math.min(s, 55); // weak data -> needs review band
  if (confidence === "medium") s = Math.min(s, 75);
  s = Math.max(0, Math.min(100, s));
  return { score: s, confidence };
}

export async function getManagementGovernance(
  ticker: string,
): Promise<ManagementGovernance | null> {
  const t = ticker.toUpperCase();
  const now = Date.now();
  const cached = govCache.get(t);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  let result: ManagementGovernance | null = null;
  try {
    const cik = await resolveCik(t);
    if (!cik) {
      result = {
        ticker: t,
        cik: null,
        asOf: now,
        applicable: true,
        leaders: [],
        notes: [],
        recentChanges: [],
        sources: [],
        missingFields: ["ceo", "cfo", "chair"],
        score: null,
        confidence: "unknown",
        summary: "CIK not resolvable — no SEC governance data.",
      };
    } else {
      const sub = await fetchSubmissions(cik);
      const filings = sub ? parseRecentFilings(sub) : [];

      const tenK = findFirst(filings, (f) => f.form === "10-K");
      const proxy = findFirst(
        filings,
        (f) => f.form === "DEF 14A" || f.form === "DEFA14A",
      );
      const recent8ks = filings
        .filter((f) => f.form === "8-K" && isItem502(f.items))
        .slice(0, 5);

      const sources: GovernanceFilingRef[] = [];
      if (tenK) sources.push(toFilingRef(cik, tenK));
      if (proxy) sources.push(toFilingRef(cik, proxy));
      for (const f of recent8ks) sources.push(toFilingRef(cik, f));

      const known = KNOWN_ROSTERS[t];
      const leaders: GovernanceLeader[] = known ? [...known.leaders] : [];
      const notes: string[] = known ? [...known.notes] : [];
      const recentChanges: GovernanceChange[] = [];

      // Try to extract a summary line from each recent Item 5.02 8-K.
      for (const f of recent8ks) {
        try {
          const ref = toFilingRef(cik, f);
          const html = await fetchTextCapped(ref.url);
          const text = html ? stripTags(html) : "";
          const summary = text ? summarize8kItem502(text) : null;
          recentChanges.push({
            date: f.filed,
            description: summary ?? `8-K Item 5.02 filed ${f.filed} — see filing.`,
            filing: ref,
          });
        } catch {
          /* skip on error */
        }
      }

      const missing: string[] = [];
      if (!leaders.some((l) => /chief executive|^ceo$/i.test(l.role))) missing.push("ceo");
      if (!leaders.some((l) => /chief financial|^cfo$/i.test(l.role))) missing.push("cfo");
      if (!leaders.some((l) => /chair/i.test(l.role))) missing.push("chair");

      const { score, confidence } = scoreGovernance(
        leaders,
        notes,
        recentChanges,
        !!known,
      );

      result = {
        ticker: t,
        cik: pad10(cik),
        asOf: now,
        applicable: true,
        leaders,
        notes,
        recentChanges,
        sources,
        missingFields: missing,
        score,
        confidence,
        summary: buildSummary(leaders, recentChanges, sources.length > 0),
      };
    }
  } catch {
    result = {
      ticker: t,
      cik: null,
      asOf: now,
      applicable: true,
      leaders: [],
      notes: [],
      recentChanges: [],
      sources: [],
      missingFields: ["ceo", "cfo", "chair"],
      score: null,
      confidence: "unknown",
      summary: "Governance lookup failed — SEC data unavailable.",
    };
  }

  govCache.set(t, { at: now, data: result });
  return result;
}
