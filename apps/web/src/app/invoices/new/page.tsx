"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog, isAddress, zeroAddress } from "viem";
import { LedgerSheet, LedgerSheetHeader, LedgerRow, Button, Input, Label } from "@/components/Ledger";
import { encryptTerms } from "@/lib/crypto";
import { storeInvoiceBlob } from "@/lib/api";
import { useSession } from "@/lib/useSession";
import { requireAddress } from "@/lib/addresses";
import { invoiceRegistryAbi } from "@/lib/abis/invoiceRegistry";
import { parseUnits18 } from "@/lib/format";

export default function NewInvoicePage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { ensureSession } = useSession();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [clientAddress, setClientAddress] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "encrypting" | "signing" | "confirming" | "saving" | "done" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [payLink, setPayLink] = useState<string | null>(null);

  const canSubmit = amount && dueDate && description && (clientAddress === "" || isAddress(clientAddress));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    try {
      await ensureSession();

      setStatus("encrypting");
      const encrypted = await encryptTerms({
        description,
        clientEmail: clientEmail || undefined,
      });

      const amountWei = parseUnits18(amount);
      const dueDateUnix = BigInt(Math.floor(new Date(dueDate).getTime() / 1000));
      const payer = clientAddress && isAddress(clientAddress) ? (clientAddress as `0x${string}`) : zeroAddress;

      setStatus("signing");
      const hash = await writeContractAsync({
        address: requireAddress("invoiceRegistry"),
        abi: invoiceRegistryAbi,
        functionName: "createInvoice",
        args: [payer, encrypted.commitment, amountWei, dueDateUnix],
      });

      setStatus("confirming");
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      const createdLog = receipt.logs
        .map((log) => {
          try {
            return decodeEventLog({ abi: invoiceRegistryAbi, ...log });
          } catch {
            return null;
          }
        })
        .find((decoded) => decoded?.eventName === "InvoiceCreated");

      if (!createdLog || createdLog.eventName !== "InvoiceCreated") {
        throw new Error("Could not find the new invoice id in the transaction receipt.");
      }
      const invoiceId = createdLog.args.id;

      setStatus("saving");
      await storeInvoiceBlob({
        invoiceId,
        payerHint: clientEmail || undefined,
        ciphertext: encrypted.ciphertextB64,
        iv: encrypted.ivB64,
        commitment: encrypted.commitment,
      });

      const link = `${window.location.origin}/pay/${invoiceId.toString()}#k=${encrypted.keyB64Url}`;
      setPayLink(link);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (payLink) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-ink">Invoice created</h1>
        <p className="mt-2 text-ink-soft">Send this link to your client. They can accept it with no gas.</p>
        <LedgerSheet className="mt-6">
          <div className="break-all p-5 font-mono text-sm text-ink">{payLink}</div>
        </LedgerSheet>
        <div className="mt-4 flex gap-3">
          <Button variant="primary" onClick={() => navigator.clipboard.writeText(payLink)}>
            Copy link
          </Button>
          <Button variant="ghost" onClick={() => router.push("/invoices")}>
            Go to invoices
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">New invoice</h1>
      <p className="mt-2 text-ink-soft">
        The description stays encrypted in your browser — only you and whoever holds this pay link can
        read it.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <Label>What&apos;s this for</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Website redesign, milestone 2"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Amount (MUSD)</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="2,000.00"
              inputMode="decimal"
              required
            />
          </div>
          <div>
            <Label>Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
        </div>
        <div>
          <Label>Client wallet address (optional — leave blank for an open link)</Label>
          <Input
            value={clientAddress}
            onChange={(e) => setClientAddress(e.target.value)}
            placeholder="0x…"
          />
        </div>
        <div>
          <Label>Client email (optional, for your own reference only)</Label>
          <Input
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="client@company.com"
          />
        </div>

        {errorMessage && (
          <p className="border border-red/30 bg-red-soft px-4 py-3 text-sm text-red">{errorMessage}</p>
        )}

        <Button type="submit" variant="primary" disabled={!isConnected || !canSubmit || status !== "idle" && status !== "error"}>
          {!isConnected
            ? "Connect a wallet to continue"
            : status === "encrypting"
              ? "Encrypting…"
              : status === "signing"
                ? "Confirm in wallet…"
                : status === "confirming"
                  ? "Waiting for confirmation…"
                  : status === "saving"
                    ? "Saving…"
                    : "Create invoice"}
        </Button>
      </form>
    </div>
  );
}
