import { ponder } from "ponder:registry";
import { payment } from "ponder:schema";

ponder.on("SettlementRouter:InvoicePaid", async ({ event, context }) => {
  await context.db.insert(payment).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    invoiceId: event.args.invoiceId,
    from: event.args.from,
    inBTC: event.args.inBTC,
    btcAmount: event.args.btcAmount,
    credited: event.args.credited,
    toVaults: event.args.toVaults,
    remainder: event.args.remainder,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});
