/**
 * End-to-end smoke test for every API endpoint against a running API, its Postgres, and the deployed
 * contracts. Creates one real invoice on-chain and accepts it through the relayer.
 *
 *   ISSUER_KEY=0x… PAYER_KEY=0x… npx tsx scripts/smoke.ts
 *
 * ISSUER_KEY needs a little testnet BTC for one createInvoice tx; PAYER_KEY only signs (no gas).
 */
import "dotenv/config";
import { webcrypto } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  hashTypedData,
  http,
  keccak256,
  nonceManager,
  parseAbi,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sendTx, waitForReceipt } from "./tx.js";

const API = process.env.API_URL ?? "http://localhost:8787";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const RPC = process.env.RPC_URL ?? "https://rpc.test.mezo.org";
const REGISTRY = process.env.INVOICE_REGISTRY_ADDRESS as Hex;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31611);

const issuer = privateKeyToAccount(process.env.ISSUER_KEY as Hex, { nonceManager });
const payer = privateKeyToAccount(process.env.PAYER_KEY as Hex, { nonceManager });
const chain = {
  id: CHAIN_ID,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
const issuerWallet = createWalletClient({ account: issuer, chain, transport: http(RPC) });

const registryAbi = parseAbi([
  "function createInvoice(address payer, bytes32 commitment, uint128 amount, uint64 dueDate) returns (uint256)",
  "event InvoiceCreated(uint256 indexed id, address indexed issuer, address indexed payer, uint256 amount, uint64 dueDate, bytes32 commitment)",
]);

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  -> ${detail}` : ""}`);
}

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; raw?: boolean } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

async function signIn(account: typeof issuer): Promise<string> {
  const ch = await call("POST", "/api/v1/auth/challenges", { body: { address: account.address } });
  const signature = await account.signMessage({ message: ch.json.message });
  const s = await call("POST", "/api/v1/auth/sessions", { body: { challengeId: ch.json.challengeId, signature } });
  const setCookie = s.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0]!;
}

/** Same scheme as apps/web/src/lib/crypto.ts: AES-GCM, commitment = keccak256(ciphertext). */
async function encryptTerms(terms: object) {
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(terms))),
  );
  return {
    key,
    ciphertext: Buffer.from(ct).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    commitment: keccak256(toHex(ct)),
  };
}

async function main() {
  console.log(`API ${API}  issuer ${issuer.address}  payer ${payer.address}\n`);

  // ── Health, CORS, chain reads ──
  const health = await call("GET", "/health");
  check("GET /health", health.status === 200 && health.json?.ok === true, health.text);

  const pre = await fetch(`${API}/api/v1/auth/session`, {
    method: "OPTIONS",
    headers: { origin: ORIGIN, "access-control-request-method": "POST" },
  });
  check(
    "CORS preflight allows the web origin with credentials",
    pre.headers.get("access-control-allow-origin") === ORIGIN && pre.headers.get("access-control-allow-credentials") === "true",
    `${pre.status} ${pre.headers.get("access-control-allow-origin")}`,
  );

  const status = await call("GET", "/api/v1/chain/status");
  check("GET /chain/status", status.status === 200 && status.json?.chainId === CHAIN_ID, status.text);

  const contracts = await call("GET", "/api/v1/chain/contracts");
  check(
    "GET /chain/contracts returns all 13 addresses",
    contracts.status === 200 && Object.values(contracts.json ?? {}).filter(Boolean).length === 13,
    contracts.text,
  );

  // ── Auth ──
  const badAddr = await call("POST", "/api/v1/auth/challenges", { body: { address: "nope" } });
  check("POST /auth/challenges rejects a bad address (400)", badAddr.status === 400, badAddr.text);

  const ch = await call("POST", "/api/v1/auth/challenges", { body: { address: issuer.address } });
  check(
    "POST /auth/challenges returns an origin-bound message",
    ch.status === 200 && typeof ch.json?.message === "string" && ch.json.message.includes(`Origin: ${ORIGIN}`),
    ch.text,
  );

  const wrongSig = await payer.signMessage({ message: ch.json.message });
  const badSession = await call("POST", "/api/v1/auth/sessions", { body: { challengeId: ch.json.challengeId, signature: wrongSig } });
  check("POST /auth/sessions rejects a signature from the wrong wallet (401)", badSession.status === 401, badSession.text);

  const goodSig = await issuer.signMessage({ message: ch.json.message });
  const session = await call("POST", "/api/v1/auth/sessions", { body: { challengeId: ch.json.challengeId, signature: goodSig } });
  const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0]!;
  check(
    "POST /auth/sessions opens a session and sets an httpOnly cookie",
    session.status === 200 &&
      session.json?.address === issuer.address.toLowerCase() &&
      /HttpOnly/i.test(session.headers.get("set-cookie") ?? ""),
    session.text,
  );

  const replay = await call("POST", "/api/v1/auth/sessions", { body: { challengeId: ch.json.challengeId, signature: goodSig } });
  check("POST /auth/sessions refuses to reuse a challenge (401)", replay.status === 401, replay.text);

  const me = await call("GET", "/api/v1/auth/session", { cookie });
  check("GET /auth/session with cookie returns the address", me.json?.address === issuer.address.toLowerCase(), me.text);
  const anon = await call("GET", "/api/v1/auth/session");
  check("GET /auth/session without cookie returns null", anon.status === 200 && anon.json?.address === null, anon.text);

  // ── Invoice: create on-chain, then store encrypted terms ──
  const unauth = await call("POST", "/api/v1/invoices", { body: {} });
  check("POST /invoices without a session is 401", unauth.status === 401, unauth.text);

  const terms = { description: "Smoke test: website redesign, milestone 2" };
  const enc = await encryptTerms(terms);
  const amount = 2_000n * 10n ** 18n;
  const dueDate = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
  const receipt = await sendTx(pub as never, issuerWallet as never, {
    address: REGISTRY,
    abi: registryAbi,
    functionName: "createInvoice",
    args: [zeroAddress, enc.commitment, amount, dueDate],
  });
  const hash = receipt.transactionHash;
  const created = receipt.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: registryAbi, ...l });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "InvoiceCreated");
  const invoiceId = created && created.eventName === "InvoiceCreated" ? created.args.id : 0n;
  check("on-chain createInvoice emits InvoiceCreated", receipt.status === "success" && invoiceId > 0n, hash);
  console.log(`      invoice #${invoiceId}  tx ${hash}`);

  const badCommit = await call("POST", "/api/v1/invoices", {
    cookie,
    body: { invoiceId: invoiceId.toString(), ciphertext: enc.ciphertext, iv: enc.iv, commitment: `0x${"11".repeat(32)}` },
  });
  check("POST /invoices rejects a commitment that doesn't match the ciphertext (400)", badCommit.status === 400, badCommit.text);

  const other = await encryptTerms({ description: "tampered" });
  const offChain = await call("POST", "/api/v1/invoices", {
    cookie,
    body: { invoiceId: invoiceId.toString(), ciphertext: other.ciphertext, iv: other.iv, commitment: other.commitment },
  });
  check("POST /invoices rejects terms whose commitment isn't the on-chain one (400)", offChain.status === 400, offChain.text);

  const payerCookie = await signIn(payer);
  const hijack = await call("POST", "/api/v1/invoices", {
    cookie: payerCookie,
    body: { invoiceId: invoiceId.toString(), ciphertext: enc.ciphertext, iv: enc.iv, commitment: enc.commitment },
  });
  check("POST /invoices refuses a wallet that isn't the issuer (403)", hijack.status === 403, hijack.text);

  const store = await call("POST", "/api/v1/invoices", {
    cookie,
    body: { invoiceId: invoiceId.toString(), payerHint: "client@example.com", ciphertext: enc.ciphertext, iv: enc.iv, commitment: enc.commitment },
  });
  check("POST /invoices stores terms for a new user (no merchant profile yet)", store.status === 201, `${store.status} ${store.text}`);

  const blob = await call("GET", `/api/v1/invoices/${invoiceId}`);
  let roundTrip = false;
  if (blob.json?.ciphertext) {
    const pt = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(blob.json.iv, "base64") },
      enc.key,
      Buffer.from(blob.json.ciphertext, "base64"),
    );
    roundTrip = JSON.parse(new TextDecoder().decode(pt)).description === terms.description;
  }
  check("GET /invoices/:id is public and the stored terms decrypt with the link key", blob.status === 200 && roundTrip, blob.text);

  const badId = await call("GET", "/api/v1/invoices/abc");
  check("GET /invoices/abc is 400", badId.status === 400, badId.text);
  const missing = await call("GET", "/api/v1/invoices/99999999");
  check("GET /invoices/99999999 is 404", missing.status === 404, missing.text);

  const list = await call("GET", "/api/v1/invoices", { cookie });
  check(
    "GET /invoices lists the new invoice as Issued",
    list.status === 200 && list.json?.some((r: any) => r.invoiceId === invoiceId.toString() && r.status === 1),
    list.text,
  );
  const listAnon = await call("GET", "/api/v1/invoices");
  check("GET /invoices without a session is 401", listAnon.status === 401, listAnon.text);

  const rec = await call("POST", `/api/v1/invoices/${invoiceId}/reconcile`, { cookie, body: {} });
  check("POST /invoices/:id/reconcile re-reads the chain", rec.status === 200 && rec.json?.status === 1, rec.text);
  const recMissing = await call("POST", "/api/v1/invoices/99999999/reconcile", { cookie, body: {} });
  check("POST /invoices/:id/reconcile for a nonexistent invoice is 404", recMissing.status === 404, recMissing.text);

  // ── Merchant profile ──
  const badMerchant = await call("POST", "/api/v1/merchants", { cookie, body: { email: "not-an-email" } });
  check("POST /merchants rejects an invalid email (400)", badMerchant.status === 400, badMerchant.text);
  const merchant = await call("POST", "/api/v1/merchants", { cookie, body: { displayName: "Smoke Test Studio", email: "studio@example.com" } });
  check("POST /merchants upserts the profile", merchant.status === 200 && merchant.json?.display_name === "Smoke Test Studio", merchant.text);

  // ── Chain views for the new invoice ──
  const onchain = await call("GET", `/api/v1/chain/invoices/${invoiceId}`);
  check(
    "GET /chain/invoices/:id reads status Issued and the full amount owed",
    onchain.status === 200 && Number(onchain.json?.invoice?.status) === 1 && onchain.json?.amountOwed === amount.toString(),
    onchain.text,
  );
  const quote = await call("GET", `/api/v1/chain/invoices/${invoiceId}/quote`);
  check("GET /chain/invoices/:id/quote returns a quote", quote.status === 200 && quote.json?.quote !== undefined, quote.text);
  const preview = await call("GET", `/api/v1/chain/invoices/${invoiceId}/preview-payment?amount=${10n ** 18n}`);
  check("GET /chain/invoices/:id/preview-payment returns the split", preview.status === 200 && preview.json?.used !== undefined, preview.text);
  const previewBad = await call("GET", `/api/v1/chain/invoices/${invoiceId}/preview-payment?amount=abc`);
  check("GET /chain/invoices/:id/preview-payment rejects a bad amount (400)", previewBad.status === 400, previewBad.text);

  // ── Gasless acceptance through the relayer ──
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const typed = {
    domain: { name: "Ledger", version: "1", chainId: CHAIN_ID, verifyingContract: REGISTRY },
    types: {
      InvoiceAcceptance: [
        { name: "invoiceId", type: "uint256" },
        { name: "commitment", type: "bytes32" },
        { name: "amount", type: "uint256" },
        { name: "dueDate", type: "uint64" },
        { name: "payer", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "InvoiceAcceptance",
    message: { invoiceId, commitment: enc.commitment, amount, dueDate, payer: payer.address, deadline },
  } as const;

  const digest = await call("POST", "/api/v1/relay/acceptance-digest", {
    body: { invoiceId: invoiceId.toString(), payer: payer.address, deadline: deadline.toString() },
  });
  check(
    "POST /relay/acceptance-digest matches the frontend's EIP-712 hash",
    digest.status === 200 && digest.json?.digest?.toLowerCase() === hashTypedData(typed).toLowerCase(),
    digest.text,
  );

  const signature = await payer.signTypedData(typed);
  const accept = await call("POST", "/api/v1/relay/accept-invoice", {
    body: { invoiceId: invoiceId.toString(), payer: payer.address, deadline: deadline.toString(), signature },
  });
  let acceptedOnChain = false;
  if (accept.json?.txHash) {
    const r = await waitForReceipt(pub as never, accept.json.txHash);
    const after = await call("GET", `/api/v1/chain/invoices/${invoiceId}`);
    acceptedOnChain = r.status === "success" && Number(after.json?.invoice?.status) === 2;
  }
  check("POST /relay/accept-invoice relays the signature and the invoice becomes Accepted", accept.status === 200 && acceptedOnChain, accept.text);
  const recAfter = await call("POST", `/api/v1/invoices/${invoiceId}/reconcile`, { cookie, body: { txHash: accept.json?.txHash } });
  check("reconcile after acceptance moves the cached status to Accepted", recAfter.json?.status === 2 && !!recAfter.json?.payer, recAfter.text);

  const again = await call("POST", "/api/v1/relay/accept-invoice", {
    body: { invoiceId: invoiceId.toString(), payer: payer.address, deadline: deadline.toString(), signature },
  });
  check("POST /relay/accept-invoice refuses a second acceptance with the contract's reason", again.status === 400 && again.json?.error === "BadStatus", `${again.status} ${again.text.slice(0, 160)}`);

  const ghost = await call("POST", "/api/v1/relay/accept-invoice", {
    body: { invoiceId: "99999999", payer: payer.address, deadline: deadline.toString(), signature },
  });
  check("POST /relay/accept-invoice for a nonexistent invoice is 404", ghost.status === 404, `${ghost.status} ${ghost.text.slice(0, 160)}`);

  // ── Splits ──
  const badSplit = await call("POST", "/api/v1/splits", {
    cookie: payerCookie,
    body: { recipients: [{ address: issuer.address, bps: 6000 }] },
  });
  check("POST /splits rejects recipients that don't sum to 100% (400)", badSplit.status === 400, badSplit.text);
  const split = await call("POST", "/api/v1/splits", {
    cookie,
    body: { label: "Studio split", recipients: [{ address: issuer.address, bps: 7000 }, { address: payer.address, bps: 3000 }] },
  });
  check("POST /splits saves a split", split.status === 201 && /^0x[0-9a-f]{64}$/.test(split.json?.splitId ?? ""), `${split.status} ${split.text}`);
  const splits = await call("GET", "/api/v1/splits", { cookie });
  check("GET /splits lists it", splits.status === 200 && splits.json?.some((s: any) => s.splitId === split.json?.splitId), splits.text);
  const freshSplit = await call("POST", "/api/v1/splits", {
    cookie: payerCookie,
    body: { recipients: [{ address: payer.address, bps: 10000 }] },
  });
  check("POST /splits works for a user with no merchant profile", freshSplit.status === 201, `${freshSplit.status} ${freshSplit.text}`);

  // ── Checkout sessions ──
  const co = await call("POST", "/api/v1/checkout-sessions", { cookie, body: { invoiceId: invoiceId.toString(), returnUrl: "https://example.com/thanks" } });
  check("POST /checkout-sessions creates a session", co.status === 201 && typeof co.json?.id === "string", co.text);
  const coGet = await call("GET", `/api/v1/checkout-sessions/${co.json?.id}`);
  check("GET /checkout-sessions/:id is public and pending", coGet.status === 200 && coGet.json?.status === "pending", coGet.text);
  const coBad = await call("POST", `/api/v1/checkout-sessions/${co.json?.id}/reconcile`, { body: { txHash: "0x1234" } });
  check("POST /checkout-sessions/:id/reconcile rejects a malformed tx hash (400)", coBad.status === 400, coBad.text);
  const coRec = await call("POST", `/api/v1/checkout-sessions/${co.json?.id}/reconcile`, { body: { txHash: `0x${"ab".repeat(32)}` } });
  check("POST /checkout-sessions/:id/reconcile records the claim as verifying", coRec.status === 200 && coRec.json?.status === "verifying", coRec.text);
  const coMissing = await call("GET", "/api/v1/checkout-sessions/does-not-exist");
  check("GET /checkout-sessions/unknown is 404", coMissing.status === 404, coMissing.text);

  // ── Sign out ──
  const out = await call("DELETE", "/api/v1/auth/session", { cookie });
  const afterOut = await call("GET", "/api/v1/auth/session", { cookie });
  check("DELETE /auth/session revokes the session", out.status === 204 && afterOut.json?.address === null, afterOut.text);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
