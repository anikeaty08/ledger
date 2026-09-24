# Ledger contracts

Foundry project for the Ledger protocol. See [`../docs/SYSTEM_DESIGN.md`](../docs/SYSTEM_DESIGN.md) for
the full architecture, contract design, credit model, and security notes.

## Setup

```bash
forge install   # pulls forge-std and openzeppelin-contracts (already vendored as submodules)
forge build
forge test
```

Solidity 0.8.24, compiled with `evm_version = "london"` to match Mezo's chain (no `PUSH0`). See
`foundry.toml`.

## Test suite

70 tests across `test/unit/*.t.sol` (invoice lifecycle, advances, BTC settlement / Keep-BTC, tranche
vaults, the LedgerAccount treasury + guardian, collections/defaults/disputes), including a fuzz test
over advance amount/tenor/percentage combinations. All mocks in `test/mocks/Mocks.sol` reproduce Mezo's
real MUSD CDP semantics (110% MCR, fixed simple interest, 0.1% borrowing fee, $200 gas compensation,
1,800 MUSD minimum net debt) and the tigris Router's `Route`-based swap interface, so the tests exercise
the same shapes AdvanceEngine/SettlementRouter will hit on real Mezo contracts.

```bash
forge test              # all tests
forge test -vvv         # with traces on failure
forge test --match-path 'test/unit/AdvanceFlow.t.sol'
forge coverage          # line coverage report
```

## Deploying

1. Copy `.env.example` to `.env` and fill in the Mezo addresses (see
   [`docs/SYSTEM_DESIGN.md` §22 "Open Questions"](../docs/SYSTEM_DESIGN.md#22-open-questions-to-resolve-on-day-1)
   for what to confirm with the Mezo team first — in particular whether `BorrowerOperationsSignatures`
   and a testnet BTC/MUSD pool are live, since `LedgerAccount` and `BTCSwapper` depend on them).
2. Run:

```bash
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url mezo_testnet --broadcast --slow \
  --private-key $DEPLOYER_PRIVATE_KEY
```

This deploys and wires the full suite (see `script/LedgerDeployer.sol` for the exact wiring: which
contract gets registered as a module on which, vault↔engine links, etc.) and writes the resulting
addresses to `deployments/<chainId>.json`. Copy those into `apps/api/.env` and `apps/keeper/.env`.

## Layout

```
src/
├── invoices/     InvoiceRegistry, ReceivableNFT
├── credit/       AdvanceEngine, CreditPolicy, ReputationRegistry, CollectionsManager
├── vaults/       TrancheVault (deployed twice: senior + junior)
├── settlement/   SettlementRouter, BTCSwapper, Splitter, SplitterFactory
├── accounts/     LedgerAccount, LedgerAccountFactory
├── interfaces/   IMezo (external Mezo contracts), ILedger (internal module interfaces)
└── libraries/    Types.sol (Invoice struct, InvoiceStatus, LedgerMath)
```
