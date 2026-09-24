# Ledger — Submission Kit, Business Model & GTM

Companion to [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

---

## 1. Judging Rubric Mapping

| Criterion (weight) | How Ledger scores |
|---|---|
| **Mezo Integration (30%)** | MUSD is the unit of account for invoices, advances, vault shares and settlement. BTC payments open or extend **MUSD positions** via BorrowerOperations (including the signature variants). PriceFeed values BTC. The Router converts. Idle cash goes to the MUSD Savings Rate. The guardian reads TroveManager. |
| **Product & Business Viability (30%)** | Invoice factoring is a large, proven market that cross-border freelancers can't access. Clear revenue (fee spread). Brings **real-economy cash flow** into MUSD and gives MUSD holders real-world yield. Directly answers Track 2's question: "How might we make MUSD easier to discover, access, and use?" |
| **Technical Implementation (20%)** | A modular contract suite, ERC-721 receivables, ERC-4626 tranches, EIP-712 flows, invariant/fuzz/fork tests, a threat model, and a scenario simulator. |
| **User Experience (10%)** | Dollar-first UI; gasless client acceptance; a no-jargon pay page; "Get paid now" in two clicks. |
| **Submission Materials (10%)** | Scripted 2-minute demo, 10-slide deck, pre-filled form (below). |

---

## 2. AKINDO Form — Pre-filled Answers

- **Project name:** Ledger *(working name)*
- **Category:** Invoice financing, payments
- **TL;DR:** Ledger lets freelancers get paid today on invoices due in 60 days, by turning client-accepted invoices into on-chain receivables that a MUSD lender vault advances against.
- **How it works:** Freelancers wait 30–90 days for payment, and traditional factoring is closed to most cross-border workers. On Ledger, a freelancer issues an invoice; the client accepts it on-chain (gasless), which mints a Receivable NFT. The freelancer can take an instant MUSD advance of up to 80% from an ERC-4626 lender vault (senior/junior tranches), priced by the client's on-chain payment score. When the client pays through Ledger's settlement router, in MUSD, BTC, or (Wave 2) USDC on Base, the advance and fee repay the vault first and the remainder is split to the team. BTC payments can be kept as collateral in a MUSD position instead of being sold, and treasury yield pays the debt down automatically while a guardian protects against liquidation. MUSD is the settlement asset, the advance currency, and the lender deposit, so every invoice creates MUSD demand, and MUSD holders get yield backed by real-economy cash flow.
- **Target group:** Freelancers and small agencies (1–20 people) doing cross-border work, especially in India, LATAM, Africa and Southeast Asia; their clients (startups and SMBs); and MUSD holders seeking non-reflexive yield. Mobile-first pay page, desktop dashboard.
- **Tech stack:** Solidity 0.8.24, Foundry, OpenZeppelin 5, Next.js 15, wagmi/viem, RainbowKit, Mezo Passport, Ponder, Supabase, grammY, Wormhole NTT (Wave 2).
- **Track:** Track 2 (primary), Track 1 (lender vault).
- **Chain:** Mezo (testnet → mainnet); Base (payment intake, Wave 2).
- **Project status:** Entirely new.
- **Readiness:** Testnet deployment (Wave 1); capped mainnet (Wave 2 target).
- **Future milestones:**
  1. **Dec 2026:** audit + capped mainnet (100k MUSD vault cap), 25 pilot freelancer–client pairs.
  2. **Q1 2027:** Base USDC payment intake live; Verified-business tier with KYB attestations; accounting exports (QuickBooks/Xero CSV).
  3. **Q2 2027:** Receivable NFTs usable as collateral in external lending markets; agency payroll module.
- **Team:** members, roles, X/LinkedIn.

---

## 3. Deck Outline (10 slides)

1. **Title:** "Ledger: Get paid before your client pays."
2. **Problem:** 30–90 day payment terms; freelancers carry their clients' cash-flow risk; factoring is closed to them.
3. **Market:** the global invoice-factoring market and the size of the cross-border freelancer economy (cite current figures in the deck).
4. **Solution:** a 3-step diagram: Invoice → Accept (NFT) → Advance in MUSD.
5. **Demo screenshots:** create → client accept → advance → payment waterfall.
6. **Why Mezo:** MUSD as real-economy money; Keep-BTC via MUSD positions; real-world yield for MUSD holders.
7. **Architecture:** the contracts diagram with Mezo primitives highlighted.
8. **Risk design:** recourse, tranches, reputation, caps, circuit breaker, with a sim chart of tranche APY vs default rate.
9. **Business model + GTM** (below).
10. **Roadmap, team, and ask.**

---

## 4. 2-Minute Video Script

| Time | Visual | Voiceover |
|---|---|---|
| 0:00–0:12 | Calendar showing "Net 60" | "Priya finished the job today. Her client pays in 60 days. Rent is due next week." |
| 0:12–0:25 | Ledger home | "Ledger turns invoices into on-chain receivables, so freelancers get paid now, in MUSD." |
| 0:25–0:45 | Create invoice → share link | "She creates a 2,000-dollar invoice and sends the link." |
| 0:45–1:00 | Client pay page → Accept (gasless) | "Her client accepts on-chain with one click and no gas. That mints a receivable NFT." |
| 1:00–1:20 | Advance drawer → 1,400 MUSD arrives | "Priya taps 'Get paid now'. The lender vault advances 1,400 MUSD, priced by the client's payment record." |
| 1:20–1:40 | Client pays → waterfall animation → explorer tx | "When the client pays, the router repays the vault and sends the rest to Priya's team, split automatically." |
| 1:40–1:52 | Lend page with tranche APYs | "MUSD holders earn yield from real invoices, not just DeFi loops." |
| 1:52–2:00 | Logo + testnet addresses | "Ledger. Get paid before your client pays. Live on Mezo testnet." |

---

## 5. Business Model

| Stream | Rate | Notes |
|---|---|---|
| Protocol cut of advance fees | 15% of the discount fee | The rest goes to the vault tranches |
| Late-fee share | 20% | |
| Premium workspace (Wave 2+) | $9/month in MUSD | Multi-member agencies, exports, custom branding |
| FX / conversion spread | 0 (pass-through) | Kept at zero to win adoption |

**Unit economics example:** $1M/month advanced at a 1.2%/30d average fee gives $12k/month in fees. The protocol's 15% is **$1.8k/month**, and lenders receive $10.2k/month (≈ 12% APR on deployed capital before losses).

---

## 6. Go-To-Market

1. **Pilot cohort (Wave 2):** 10–25 freelancer–client pairs from the team's network, hackathon communities, and Mezo Discord.
2. **Wedge:** "Send your next invoice through Ledger. Your client pays the same way, and you can get paid today."
3. **Client-side virality:** every pay page is Ledger branding in front of a company, and the public "Good Payer" badge gives clients a reason to keep paying through Ledger.
4. **Communities:** freelancer groups (Telegram/Discord/LinkedIn) in India, LATAM and Africa; Web3 bounty and DAO contributor payouts.
5. **Lender side:** a "Real-invoice yield on MUSD" campaign to Mezo community MUSD holders.
6. **Partners (later):** freelancer marketplaces, EOR/payroll providers, off-ramp providers per region.

---

## 7. Winning Checklist

- [ ] MUSD used as settlement, advance, and vault asset; BTC through MUSD positions
- [ ] Contracts deployed and verified on Mezo testnet; addresses in the README
- [ ] At least one real end-to-end testnet flow (create → accept → advance → pay → settle)
- [ ] Public repo with CI, tests, Slither report
- [ ] 2-minute video (captioned) + 10-slide deck
- [ ] All AKINDO form fields completed (Section 2)
- [ ] Future milestones with dates
- [ ] Active in the Mezo Discord; progress updates posted
- [ ] Wave 2: an explicit "What changed since Wave 1"
- [ ] KYB documents ready for payout
