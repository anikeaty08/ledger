# @ledger/keeper

Permissionless automation for Ledger. Every function this service calls is public and callable by
anyone — this is a convenience runner, not a privileged operator. It holds no user or protocol funds
beyond its own gas balance, and on mainnet each action pays a small on-chain bounty back to its caller
(see `docs/SYSTEM_DESIGN.md` §10 "Keeper / Automation Design").

## Jobs

- **Overdue / default sweep** (`src/jobs/overdueAndDefault.ts`) — scans recent invoices and calls
  `InvoiceRegistry.markOverdue` / `CollectionsManager.declareDefault` once they're eligible.
- **Guardian sweep** (`src/jobs/guardianSweep.ts`) — scans `LedgerAccount`s created via the factory and
  calls `guardianCheck` (risk-reducing only, bounded by the owner's own limits) and `paydown` on active
  positions.

## Run

```powershell
Copy-Item .env.example .env
# fill in the deployed contract addresses and a funded KEEPER_PRIVATE_KEY (testnet BTC for gas)
npm install
npm run dev       # polls forever
npm run once       # single tick, useful for a cron job / GitHub Action instead of a long-running process
```

## Notes

- Every RPC/tx failure for one invoice or account is caught and logged; it never aborts the rest of the
  sweep (see the try/catch per iteration in each job).
- `BATCH_SIZE` bounds how many recent invoice ids are scanned per tick — this is a hackathon-simple
  sweep, not an indexed query. `services/indexer` (Ponder) is the production path for at-scale
  discovery; this keeper works standalone against just an RPC URL for the demo.
