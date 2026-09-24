# Ledger

**Get paid before your client pays.**
A Bitcoin-backed business account for freelancers on Mezo: turn client-accepted invoices into on-chain receivables, get an instant MUSD advance, and settle everything in MUSD.

Built for the Mezo Buildathon (Track 2: Access & Distribution · Track 1: DeFi).

## How it works

1. **Invoice:** create an invoice; terms are encrypted off-chain and a commitment goes on-chain.
2. **Accept:** the client accepts on-chain (gasless), which mints a **Receivable NFT**.
3. **Advance:** get up to 80% of the invoice in MUSD from the lender vault, priced by the client's on-chain payment score.
4. **Settle:** the client pays in MUSD or BTC (USDC on Base in Wave 2). The router repays the vault, then pays out the remainder, split across your team.
5. **Keep your BTC:** BTC payments can become collateral in a MUSD position instead of being sold; treasury yield pays the debt down, and a guardian protects against liquidation.
6. **Lend:** MUSD holders earn yield from real invoices through senior/junior ERC-4626 tranches.

## Mezo integration

MUSD · BTC · BorrowerOperations (+ signature ops) · TroveManager · PriceFeed · Router / Pools · MUSD Savings Rate · Wormhole NTT (Base, Wave 2)

## Repo layout

```
contracts/   Foundry: the full Ledger protocol (see contracts/README.md)
apps/api/    Hono backend: auth, invoice storage, chain reads, gasless-acceptance relayer, splits
apps/keeper/ Permissionless automation: overdue/default sweep, guardian + paydown sweep
indexer/     Ponder: event indexer / read model for invoices, advances, payments (see indexer/README.md)
docs/        System design and submission kit
```

## Docs

- [System design](docs/SYSTEM_DESIGN.md): architecture, contracts, lifecycle, credit model, tranches, security, testing, build plan
- [Submission kit](docs/SUBMISSION_KIT.md): rubric mapping, form answers, deck, video script, business model, GTM
- [Contracts README](contracts/README.md): setup, testing, deploying

## Status

🏗️ **Backend built and tested ahead of Wave 1** (which opens Oct 16, 2026 on Mezo testnet, chain ID 31611):

- **Contracts:** 13 Solidity contracts, **70/70 tests passing** (unit + fuzz), compiled for Mezo's
  London EVM target, with a broadcastable deploy script (`contracts/script/Deploy.s.sol`).
- **Backend:** `apps/api` and `apps/keeper` both built and type-check clean.
- **Indexer:** `indexer/` (Ponder) is built and its schema/config/handlers passed `ponder codegen`'s
  validation once, but a full clean run couldn't be confirmed in this dev environment (Node v24 vs.
  Ponder's HTTP client — see `indexer/README.md`'s "Verification status" for the honest details and
  what to check before relying on it).
- **Not yet built:** the frontend (`apps/web`) and Wave-2 items (Base payment intake, Telegram bot) —
  see the build plan in [`docs/SYSTEM_DESIGN.md` §19](docs/SYSTEM_DESIGN.md#19-build-plan-wave-1--wave-2-day-by-day).
- **Not yet deployed anywhere** — no testnet addresses exist yet. A handful of Mezo-side details need
  confirming first; see [`docs/SYSTEM_DESIGN.md` §22](docs/SYSTEM_DESIGN.md#22-open-questions-to-resolve-on-day-1).
