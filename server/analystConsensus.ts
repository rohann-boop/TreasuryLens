// Finnhub analyst-consensus service. Fetches Wall-Street recommendation trends
// from Finnhub's free-tier `/stock/recommendation` endpoint and reduces them to
// a typed AnalystConsensus the UI can render directly.
//
// Credential resolution is deliberately flexible so the service works in two
// deployment modes without any secret being committed:
//
//   1. Explicit token — CUSTOM_CRED_FINNHUB_IO_TOKEN (secure custom credential
//      injected at runtime) or FINNHUB_API_KEY. The token is appended as the
//      `token` query param. Placeholder values (your_key, changeme, …) are
//      rejected so we never send `token=undefined` or a dummy.
//
//   2. HTTPS proxy injection — when no real token is present but an outbound
//      proxy is configured (HTTPS_PROXY / HTTP_PROXY / ALL_PROXY, e.g. the
//      Perplexity custom-credential proxy that injects auth on the wire), we
//      call the endpoint WITHOUT a token param and let the proxy add it. Node's
//      native fetch ignores these proxy env vars, so we tunnel the request
//      through the proxy via an HTTP CONNECT helper built on node:http/https.
//
// The base URL defaults to https://finnhub.io/api/v1 but honours
// CUSTOM_CRED_FINNHUB_IO_URL / FINNHUB_BASE_URL when set, normalising a bare
// host to the /api/v1 API base so the endpoint path always resolves.
//
// Behaviour is graceful by design: no credential, an uncovered ticker
// (ETFs / funds / ambiguous symbols return an empty array), an invalid token,
// or a provider error each map to an explicit status + message rather than a
// fabricated verdict. Results are cached in-memory (6h TTL) to stay well under
// free-tier limits. No secret is ever logged.

import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";

import type {
  AnalystConsensus,
  AnalystConsensusLabel,
  AnalystRecommendationPeriod,
} from "@shared/schema";

const DEFAULT_BASE = "https://finnhub.io/api/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — recommendation trends update monthly
const NEG_CACHE_TTL_MS = 30 * 60 * 1000; // 30m for unavailable/error so we retry sooner
const FETCH_TIMEOUT_MS = 8000;
const MAX_HISTORY = 6;

const cache = new Map<string, { at: number; data: AnalystConsensus }>();

// Reject obvious placeholders so we never send token=undefined/null/empty or a
// committed dummy value. A real Finnhub token is an alphanumeric string; the
// common placeholder shapes below are treated as "no token".
const PLACEHOLDER_RE =
  /^(undefined|null|none|n\/a|na|true|false|0|changeme|change_me|your[-_]?(api[-_]?)?(key|token)|finnhub[-_]?(api[-_]?)?(key|token)|placeholder|example|test|dummy|xxx+|\*+|<.*>)$/i;

function looksLikeRealToken(value: string): boolean {
  const v = value.trim();
  if (v.length < 8) return false; // Finnhub tokens are well over 8 chars
  if (PLACEHOLDER_RE.test(v)) return false;
  return true;
}

// Resolve an explicit token, or "" when none is configured / it's a placeholder.
function getToken(): string {
  const candidates = [
    process.env.CUSTOM_CRED_FINNHUB_IO_TOKEN,
    process.env.FINNHUB_API_KEY,
    process.env.FINNHUB_TOKEN,
  ];
  for (const raw of candidates) {
    const v = (raw || "").trim();
    if (v && looksLikeRealToken(v)) return v;
  }
  return "";
}

// Detect an outbound HTTPS proxy (e.g. the custom-credential injection proxy).
// Honours the conventional env vars in both upper- and lower-case. NO_PROXY is
// intentionally ignored here: this service only ever talks to finnhub.io, so if
// a proxy is configured we always want to route through it.
function getProxyUrl(): string {
  const raw = (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    ""
  ).trim();
  if (!raw) return "";
  try {
    // Validate it parses as a URL; tolerate a bare host:port by prefixing http.
    new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  } catch {
    return "";
  }
}

// Resolve the API base. CUSTOM_CRED_FINNHUB_IO_URL / FINNHUB_BASE_URL may be a
// bare host (https://finnhub.io) or a full API base (https://finnhub.io/api/v1).
// We normalise either to a `/api/v1` base so the endpoint path always resolves
// and we never hit /stock/recommendation at the host root.
function getBaseUrl(): string {
  const raw = (
    process.env.CUSTOM_CRED_FINNHUB_IO_URL ||
    process.env.FINNHUB_BASE_URL ||
    ""
  ).trim();
  if (!raw) return DEFAULT_BASE;
  const cleaned = raw.replace(/\/+$/, "");
  if (/\/api\/v\d+$/i.test(cleaned)) return cleaned;
  // Bare host or unexpected path → append the known free-tier API base path.
  try {
    const u = new URL(cleaned);
    return `${u.protocol}//${u.host}/api/v1`;
  } catch {
    return DEFAULT_BASE;
  }
}

interface HttpResult {
  status: number;
  ok: boolean;
  body: string;
}

// Perform a GET, tunnelling through an HTTP CONNECT proxy when one is
// configured. Node's native fetch ignores HTTPS_PROXY, so when relying on a
// custom-credential injection proxy we must build the request by hand. When no
// proxy is set we fall back to native fetch. Either way we time out and never
// log the URL (it may carry a token query param).
async function httpGetJson(
  targetUrl: string,
  proxyUrl: string,
): Promise<HttpResult> {
  if (!proxyUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(targetUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const body = await res.text();
      return { status: res.status, ok: res.ok, body };
    } finally {
      clearTimeout(timer);
    }
  }
  return proxyGetJson(targetUrl, proxyUrl);
}

// HTTPS-over-proxy via CONNECT tunnel. Opens a plaintext connection to the
// proxy, issues CONNECT host:443, then makes the TLS GET over the tunnel. This
// lets a credential-injecting proxy observe/modify the request as configured.
function proxyGetJson(
  targetUrl: string,
  proxyUrl: string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const proxy = new URL(proxyUrl);
    const isHttpsTarget = target.protocol === "https:";
    const targetPort = target.port || (isHttpsTarget ? "443" : "80");

    const settle = (() => {
      let done = false;
      return {
        ok: (r: HttpResult) => {
          if (!done) {
            done = true;
            resolve(r);
          }
        },
        err: (e: Error) => {
          if (!done) {
            done = true;
            reject(e);
          }
        },
      };
    })();

    const timer = setTimeout(
      () => settle.err(new Error("timeout")),
      FETCH_TIMEOUT_MS,
    );
    const clearTimer = () => clearTimeout(timer);

    const sendOverSocket = (tunnel: import("node:net").Socket) => {
      // For an https target, layer TLS over the raw CONNECT tunnel. For http,
      // use the tunnel socket as-is.
      const socket = isHttpsTarget
        ? tlsConnect({ socket: tunnel, servername: target.hostname })
        : tunnel;
      socket.on("error", (e) => {
        clearTimer();
        settle.err(e);
      });
      const reqOpts: RequestOptions = {
        method: "GET",
        host: target.hostname,
        port: Number(targetPort),
        path: `${target.pathname}${target.search}`,
        headers: { Accept: "application/json", Host: target.host },
        agent: false,
        // Reuse the (TLS-wrapped) tunnel socket rather than dialling again.
        createConnection: () => socket as import("node:net").Socket,
        servername: target.hostname,
      };
      const reqFn = isHttpsTarget ? httpsRequest : httpRequest;
      const req = reqFn(reqOpts, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          clearTimer();
          const status = res.statusCode ?? 0;
          settle.ok({
            status,
            ok: status >= 200 && status < 300,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      });
      req.on("error", (e) => {
        clearTimer();
        settle.err(e);
      });
      req.end();
    };

    // Establish the CONNECT tunnel through the proxy.
    const connectHeaders: Record<string, string> = {
      Host: `${target.hostname}:${targetPort}`,
    };
    if (proxy.username) {
      connectHeaders["Proxy-Authorization"] = `Basic ${Buffer.from(
        `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
      ).toString("base64")}`;
    }
    const connectReq = httpRequest({
      host: proxy.hostname,
      port: Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80)),
      method: "CONNECT",
      path: `${target.hostname}:${targetPort}`,
      headers: connectHeaders,
    });
    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        clearTimer();
        settle.err(new Error(`proxy CONNECT failed (${res.statusCode})`));
        socket.destroy();
        return;
      }
      sendOverSocket(socket);
    });
    connectReq.on("error", (e) => {
      clearTimer();
      settle.err(e);
    });
    connectReq.end();
  });
}

function labelForMean(mean: number | null): AnalystConsensusLabel | null {
  if (mean == null || !Number.isFinite(mean)) return null;
  // 1 = Strong Buy ... 5 = Strong Sell (lower is more bullish).
  if (mean <= 1.5) return "Strong Buy";
  if (mean <= 2.5) return "Buy";
  if (mean <= 3.5) return "Hold";
  if (mean <= 4.5) return "Sell";
  return "Strong Sell";
}

function reducePeriod(raw: {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}): AnalystRecommendationPeriod {
  const strongBuy = Number(raw.strongBuy) || 0;
  const buy = Number(raw.buy) || 0;
  const hold = Number(raw.hold) || 0;
  const sell = Number(raw.sell) || 0;
  const strongSell = Number(raw.strongSell) || 0;
  const total = strongBuy + buy + hold + sell + strongSell;
  // Weighted mean on a 1..5 scale (1 = Strong Buy).
  const meanScore =
    total > 0
      ? (strongBuy * 1 + buy * 2 + hold * 3 + sell * 4 + strongSell * 5) / total
      : null;
  return {
    period: raw.period,
    strongBuy,
    buy,
    hold,
    sell,
    strongSell,
    total,
    meanScore: meanScore != null ? Number(meanScore.toFixed(2)) : null,
    label: labelForMean(meanScore),
    bullishPercent:
      total > 0 ? Number((((strongBuy + buy) / total) * 100).toFixed(1)) : null,
    bearishPercent:
      total > 0 ? Number((((sell + strongSell) / total) * 100).toFixed(1)) : null,
  };
}

function unavailable(symbol: string, message: string): AnalystConsensus {
  return {
    status: "unavailable",
    symbol,
    source: "finnhub",
    asOf: Date.now(),
    lastUpdated: null,
    latestPeriod: null,
    totalAnalysts: null,
    strongBuy: null,
    buy: null,
    hold: null,
    sell: null,
    strongSell: null,
    consensusLabel: null,
    meanScore: null,
    bullishPercent: null,
    bearishPercent: null,
    trendDirection: null,
    history: [],
    message,
  };
}

function errored(symbol: string, message: string): AnalystConsensus {
  return { ...unavailable(symbol, message), status: "error" };
}

export async function getAnalystConsensus(
  rawTicker: string,
): Promise<AnalystConsensus> {
  const symbol = rawTicker.trim().toUpperCase();
  if (!symbol) return unavailable(symbol, "No ticker provided.");

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const token = getToken();
  const proxyUrl = getProxyUrl();

  // Need one of: an explicit token, or a proxy that can inject the credential
  // on the wire. With neither, there is no way to authenticate to Finnhub.
  if (!token && !proxyUrl) {
    const data = unavailable(
      symbol,
      "Analyst consensus needs a Finnhub credential. Set CUSTOM_CRED_FINNHUB_IO_TOKEN (or FINNHUB_API_KEY), or run behind the finnhub.io custom-credential proxy.",
    );
    // Cache the no-credential state briefly so we don't re-check every request.
    cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
    return data;
  }

  const base = getBaseUrl();
  // Build the URL. Only append the token param when we actually have one — when
  // relying on proxy injection we send no token and never produce token=.
  const params = new URLSearchParams({ symbol });
  if (token) params.set("token", token);
  const url = `${base}/stock/recommendation?${params.toString()}`;

  const usingProxyOnly = !token && !!proxyUrl;

  let json: unknown;
  try {
    const res = await httpGetJson(url, proxyUrl);
    if (res.status === 401 || res.status === 403) {
      const data = errored(
        symbol,
        token
          ? "Finnhub rejected the API token (401/403). Verify the finnhub.io credential value."
          : "Finnhub rejected the request (401/403). The credential proxy did not inject a valid finnhub.io token.",
      );
      cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
      return data;
    }
    if (res.status === 429) {
      const data = errored(
        symbol,
        "Finnhub rate limit reached — try again shortly.",
      );
      cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
      return data;
    }
    if (res.status === 404) {
      const data = errored(
        symbol,
        "Finnhub endpoint not found (404). Check the API base URL resolves to /api/v1.",
      );
      cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
      return data;
    }
    if (!res.ok) {
      const data = errored(symbol, `Finnhub endpoint unavailable (HTTP ${res.status}).`);
      cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
      return data;
    }
    try {
      json = JSON.parse(res.body);
    } catch {
      const data = errored(
        symbol,
        usingProxyOnly
          ? "Finnhub returned a non-JSON response via the credential proxy."
          : "Finnhub returned a non-JSON response.",
      );
      cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
      return data;
    }
  } catch (e) {
    const msg = (e as Error)?.message || "";
    const timedOut = msg === "timeout" || (e as Error)?.name === "AbortError";
    const data = errored(
      symbol,
      timedOut
        ? "Finnhub request timed out."
        : `Finnhub request failed: ${msg || "network error"}`,
    );
    cache.set(symbol, { at: Date.now() - (CACHE_TTL_MS - NEG_CACHE_TTL_MS), data });
    return data;
  }

  if (!Array.isArray(json) || json.length === 0) {
    // Empty array = no analyst coverage (typical for ETFs / funds / uncovered
    // small caps / ambiguous tickers). This is an expected, graceful state.
    const data = unavailable(
      symbol,
      "No analyst coverage from Finnhub for this ticker (common for ETFs, funds, or thinly-covered names).",
    );
    cache.set(symbol, { at: Date.now(), data });
    return data;
  }

  // Periods come newest-first from Finnhub; sort defensively by period desc.
  const periods = (json as AnalystRecommendationPeriod[])
    .map((p) => reducePeriod(p as never))
    .filter((p) => p.total > 0)
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));

  if (periods.length === 0) {
    const data = unavailable(
      symbol,
      "Finnhub returned recommendation rows but no analyst counts for this ticker.",
    );
    cache.set(symbol, { at: Date.now(), data });
    return data;
  }

  const latest = periods[0];
  const prior = periods[1] ?? null;

  let trendDirection: AnalystConsensus["trendDirection"] = null;
  if (prior?.meanScore != null && latest.meanScore != null) {
    const delta = prior.meanScore - latest.meanScore; // positive = mean dropped = more bullish
    trendDirection =
      delta > 0.15 ? "improving" : delta < -0.15 ? "deteriorating" : "stable";
  }

  const data: AnalystConsensus = {
    status: "available",
    symbol,
    source: "finnhub",
    asOf: Date.now(),
    lastUpdated: latest.period,
    latestPeriod: latest.period,
    totalAnalysts: latest.total,
    strongBuy: latest.strongBuy,
    buy: latest.buy,
    hold: latest.hold,
    sell: latest.sell,
    strongSell: latest.strongSell,
    consensusLabel: latest.label,
    meanScore: latest.meanScore,
    bullishPercent: latest.bullishPercent,
    bearishPercent: latest.bearishPercent,
    trendDirection,
    history: periods.slice(0, MAX_HISTORY),
    message: `${latest.total} analyst${latest.total === 1 ? "" : "s"} · consensus ${latest.label ?? "—"} (as of ${latest.period}).`,
  };

  cache.set(symbol, { at: Date.now(), data });
  return data;
}
