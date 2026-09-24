import { onchainTable, index } from "ponder";

/**
 * Mirrors the money-relevant on-chain state (see contracts/src/libraries/Types.sol InvoiceStatus and
 * contracts/src/credit/AdvanceEngine.sol Advance for the authoritative shapes). This is a READ MODEL:
 * the chain is always the source of truth, and the API's own state-changing decisions re-read the
 * chain directly rather than trusting these tables (see apps/api/src/routes/chain.ts).
 */

// InvoiceStatus enum ordinals, kept in sync with src/libraries/Types.sol:
// 0 None, 1 Issued, 2 Accepted, 3 Financed, 4 PartiallyPaid, 5 Overdue, 6 Disputed, 7 Settled,
// 8 Defaulted, 9 Cancelled.
export const invoice = onchainTable(
  "invoice",
  (t) => ({
    id: t.bigint().primaryKey(), // on-chain invoiceId
    issuer: t.hex().notNull(),
    payer: t.hex(),
    commitment: t.hex().notNull(),
    amount: t.bigint().notNull(),
    paid: t.bigint().notNull().default(0n),
    dueDate: t.bigint().notNull(),
    status: t.integer().notNull(),
    createdAt: t.bigint().notNull(), // block timestamp of InvoiceCreated
    acceptedAt: t.bigint(),
    closedAt: t.bigint(),
    createdTxHash: t.hex().notNull(),
  }),
  (table) => ({
    issuerIdx: index().on(table.issuer),
    payerIdx: index().on(table.payer),
    statusIdx: index().on(table.status),
  }),
);

export const advance = onchainTable("advance", (t) => ({
  invoiceId: t.bigint().primaryKey(),
  borrower: t.hex().notNull(),
  payer: t.hex().notNull(),
  principal: t.bigint().notNull(),
  fee: t.bigint().notNull(),
  recourseMUSD: t.bigint().notNull(),
  recourseBTC: t.bigint().notNull(),
  fundedAt: t.bigint().notNull(),
  closedAt: t.bigint(),
  defaultedAt: t.bigint(),
  seniorLoss: t.bigint().notNull().default(0n),
  juniorLoss: t.bigint().notNull().default(0n),
}));

export const payment = onchainTable(
  "payment",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    invoiceId: t.bigint().notNull(),
    from: t.hex().notNull(),
    inBTC: t.boolean().notNull(),
    btcAmount: t.bigint().notNull(),
    credited: t.bigint().notNull(),
    toVaults: t.bigint().notNull(),
    remainder: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    invoiceIdx: index().on(table.invoiceId),
  }),
);

export const statusChange = onchainTable(
  "status_change",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    invoiceId: t.bigint().notNull(),
    from: t.integer().notNull(),
    to: t.integer().notNull(),
    blockTimestamp: t.bigint().notNull(),
  }),
  (table) => ({
    invoiceIdx: index().on(table.invoiceId),
  }),
);

export const dispute = onchainTable("dispute", (t) => ({
  invoiceId: t.bigint().primaryKey(),
  openedBy: t.hex().notNull(),
  reasonHash: t.hex().notNull(),
  openedAt: t.bigint().notNull(),
  resolvedAt: t.bigint(),
  payerAtFault: t.boolean(),
}));

export const ledgerAccount = onchainTable(
  "ledger_account",
  (t) => ({
    address: t.hex().primaryKey(),
    owner: t.hex().notNull(),
    createdAt: t.bigint().notNull(),
  }),
  (table) => ({
    ownerIdx: index().on(table.owner),
  }),
);

// No formal relations() are declared: `payment` and `status_change` are already indexed on
// `invoiceId` above, which is enough for callers to filter/join them against `invoice` without the
// added complexity of Ponder's relational API.
