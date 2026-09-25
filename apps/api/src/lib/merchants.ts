import type { Address } from "viem";
import { db } from "../db/pool.js";

/** invoice_blobs and splits reference merchants(address). A signed-in wallet gets a bare merchant row the
 *  first time it writes one of those; POST /merchants fills in the profile later. */
export async function ensureMerchant(address: Address): Promise<void> {
  await db
    .insertInto("merchants")
    .values({ address: address.toLowerCase(), display_name: null, email: null, telegram_handle: null, created_at: new Date() })
    .onConflict((oc) => oc.column("address").doNothing())
    .execute();
}
