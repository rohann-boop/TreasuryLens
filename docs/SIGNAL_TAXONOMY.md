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
| **Ideas** | `/ideas` | Consolidated discovery. Sub-tabs: **Discovery** (stock picks / themes / ETFs, from `StockPicksBody`), **Trade Ideas** (longs + bullish options, from `TradeIdeasBody`) and **Tactical** (short-term setups + tactical options, from `TacticalIdeasBody`). |
| **Portfolio Lab** | `/portfolio-lab` | Model / paper portfolio construction (`server/portfolioLab.ts`, `POST /api/portfolio-lab`). Source selection, weighting styles, constraints, holdings/weights, theme & risk exposure, warnings. A second **All-Weather** mode (`AllWeatherBody`, `server/allWeather.ts`, `GET /api/all-weather`) surfaces curated multi-asset sleeve templates. No brokerage / orders. |
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
| **Tactical Score** (`tacticalScore`) | Weighted blend of computed inputs: 32% trend/momentum + 26% base-case room + 18% entry quality + 14% scenario reward/risk + 10% catalyst (`server/tacticalIdeas.ts`). | Yes — the Tactical setups ranking. |
| **Reward / risk** (`rewardRiskRatio`) | Scenario bull% / \|bear%\|. | **Not a headline metric.** Used internally as one input to the Model Score and described in methodology text only; the generic R/R multiplier is no longer shown as a standalone column, tile or snapshot stat. |

Risk concepts that **are** kept visible: Bear downside, Base upside, Bull
upside, downside guardrail, and (for options) max risk, max reward, breakeven
and bull payoff on risk.

## Performance / credit

The universe is enriched once via `getStockPicks()`; `getTradeIdeas()` reuses
that result and caches its own output for 30 minutes (`TTL_MS` in
`server/tradeIdeas.ts`). Touch these caches before adding new provider calls in
the ranking path.

`getTacticalIdeas()` (`server/tacticalIdeas.ts`) reuses the same enriched
universe and the same option engine helpers (`buildLong`, `buildOption`,
`structuresFor`, `ivProxyPct` exported from `server/tradeIdeas.ts`) — no
universe expansion and no new provider calls. It caches its own output for 30
minutes.

## Tactical Ideas

Tactical Ideas (`server/tacticalIdeas.ts`, `GET /api/tactical-ideas`,
`TacticalIdeasBody`) ranks **short-term** setups from the same curated universe
Trade Ideas uses. Where Trade Ideas ranks multi-year conviction, Tactical Ideas
surfaces names with a near-term, model-implied mispricing.

- **Setup classification** (`classifySetup`) is derived from trailing momentum
  windows (`keyMetrics.performance` 1m/6m) plus remaining scenario base-case
  room — no intraday technicals are attached to picks. Kinds:
  momentum-continuation, breakout-watch, pullback-in-uptrend,
  mean-reversion-rebound, value-dislocation. Each maps to a coarse holding
  horizon (2-6 weeks / 1-3 months / 3-6 months).
- **Tactical Score** is the transparent weighted blend in the table above
  (32/26/18/14/10). `momentumScore` rewards a constructive, *non-parabolic*
  trend (6m peaks ~+20–40%, trimmed beyond +80%).
- **Expected upside** is a model-implied **range** (`tacticalUpsideRange`) that
  compresses scenario base/bull room into the tactical horizon via per-setup
  capture fractions — never a multi-year target and never a promise. We surface
  upside / downside / invalidation, **not** a generic R/R multiplier (consistent
  with Trade Ideas).
- **Signal quality** (0-100) reflects how much data backed the read; penalised
  for missing momentum windows or scenario coverage.
- **Tactical options** reuse the Trade Ideas **modeled-fallback** engine (no
  live option chain) re-tagged with the setup + tactical horizon, ranked by the
  same payoff-adjusted actionability score. Options can expire worthless.

Short-term and options ideas carry **elevated risk**. Research only — not
personalized financial advice.

## All-Weather Portfolios

All-Weather Portfolios (`server/allWeather.ts`, `GET /api/all-weather`,
`AllWeatherBody` inside Portfolio Lab's **All-Weather** mode) are curated
multi-asset model **templates** that allocate across asset **sleeves** rather
than building an equity basket. The existing basket builder is unchanged.

- **Sleeves**: equities, AI/growth, gold, bitcoin, bonds, cash, commodities,
  real assets — each represented in V1 by one broad proxy (VTI, QQQ, GLD, BTC,
  TLT, BIL, DBC, VNQ). Proxies are research stand-ins, not recommendations.
- **Templates**: All Weather Conservative, All Weather Growth, Inflation Hedge,
  AI Growth + Hedges, Risk-Off Defense. Base sleeve weights sum to 100.
- **Risk dial** (`resolveTemplate`): defensive / balanced / growth. Balanced
  shows authored weights; defensive/growth scale the defensive sleeves
  (bonds/cash/gold) against the growth sleeves (equities/AI-growth/bitcoin) by a
  fixed 1.3×/0.7× factor, then renormalise every sleeve to 100%. Deterministic —
  no optimisation, no backtest.
- Each resolved template shows sleeve weights, the role of each sleeve, regime
  expectations (qualitative author judgements across inflation rising, rates
  falling, growth accelerating, recession/risk-off, dollar weakness, bitcoin
  bull, AI boom), key risks, rebalance cadence and a "how it works" explainer.

Curated, research-only model templates — not optimised, not backtested, not
personalized advice, and they place no orders.
