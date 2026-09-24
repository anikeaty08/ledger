import { ponder } from "ponder:registry";
import { dispute } from "ponder:schema";

ponder.on("CollectionsManager:DisputeResolved", async ({ event, context }) => {
  await context.db.update(dispute, { invoiceId: event.args.invoiceId }).set({
    resolvedAt: event.block.timestamp,
    payerAtFault: event.args.payerAtFault,
  });
});
