# Signal taxonomy

A short reference for how TreasuryLens scores and labels ideas, and which
signals are surfaced as product metrics vs. kept internal.

## Navigation (five primary destinations)

The product has exactly five top-level destinations. `PRIMARY_TABS` in
`client/src/components/PrimaryNav.tsx` is the single source of truth, consumed
by both the desktop `PrimaryNav` and the mobile bottom bar (`MobileNav`).

| Tab | Route | Purpose |
| --- | --- | --- |
| **Dashboard** | `/dashboard` (`/`, `/app`, `/conviction`) | Monitor & research: grouped watchlist, ticker header/market data/chart, signal accordions, Revenue Intelligence, Buffett quality check, analyst consensus, action signals, model/backtest evidence. |
| **Ideas** | `/ideas` | Consolidated discovery. Sub-tabs: **Discovery** (stock picks / themes / ETFs, from `StockPicksBody`) and **Trade Ideas** (longs + bullish options, from `TradeIdeasBody`). |
| **Portfolio Lab** | `/portfolio-lab` | Model / paper portfolio construction (`server/portfolioLab.ts`, `POST /api/portfolio-lab`). Source selection, weighting styles, constraints, holdings/weights, theme & risk exposure, warnings. No brokerage / orders. |
| **Model Lab** | `/model-lab` | Tune / validate the model. |
| **13F** | `/13f` (`/superinvestors`) | Investor intelligence. |

Backwards-compatible routes resolve to the consolidated surfaces but are **not**
shown in the nav: `/stock-picks`, `/themes`, `/groups`, `/trade-ideas`,
`/trade-ideas/longs`, `/trade-ideas/options` → Ideas; `/portfolio`,
`/investment-groups`, `/baskets` → Portfolio Lab. The standalone classic pages
remain directly reachable at `/stock-picks-classic`, `/trade-ideas-classic` and
`/investment-groups-classic`.

Each discovery page exposes an embeddable `*Body` component (no header / mobile
chrome) plus a thin default page export that adds the standard header and
`MobileNav`. Ideas composes the bodies under sub-tabs so there is no duplicated
logic.

| Signal | Source | Surfaced as a product metric? |
| --- | --- | --- |
| **Manual conviction** (`convictionScore`, 0-100) | Human opinion, carried in schema/API and the add-idea form. | **No.** Internal/legacy only. Not rendered on Dashboard, Stock Picks, Trade Ideas or Investment Groups. Retained as a faint (±1 pt) tiebreaker in the Trade Ideas long ranking. |
| **Quant Score** | Computed factor model (`server/quantScore.ts`). | Yes — Dashboard signal accordion. |
| **Model Action** | Final consolidated decision (`server/actionSignal.ts`). | Yes — the headline action row. |
| **Scenario upside / downside** | Deterministic scenario model (bull/base/bear implied returns, `server/scenarioModel.ts`). | Yes — Bull %, Base %, Bear % across tables and detail. |
| **Trade Ideas Model Score** (`ideaScore`) | Weighted blend of computed inputs: 30% scenario reward/risk + 22% base-case room + 20% entry quality + 18% catalyst/actionability + 10% downside guardrail (`server/tradeIdeas.ts`). | Yes — the long ranking. |
| **Reward / risk** (`rewardRiskRatio`) | Scenario bull% / \|bear%\|. | **Not a headline metric.** Used internally as one input to the Model Score and described in methodology text only; the generic R/R multiplier is no longer shown as a standalone column, tile or snapshot stat. |

Risk concepts that **are** kept visible: Bear downside, Base upside, Bull
upside, downside guardrail, and (for options) max risk, max reward, breakeven
and bull payoff on risk.

## Performance / credit

The universe is enriched once via `getStockPicks()`; `getTradeIdeas()` reuses
that result and caches its own output for 30 minutes (`TTL_MS` in
`server/tradeIdeas.ts`). Touch these caches before adding new provider calls in
the ranking path.
