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

## Docs

- [System design](docs/SYSTEM_DESIGN.md): architecture, contracts, lifecycle, credit model, tranches, security, testing, build plan
- [Submission kit](docs/SUBMISSION_KIT.md): rubric mapping, form answers, deck, video script, business model, GTM

## Status

🚧 Design phase. The Wave 1 build starts Oct 16, 2026 on Mezo testnet (chain ID 31611).
