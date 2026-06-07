// Runtime smoke test for the Finnhub analyst-consensus service.
//
// It calls getAnalystConsensus() for one or more tickers and prints the
// resolved status + message (never the token or URL). Use it to verify the
// credential wiring after starting the server with the finnhub.io custom
// credential — without needing the full Express app.
//
// Usage:
//   npx tsx script/checkAnalystConsensus.ts [TICKER ...]
//
// Examples:
//   # explicit Finnhub API key (calls finnhub.io directly with ?token=)
//   FINNHUB_API_KEY=xxxxxxxxxxxx npx tsx script/checkAnalystConsensus.ts NVDA AAPL
//
//   # custom-credential pass-through (set by start_server with
//   # api_credentials=['custom-cred:finnhub.io']): the proxy URL is called with
//   # the target Finnhub URL appended and the token sent as x-api-key.
//   CUSTOM_CRED_FINNHUB_IO_URL=https://agent-proxy.perplexity.ai/agent_pass_through \
//   CUSTOM_CRED_FINNHUB_IO_TOKEN=... npx tsx script/checkAnalystConsensus.ts NVDA
//
//   # HTTPS_PROXY network-layer injection (no token in env; proxy adds it)
//   HTTPS_PROXY=http://127.0.0.1:8080 npx tsx script/checkAnalystConsensus.ts NVDA
//
// Exit code is 0 if every requested ticker resolves to `available` OR a benign
// `unavailable` (e.g. no coverage / no credential), and 1 if any errored.

import { getAnalystConsensus } from "../server/analystConsensus";

const apiKeyConfigured = Boolean(
  (process.env.FINNHUB_API_KEY || process.env.FINNHUB_TOKEN || "").trim(),
);
const passThroughUrl = (process.env.CUSTOM_CRED_FINNHUB_IO_URL || "").trim();
const passThroughTokenSet = Boolean(
  (process.env.CUSTOM_CRED_FINNHUB_IO_TOKEN || "").trim(),
);
const proxyConfigured = Boolean(
  (process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    "").trim(),
);

async function main() {
  const tickers = process.argv.slice(2).filter(Boolean);
  const symbols = tickers.length ? tickers : ["NVDA", "AAPL"];

  const mode = apiKeyConfigured
    ? "explicit FINNHUB_API_KEY -> finnhub.io (?token=)"
    : passThroughUrl && passThroughTokenSet
      ? "custom-cred pass-through -> proxy URL with x-api-key"
      : proxyConfigured
        ? "HTTPS_PROXY credential injection (curl/tunnel)"
        : "system curl credential injection (or none)";

  console.log("[analyst-consensus check]");
  console.log(`  FINNHUB_API_KEY present:           ${apiKeyConfigured}`);
  console.log(`  CUSTOM_CRED_FINNHUB_IO_URL present: ${Boolean(passThroughUrl)}`);
  console.log(`  CUSTOM_CRED_FINNHUB_IO_TOKEN set:   ${passThroughTokenSet}`);
  console.log(`  HTTPS_PROXY present:               ${proxyConfigured}`);
  console.log(`  mode:                              ${mode}`);
  console.log("");

  let hadError = false;
  for (const symbol of symbols) {
    const c = await getAnalystConsensus(symbol);
    if (c.status === "error") hadError = true;
    const detail =
      c.status === "available"
        ? `${c.consensusLabel ?? "—"} · ${c.totalAnalysts ?? 0} analysts · mean ${c.meanScore ?? "—"} (${c.latestPeriod ?? "?"})`
        : c.message;
    console.log(`  ${symbol.padEnd(6)} → ${c.status.toUpperCase().padEnd(11)} ${detail}`);
  }

  console.log("");
  console.log(hadError ? "RESULT: error(s) above" : "RESULT: ok");
  process.exit(hadError ? 1 : 0);
}

main().catch((e) => {
  console.error("check failed:", (e as Error).message);
  process.exit(1);
});
