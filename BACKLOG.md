---
kanban-plugin: board
project: Solana-arb-bot
repo: https://github.com/auntiehomie/solana-arb-bot
priority: "4"
last worked: 2026-04-29
---

## Next

- [ ] - Write unit tests for fees.ts (calcNetProfit, feeFloorPct) [added::2026-04-29]
- [ ] - Benchmark fee floor across trade sizes (0.05, 0.1, 0.5 SOL) and log results [added::2026-04-29]
- [ ] - Evaluate adding USDT and mSOL to TOKENS list for more pair coverage [added::2026-04-29]
- [ ] - Open PR: merge feature/diagnostics-rufusarb-bot into main [added::2026-04-29]


## In Progress

- [ ] - Identify DEX pairs worth targeting (ongoing as dex-blocklist evolves)
- [ ] - Build and test basic arb logic (WebSocket + polling loop operational)


## In Review



## Backlog

- [ ] - Research low-fee arbitrage strategies on Solana (partially done — fee model implemented; deeper strategy research needed)


## Done

- [x] - Researching fee-efficient arb approach [done::2026-04-29]
- [x] - Model fee impact vs opportunity capture rate [done::2026-04-29]
  - Added src/utils/fees.ts with full tx fee model (base + priority + Jito tip)
  - Net profit gating in circular scanner and event handler
  - Fee floor % logged at startup so operator can tune MIN_PROFIT_PCT


## Cancelled



%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
