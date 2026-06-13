// Shared Finnhub transport + credential resolution.
//
// Both the analyst-consensus service (recommendation trends) and the
// analyst-estimates service (revenue/EPS/price-target) need the exact same
// credential plumbing: an explicit API key, a custom-credential pass-through
// proxy, or network-layer HTTPS_PROXY injection. This module centralises that
// so neither service re-implements it and no secret is ever logged.
//
// Credential resolution modes (in priority order):
//   1. Explicit Finnhub key (FINNHUB_API_KEY / FINNHUB_TOKEN) → ?token=.
//   2. Custom-credential pass-through (CUSTOM_CRED_FINNHUB_IO_{URL,TOKEN}) →
//      call the proxy with the /api/v1 path and an x-api-key header; the proxy
//      injects the real key.
//   3. HTTPS_PROXY credential injection → call finnhub.io with no token and let
//      the proxy add it on the wire (via curl, then a CONNECT tunnel, then a
//      bare fetch as last resort).
//
// Behaviour is graceful: getFinnhubJson returns a typed result describing the
// outcome (ok / no-credential / status code / error) rather than throwing for
// the common unavailable states.

import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";

const DEFAULT_BASE = "https://finnhub.io/api/v1";
const FETCH_TIMEOUT_MS = 8000;

const PLACEHOLDER_RE =
  /^(undefined|null|none|n\/a|na|true|false|0|changeme|change_me|your[-_]?(api[-_]?)?(key|token)|finnhub[-_]?(api[-_]?)?(key|token)|placeholder|example|test|dummy|xxx+|\*+|<.*>)$/i;

function looksLikeRealToken(value: string): boolean {
  const v = value.trim();
  if (v.length < 8) return false;
  if (PLACEHOLDER_RE.test(v)) return false;
  return true;
}

function getFinnhubApiKey(): string {
  const candidates = [process.env.FINNHUB_API_KEY, process.env.FINNHUB_TOKEN];
  for (const raw of candidates) {
    const v = (raw || "").trim();
    if (v && looksLikeRealToken(v)) return v;
  }
  return "";
}

function getPassThroughToken(): string {
  const v = (process.env.CUSTOM_CRED_FINNHUB_IO_TOKEN || "").trim();
  return v && looksLikeRealToken(v) ? v : "";
}

function isFinnhubHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "finnhub.io" || h.endsWith(".finnhub.io");
}

function getPassThroughBase(): string {
  const raw = (process.env.CUSTOM_CRED_FINNHUB_IO_URL || "").trim();
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "";
  if (isFinnhubHost(u.hostname)) return "";
  return raw.replace(/\/+$/, "");
}

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
    new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  } catch {
    return "";
  }
}

function normaliseFinnhubBase(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  let u: URL;
  try {
    u = new URL(cleaned);
  } catch {
    return "";
  }
  if (!isFinnhubHost(u.hostname)) return "";
  if (/\/api\/v\d+$/i.test(u.pathname)) return `${u.protocol}//${u.host}${u.pathname}`;
  return `${u.protocol}//${u.host}/api/v1`;
}

function getBaseUrl(): string {
  const explicit = normaliseFinnhubBase(process.env.FINNHUB_BASE_URL || "");
  if (explicit) return explicit;
  const custom = normaliseFinnhubBase(process.env.CUSTOM_CRED_FINNHUB_IO_URL || "");
  if (custom) return custom;
  return DEFAULT_BASE;
}

interface HttpResult {
  status: number;
  ok: boolean;
  body: string;
}

async function fetchGetJson(
  targetUrl: string,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: "application/json", ...extraHeaders },
      signal: controller.signal,
    });
    const body = await res.text();
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

// GET via system curl so the harness HTTPS_PROXY credential injection works
// (Node's native fetch ignores proxy env vars). Fixed argv array, no shell, so
// there is no injection surface; header values are never interpolated/logged.
function curlGetJson(
  targetUrl: string,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "--silent",
      "--show-error",
      "--max-time",
      String(Math.ceil(FETCH_TIMEOUT_MS / 1000)),
      "-H",
      "Accept: application/json",
    ];
    for (const [k, v] of Object.entries(extraHeaders)) {
      args.push("-H", `${k}: ${v}`);
    }
    args.push("--write-out", "\n%{http_code}", "--", targetUrl);
    execFile(
      "curl",
      args,
      { timeout: FETCH_TIMEOUT_MS + 2000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          reject(err);
          return;
        }
        const out = String(stdout);
        const nl = out.lastIndexOf("\n");
        const statusStr = nl >= 0 ? out.slice(nl + 1).trim() : "";
        const body = nl >= 0 ? out.slice(0, nl) : out;
        const status = Number(statusStr) || 0;
        if (!status) {
          reject(err || new Error("curl produced no HTTP status"));
          return;
        }
        resolve({ status, ok: status >= 200 && status < 300, body });
      },
    );
  });
}

let curlAvailable: boolean | null = null;
function hasCurl(): Promise<boolean> {
  if (curlAvailable !== null) return Promise.resolve(curlAvailable);
  return new Promise((resolve) => {
    execFile("curl", ["--version"], { timeout: 4000 }, (err) => {
      curlAvailable = !err;
      resolve(curlAvailable);
    });
  });
}

function proxyGetJson(targetUrl: string, proxyUrl: string): Promise<HttpResult> {
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

    const timer = setTimeout(() => settle.err(new Error("timeout")), FETCH_TIMEOUT_MS);
    const clearTimer = () => clearTimeout(timer);

    const sendOverSocket = (tunnel: import("node:net").Socket) => {
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

async function httpGetJson(
  targetUrl: string,
  proxyUrl: string,
  selfContained: boolean,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  if (selfContained) return fetchGetJson(targetUrl, extraHeaders);
  if (await hasCurl()) return curlGetJson(targetUrl, extraHeaders);
  if (proxyUrl) return proxyGetJson(targetUrl, proxyUrl);
  return fetchGetJson(targetUrl, extraHeaders);
}

// Outcome of a Finnhub GET. `kind` is the coarse state callers branch on.
export type FinnhubFetchResult =
  | { kind: "ok"; json: unknown }
  | { kind: "no-credential"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "premium"; message: string } // 403/402 — endpoint not on this tier
  | { kind: "bad-status"; status: number; message: string }
  | { kind: "non-json"; message: string }
  | { kind: "error"; message: string };

// True when *some* credential mode is configured. Lets callers short-circuit to
// a single "no credential" state without issuing a request per endpoint.
export async function hasFinnhubCredential(): Promise<boolean> {
  if (getFinnhubApiKey()) return true;
  if (getPassThroughBase() && getPassThroughToken()) return true;
  if (getProxyUrl()) return true;
  if (await hasCurl()) return true;
  return false;
}

// Fetch a Finnhub REST path (e.g. "/stock/price-target?symbol=AAPL") across the
// supported credential modes. The path MUST already be URL-encoded by the
// caller. Never throws for the common unavailable states — returns a typed
// result instead.
export async function getFinnhubJson(path: string): Promise<FinnhubFetchResult> {
  const apiKey = getFinnhubApiKey();
  const passThroughBase = getPassThroughBase();
  const passThroughToken = getPassThroughToken();
  const proxyUrl = getProxyUrl();
  const finnhubBase = getBaseUrl();

  let url: string;
  let extraHeaders: Record<string, string> = {};
  let selfContained: boolean;

  if (apiKey) {
    const sep = path.includes("?") ? "&" : "?";
    url = `${finnhubBase}${path}${sep}token=${encodeURIComponent(apiKey)}`;
    selfContained = true;
  } else if (passThroughBase && passThroughToken) {
    url = `${passThroughBase}/api/v1${path}`;
    extraHeaders = { "x-api-key": passThroughToken };
    selfContained = true;
  } else if ((await hasCurl()) || proxyUrl) {
    url = `${finnhubBase}${path}`;
    selfContained = false;
  } else {
    return {
      kind: "no-credential",
      message:
        "Analyst estimates need a Finnhub credential. Provide the finnhub.io custom credential, or set FINNHUB_API_KEY.",
    };
  }

  let res: HttpResult;
  try {
    res = await httpGetJson(url, proxyUrl, selfContained, extraHeaders);
  } catch (e) {
    const msg = (e as Error)?.message || "";
    const timedOut = msg === "timeout" || (e as Error)?.name === "AbortError";
    return {
      kind: "error",
      message: timedOut
        ? "Finnhub request timed out."
        : `Finnhub request failed: ${msg || "network error"}`,
    };
  }

  if (res.status === 401) {
    return { kind: "unauthorized", message: "Finnhub rejected the credential (401)." };
  }
  // 403/402 on the estimate/price-target endpoints typically means the endpoint
  // is not entitled on the current (free) tier rather than a bad key.
  if (res.status === 403 || res.status === 402) {
    return {
      kind: "premium",
      message:
        "Finnhub endpoint not available on this plan (403/402) — analyst estimates require a premium entitlement.",
    };
  }
  if (res.status === 429) {
    return { kind: "rate-limited", message: "Finnhub rate limit reached — try again shortly." };
  }
  if (res.status === 404) {
    return { kind: "not-found", message: "Finnhub endpoint not found (404)." };
  }
  if (!res.ok) {
    return {
      kind: "bad-status",
      status: res.status,
      message: `Finnhub endpoint unavailable (HTTP ${res.status}).`,
    };
  }
  try {
    return { kind: "ok", json: JSON.parse(res.body) };
  } catch {
    return { kind: "non-json", message: "Finnhub returned a non-JSON response." };
  }
}
