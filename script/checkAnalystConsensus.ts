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
//   # explicit token
//   FINNHUB_API_KEY=xxxxxxxxxxxx npx tsx script/checkAnalystConsensus.ts NVDA AAPL
//
//   # proxy / custom-credential injection (no token in env; proxy adds it)
//   HTTPS_PROXY=http://127.0.0.1:8080 npx tsx script/checkAnalystConsensus.ts NVDA
//
// Exit code is 0 if every requested ticker resolves to `available` OR a benign
// `unavailable` (e.g. no coverage / no credential), and 1 if any errored.

import { getAnalystConsensus } from "../server/analystConsensus";

const tokenConfigured = Boolean(
  (process.env.CUSTOM_CRED_FINNHUB_IO_TOKEN ||
    process.env.FINNHUB_API_KEY ||
    process.env.FINNHUB_TOKEN ||
    "").trim(),
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

  console.log("[analyst-consensus check]");
  console.log(`  token env present: ${tokenConfigured}`);
  console.log(`  proxy env present: ${proxyConfigured}`);
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
