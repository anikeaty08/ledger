import { ponder } from "ponder:registry";
import { invoice, statusChange, dispute } from "ponder:schema";

ponder.on("InvoiceRegistry:InvoiceCreated", async ({ event, context }) => {
  await context.db.insert(invoice).values({
    id: event.args.id,
    issuer: event.args.issuer,
    payer: event.args.payer === "0x0000000000000000000000000000000000000000" ? null : event.args.payer,
    commitment: event.args.commitment,
    amount: event.args.amount,
    paid: 0n,
    dueDate: event.args.dueDate,
    status: 1, // Issued
    createdAt: event.block.timestamp,
    createdTxHash: event.transaction.hash,
  });
});

ponder.on("InvoiceRegistry:InvoiceCancelled", async ({ event, context }) => {
  await context.db.update(invoice, { id: event.args.id }).set({ status: 9, closedAt: event.block.timestamp }); // Cancelled
});

ponder.on("InvoiceRegistry:InvoiceAccepted", async ({ event, context }) => {
  await context.db.update(invoice, { id: event.args.id }).set({
    payer: event.args.payer,
    status: 2, // Accepted
    acceptedAt: event.block.timestamp,
  });
});

ponder.on("InvoiceRegistry:InvoiceStatusChanged", async ({ event, context }) => {
  await context.db.update(invoice, { id: event.args.id }).set({ status: event.args.to });

  await context.db.insert(statusChange).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    invoiceId: event.args.id,
    from: event.args.from,
    to: event.args.to,
    blockTimestamp: event.block.timestamp,
  });

  const SETTLED = 7;
  const DEFAULTED = 8;
  if (event.args.to === SETTLED || event.args.to === DEFAULTED) {
    await context.db.update(invoice, { id: event.args.id }).set({ closedAt: event.block.timestamp });
  }
});

ponder.on("InvoiceRegistry:PaymentRecorded", async ({ event, context }) => {
  await context.db.update(invoice, { id: event.args.id }).set({ paid: event.args.totalPaid });
});

ponder.on("InvoiceRegistry:DisputeOpened", async ({ event, context }) => {
  await context.db
    .insert(dispute)
    .values({
      invoiceId: event.args.id,
      openedBy: event.args.by,
      reasonHash: event.args.reasonHash,
      openedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      openedBy: event.args.by,
      reasonHash: event.args.reasonHash,
      openedAt: event.block.timestamp,
      resolvedAt: null,
      payerAtFault: null,
    });
});
