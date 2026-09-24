import { ponder } from "ponder:registry";
import { advance } from "ponder:schema";

ponder.on("AdvanceEngine:AdvanceFunded", async ({ event, context }) => {
  await context.db
    .insert(advance)
    .values({
      invoiceId: event.args.invoiceId,
      borrower: event.args.borrower,
      payer: event.args.payer,
      principal: event.args.principal,
      fee: event.args.fee,
      recourseMUSD: event.args.recourseMUSD,
      recourseBTC: event.args.recourseBTC,
      fundedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      borrower: event.args.borrower,
      payer: event.args.payer,
      principal: event.args.principal,
      fee: event.args.fee,
      recourseMUSD: event.args.recourseMUSD,
      recourseBTC: event.args.recourseBTC,
      fundedAt: event.block.timestamp,
      closedAt: null,
      defaultedAt: null,
      seniorLoss: 0n,
      juniorLoss: 0n,
    });
});

ponder.on("AdvanceEngine:AdvanceClosed", async ({ event, context }) => {
  await context.db.update(advance, { invoiceId: event.args.invoiceId }).set({ closedAt: event.block.timestamp });
});

ponder.on("AdvanceEngine:AdvanceDefaulted", async ({ event, context }) => {
  await context.db.update(advance, { invoiceId: event.args.invoiceId }).set({
    defaultedAt: event.block.timestamp,
    seniorLoss: event.args.seniorLoss,
    juniorLoss: event.args.juniorLoss,
  });
});

ponder.on("AdvanceEngine:RecoveryApplied", async ({ event, context }) => {
  const row = await context.db.find(advance, { invoiceId: event.args.invoiceId });
  if (!row) return;
  await context.db.update(advance, { invoiceId: event.args.invoiceId }).set({
    seniorLoss: row.seniorLoss > event.args.toSenior ? row.seniorLoss - event.args.toSenior : 0n,
    juniorLoss: row.juniorLoss > event.args.toJunior ? row.juniorLoss - event.args.toJunior : 0n,
  });
});
