const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ── Auth ──

export function createChallenge(address: `0x${string}`) {
  return request<{ challengeId: string; message: string; expiresAt: string }>("/auth/challenges", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export function createSession(challengeId: string, signature: `0x${string}`) {
  return request<{ address: `0x${string}` }>("/auth/sessions", {
    method: "POST",
    body: JSON.stringify({ challengeId, signature }),
  });
}

export function getSession() {
  return request<{ address: `0x${string}` | null }>("/auth/session");
}

export function logout() {
  return request<void>("/auth/session", { method: "DELETE" });
}

// ── Invoices ──

export function storeInvoiceBlob(input: {
  invoiceId: bigint;
  payerHint?: string;
  ciphertext: string;
  iv: string;
  commitment: `0x${string}`;
}) {
  return request<{ ok: boolean; invoiceId: string }>("/invoices", {
    method: "POST",
    body: JSON.stringify({ ...input, invoiceId: input.invoiceId.toString() }),
  });
}

export interface InvoiceBlobResponse {
  invoiceId: string;
  ciphertext: string | null;
  iv: string | null;
  commitment: `0x${string}` | null;
  chain: {
    invoiceId: string;
    issuer: `0x${string}`;
    payer: `0x${string}` | null;
    amount: string;
    paid: string;
    dueDate: string;
    status: number;
    financed: boolean;
    txHash: string | null;
    updatedAt: string;
  } | null;
}

export function getInvoiceBlob(invoiceId: bigint | string) {
  return request<InvoiceBlobResponse>(`/invoices/${invoiceId}`);
}

export function listMyInvoices(status?: number) {
  const q = status !== undefined ? `?status=${status}` : "";
  return request<InvoiceBlobResponse["chain"][]>(`/invoices${q}`);
}

// ── Relay (gasless acceptance) ──

export function relayAcceptInvoice(input: {
  invoiceId: bigint;
  payer: `0x${string}`;
  deadline: bigint;
  signature: `0x${string}`;
}) {
  return request<{ txHash: `0x${string}` }>("/relay/accept-invoice", {
    method: "POST",
    body: JSON.stringify({
      invoiceId: input.invoiceId.toString(),
      payer: input.payer,
      deadline: input.deadline.toString(),
      signature: input.signature,
    }),
  });
}

// ── Splits ──

export function createSplit(input: { label?: string; recipients: { address: `0x${string}`; bps: number }[] }) {
  return request<{ splitId: `0x${string}`; recipients: typeof input.recipients }>("/splits", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listMySplits() {
  return request<{ splitId: `0x${string}`; label: string | null; splitterAddress: `0x${string}` | null }[]>(
    "/splits",
  );
}

// ── Merchant ──

export function upsertMerchant(input: { displayName?: string; email?: string; telegramHandle?: string }) {
  return request("/merchants", { method: "POST", body: JSON.stringify(input) });
}
