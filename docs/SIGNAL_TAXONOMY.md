# Signal taxonomy

A short reference for how TreasuryLens scores and labels ideas, and which
signals are surfaced as product metrics vs. kept internal.

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
