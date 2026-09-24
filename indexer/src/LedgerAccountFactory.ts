import { ponder } from "ponder:registry";
import { ledgerAccount } from "ponder:schema";

ponder.on("LedgerAccountFactory:AccountCreated", async ({ event, context }) => {
  await context.db.insert(ledgerAccount).values({
    address: event.args.account,
    owner: event.args.user,
    createdAt: event.block.timestamp,
  });
});
