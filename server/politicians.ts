// STOCK Act politician disclosures provider.
//
// Surfaces a curated, public-sourced view of U.S. politician financial
// disclosures filed under the STOCK Act. Disclosures are published as PDFs
// on the House Clerk and Senate disclosure portals and use dollar value
// *ranges* (e.g. "$1,001 - $15,000") rather than share counts — we do not
// fabricate transactions or portfolio weights.
//
// Today this module returns:
//   - a politician profile (name, role, party, state)
//   - a configured list of public disclosure links for the person
//   - a probe of the disclosure portal to record reachability metadata
//
// No paid services, no API keys, no LLM calls, no secrets.

import type {
  PoliticianKey,
  PoliticianSummary,
  PoliticiansSummaryResponse,
  PoliticianDisclosureLink,
} from "@shared/schema";

const USER_AGENT = "TreasuryLens politician-disclosures rohanr@me.com";
const HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml",
};

// Cache TTL — STOCK Act PTR filings update at most a few times per month
// per filer. 6h matches sec13f.ts cadence.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface PoliticianDef {
  key: PoliticianKey;
  name: string;
  role: string;
  party: string | null;
  state: string | null;
  // Public root listing where the person's disclosures can be browsed.
  disclosurePortalUrl: string;
  // Curated public disclosure links. These are publicly hosted PDFs / index
  // pages on the House Clerk site; we list them by reference rather than
  // parsing them at runtime. Update list as new filings appear.
  disclosures: PoliticianDisclosureLink[];
  notes: string[];
}

const POLITICIANS: PoliticianDef[] = [
  {
    key: "pelosi",
    name: "Nancy Pelosi",
    role: "U.S. Representative",
    party: "D",
    state: "CA-11",
    disclosurePortalUrl:
      "https://disclosures-clerk.house.gov/FinancialDisclosure",
    disclosures: [
      {
        label: "House Clerk — Financial Disclosure search",
        url: "https://disclosures-clerk.house.gov/FinancialDisclosure",
        source: "House Clerk",
        filed: null,
        notes:
          "Search by last name 'Pelosi' for Periodic Transaction Reports and Annual Disclosures.",
      },
      {
        label: "House Clerk — Public Disclosure index",
        url: "https://disclosures-clerk.house.gov/PublicDisclosure",
        source: "House Clerk",
        filed: null,
        notes: "Top-level index linking PTRs, FDs, travel, and other filings.",
      },
    ],
    notes: [
      "STOCK Act PTRs disclose trades by Members, spouses, and dependents within 30-45 days of execution.",
      "Values are reported as dollar ranges (e.g. $1,001 - $15,000), not exact amounts or share counts.",
      "Many headline 'Pelosi trades' are executed by her spouse Paul Pelosi and disclosed under her name as required by the STOCK Act.",
    ],
  },
];

const summaryCache = new Map<
  string,
  { at: number; data: PoliticiansSummaryResponse }
>();

async function probeUrl(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "GET", headers: HEADERS });
    return r.ok;
  } catch {
    return false;
  }
}

async function buildPoliticianSummary(
  def: PoliticianDef,
): Promise<PoliticianSummary> {
  // Best-effort reachability probe — we don't fail the response on probe
  // failure (the page may rate-limit GETs from a server) but we surface it
  // in `notes` if a primary link is unreachable so the UI can warn.
  const reachable = await probeUrl(def.disclosurePortalUrl);
  const liveNotes: string[] = [...def.notes];
  if (!reachable) {
    liveNotes.push(
      "Disclosure portal could not be reached from server at this time; links remain canonical and may work in the browser.",
    );
  }
  return {
    key: def.key,
    name: def.name,
    role: def.role,
    party: def.party,
    state: def.state,
    status: "ok",
    disclosurePortalUrl: def.disclosurePortalUrl,
    disclosureDelayNote:
      "STOCK Act disclosures are delayed (typically 30-45 days after a trade) and report dollar value ranges rather than exact amounts or share counts.",
    disclosures: def.disclosures,
    recentTransactions: [] as never[],
    notes: liveNotes,
  };
}

export async function getPoliticiansSummary(): Promise<PoliticiansSummaryResponse> {
  const cacheKey = "ALL";
  const now = Date.now();
  const cached = summaryCache.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  const politicians = await Promise.all(
    POLITICIANS.map((p) => buildPoliticianSummary(p)),
  );
  const response: PoliticiansSummaryResponse = {
    politicians,
    lastUpdated: now,
    sources: [
      {
        label: "House Clerk — Financial Disclosure",
        url: "https://disclosures-clerk.house.gov/FinancialDisclosure",
      },
      {
        label: "Senate — Financial Disclosures",
        url: "https://efdsearch.senate.gov/search/",
      },
    ],
    notes:
      "Politician data is sourced from STOCK Act Periodic Transaction Reports and Annual Financial Disclosures published on the House Clerk and Senate portals. Values are dollar ranges; this view links to the official PDFs and does not reconstruct portfolio holdings.",
  };
  summaryCache.set(cacheKey, { at: now, data: response });
  return response;
}
