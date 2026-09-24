import { z } from "zod";

export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((s) => s.toLowerCase() as `0x${string}`);

export const HexSchema = z.string().regex(/^0x[a-fA-F0-9]+$/) as unknown as z.ZodType<`0x${string}`>;

export const Bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/) as unknown as z.ZodType<`0x${string}`>;

export const InvoiceIdSchema = z.coerce.bigint().nonnegative();

/** Non-negative integer amount encoded as a decimal string (MUSD, 1e18 base units). */
export const AmountSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .transform((s) => BigInt(s));
