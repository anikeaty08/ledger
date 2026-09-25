"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog, isAddress, zeroAddress } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LedgerSheet, LedgerSheetHeader, Button, Input, Label, Notice } from "@/components/Ledger";
import { Icon } from "@/components/Icon";
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

  const [addressTouched, setAddressTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const addressInvalid = clientAddress !== "" && !isAddress(clientAddress);
  const showAddressError = addressInvalid && addressTouched;
  const busy = status !== "idle" && status !== "error";
  const today = new Date().toISOString().slice(0, 10);

  async function handleCopy() {
    if (!payLink) return;
    await navigator.clipboard.writeText(payLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (addressInvalid) {
      setAddressTouched(true);
      document.getElementById("inv-client-address")?.focus();
      return;
    }
    if (parseUnits18(amount) === 0n) {
      setErrorMessage("Enter an amount above zero.");
      document.getElementById("inv-amount")?.focus();
      return;
    }
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
      setErrorMessage(
        err instanceof Error
          ? `${err.message} Your details are still filled in, so you can try again.`
          : "The invoice wasn't created. Your details are still filled in, so you can try again.",
      );
    }
  }

  if (payLink) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-ink">Invoice created</h1>
        <p className="mt-2 text-ink-soft">
          Send this link to your client. Accepting it costs them no gas, and once they accept you can take an
          advance from your invoices page.
        </p>
        <LedgerSheet className="mt-6">
          <LedgerSheetHeader>
            <span className="text-[13px] text-ink-soft">Pay link</span>
            <span className="flex items-center gap-1.5 text-[13px] text-ink-soft">
              <Icon name="lock" size={16} />
              Holds the decryption key
            </span>
          </LedgerSheetHeader>
          <div className="break-all p-5 font-mono text-sm text-ink">{payLink}</div>
        </LedgerSheet>
        <p className="mt-3 text-sm text-ink-soft">
          Anyone with this link can read the invoice description. Send it only to your client.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="primary" onClick={handleCopy}>
            {copied && <Icon name="check" size={16} />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/invoices")}>
            Go to invoices
          </Button>
        </div>
        <span className="sr-only" role="status">
          {copied ? "Link copied to clipboard" : ""}
        </span>
      </div>
    );
  }


  const progress: Record<typeof status, string> = {
    idle: "Create invoice",
    error: "Create invoice",
    done: "Create invoice",
    encrypting: "Encrypting details…",
    signing: "Confirm in your wallet…",
    confirming: "Waiting for the network…",
    saving: "Saving encrypted details…",
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">New invoice</h1>
      <p className="mt-2 flex items-start gap-2 text-ink-soft">
        <Icon name="lock" size={16} className="mt-1" />
        <span>
          The description is encrypted in your browser. Only you and whoever holds the pay link can read it.
        </span>
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <Label htmlFor="inv-description">What&apos;s this for</Label>
          <Input
            id="inv-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Website redesign, milestone 2"
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="inv-amount">Amount (MUSD)</Label>
            <Input
              id="inv-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
              placeholder="2,000.00"
              inputMode="decimal"
              required
            />
          </div>
          <div>
            <Label htmlFor="inv-due">Due date</Label>
            <Input id="inv-due" type="date" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </div>
        </div>
        <div>
          <Label htmlFor="inv-client-address">Client wallet address (optional)</Label>
          <Input
            id="inv-client-address"
            value={clientAddress}
            onChange={(e) => setClientAddress(e.target.value.trim())}
            onBlur={() => setAddressTouched(true)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={showAddressError}
            aria-describedby="inv-client-address-hint"
            className="font-mono"
          />
          <p id="inv-client-address-hint" className={`mt-1.5 text-[13px] ${showAddressError ? "text-red" : "text-ink-soft"}`}>
            {showAddressError
              ? "This isn't a valid wallet address. It should start with 0x and be 42 characters long."
              : "Leave blank to let whoever opens the link accept it."}
          </p>
        </div>
        <div>
          <Label htmlFor="inv-client-email">Client email (optional)</Label>
          <Input
            id="inv-client-email"
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="client@company.com"
            aria-describedby="inv-client-email-hint"
          />
          <p id="inv-client-email-hint" className="mt-1.5 text-[13px] text-ink-soft">
            For your own reference, to tell invoices apart. It&apos;s stored with this invoice.
          </p>
        </div>

        {errorMessage && <Notice>{errorMessage}</Notice>}

        {isConnected ? (
          <Button type="submit" variant="primary" disabled={busy}>
            {progress[status]}
          </Button>
        ) : (
          <div>
            <p className="mb-3 text-sm text-ink-soft">Connect the wallet that should receive payment.</p>
            <ConnectButton />
          </div>
        )}
        <span className="sr-only" role="status">
          {busy ? progress[status] : ""}
        </span>
      </form>
    </div>
  );
}
