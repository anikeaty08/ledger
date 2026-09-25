/**
 * End-to-end payment test: create → accept (gasless, via the API relayer) → partial pay → pay the rest,
 * using the same contract calls as apps/web/src/app/pay/[id]/page.tsx (approve MUSD to the
 * SettlementRouter, then pay(invoiceId, amount)).
 *
 *   ISSUER_KEY=0x… PAYER_KEY=0x… npx tsx scripts/payment.ts
 *
 * ISSUER_KEY needs a little BTC for gas; PAYER_KEY needs gas plus at least 100 MUSD.
 */
import "dotenv/config";
import { webcrypto } from "node:crypto";
import { createPublicClient, createWalletClient, decodeEventLog, http, keccak256, parseAbi, toHex, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = process.env.API_URL ?? "http://localhost:8787";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const RPC = process.env.RPC_URL ?? "https://rpc.test.mezo.org";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31611);
const REGISTRY = process.env.INVOICE_REGISTRY_ADDRESS as Hex;
const ROUTER = process.env.SETTLEMENT_ROUTER_ADDRESS as Hex;
const REPUTATION = process.env.REPUTATION_REGISTRY_ADDRESS as Hex;
const MUSD = process.env.MUSD_ADDRESS as Hex;

const issuer = privateKeyToAccount(process.env.ISSUER_KEY as Hex);
const payer = privateKeyToAccount(process.env.PAYER_KEY as Hex);
const chain = { id: CHAIN_ID, name: "Mezo Testnet", nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
const issuerWallet = createWalletClient({ account: issuer, chain, transport: http(RPC) });
const payerWallet = createWalletClient({ account: payer, chain, transport: http(RPC) });

const registryAbi = parseAbi([
  "function createInvoice(address payer, bytes32 commitment, uint128 amount, uint64 dueDate) returns (uint256)",
  "function amountOwed(uint256 id) view returns (uint256)",
  "event InvoiceCreated(uint256 indexed id, address indexed issuer, address indexed payer, uint256 amount, uint64 dueDate, bytes32 commitment)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const routerAbi = parseAbi(["function pay(uint256 invoiceId, uint256 amount) returns (uint256)"]);
const reputationAbi = parseAbi([
  "function payers(address) view returns (uint32 settled, uint32 onTime, uint32 late, uint32 defaults, uint32 distinctIssuers, uint128 volume, uint64 lastUpdate)",
  "function clientScore(address) view returns (uint256)",
]);

const STATUS = { Issued: 1, Accepted: 2, PartiallyPaid: 4, Settled: 7 } as const;
const E18 = 10n ** 18n;
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -> ${detail}` : ""}`);
}
const fmt = (v: bigint) => `${v / E18}.${((v % E18) / 10n ** 16n).toString().padStart(2, "0")}`;

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, text };
}

async function signIn(account: typeof issuer) {
  const ch = await call("POST", "/api/v1/auth/challenges", { body: { address: account.address } });
  const signature = await account.signMessage({ message: ch.json.message });
  const res = await fetch(`${API}/api/v1/auth/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ challengeId: ch.json.challengeId, signature }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

const musdOf = (a: Hex) => pub.readContract({ address: MUSD, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const owedOf = (id: bigint) => pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "amountOwed", args: [id] });

/** Mirrors handlePayMUSD in the Pay page: top up allowance if needed, then SettlementRouter.pay. */
async function payLikeTheFrontend(invoiceId: bigint, amount: bigint) {
  const allowance = await pub.readContract({ address: MUSD, abi: erc20Abi, functionName: "allowance", args: [payer.address, ROUTER] });
  if (allowance < amount) {
    const h = await payerWallet.writeContract({ address: MUSD, abi: erc20Abi, functionName: "approve", args: [ROUTER, amount] });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const hash = await payerWallet.writeContract({ address: ROUTER, abi: routerAbi, functionName: "pay", args: [invoiceId, amount], gas: 600_000n });
  return pub.waitForTransactionReceipt({ hash });
}

async function main() {
  console.log(`issuer ${issuer.address}  client ${payer.address}\n`);
  const invoiceAmount = 100n * E18;
  const startIssuer = await musdOf(issuer.address);
  const startPayer = await musdOf(payer.address);
  check("client wallet holds enough MUSD for the test", startPayer >= invoiceAmount, fmt(startPayer));

  // 1. Freelancer creates the invoice on-chain and stores encrypted terms through the API.
  const issuerCookie = await signIn(issuer);
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode('{"description":"Payment test"}')));
  const commitment = keccak256(toHex(ct));
  const dueDate = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
  const createHash = await issuerWallet.writeContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "createInvoice",
    args: [zeroAddress, commitment, invoiceAmount, dueDate],
  });
  const created = (await pub.waitForTransactionReceipt({ hash: createHash })).logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: registryAbi, ...l });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "InvoiceCreated");
  const id = created && created.eventName === "InvoiceCreated" ? created.args.id : 0n;
  check("freelancer creates a 100 MUSD invoice", id > 0n, createHash);
  console.log(`      invoice #${id}`);
  const stored = await call("POST", "/api/v1/invoices", {
    cookie: issuerCookie,
    body: { invoiceId: id.toString(), ciphertext: Buffer.from(ct).toString("base64"), iv: Buffer.from(iv).toString("base64"), commitment },
  });
  check("API stores the encrypted terms", stored.status === 201, stored.text);

  // 2. Client accepts gaslessly through the relayer.
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await payer.signTypedData({
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
    message: { invoiceId: id, commitment, amount: invoiceAmount, dueDate, payer: payer.address, deadline },
  });
  const accept = await call("POST", "/api/v1/relay/accept-invoice", {
    body: { invoiceId: id.toString(), payer: payer.address, deadline: deadline.toString(), signature },
  });
  if (accept.json?.txHash) await pub.waitForTransactionReceipt({ hash: accept.json.txHash });
  const afterAccept = await call("GET", `/api/v1/chain/invoices/${id}`);
  check("client accepts via the relayer (no gas) and the invoice is Accepted", Number(afterAccept.json?.invoice?.status) === STATUS.Accepted, accept.text);

  // 3. Partial payment.
  const partial = 40n * E18;
  const preview = await call("GET", `/api/v1/chain/invoices/${id}/preview-payment?amount=${partial}`);
  check("API previews the 40 MUSD payment (no advance, so nothing goes to the vaults)", preview.json?.used === partial.toString() && preview.json?.toVaults === "0", preview.text);

  const r1 = await payLikeTheFrontend(id, partial);
  const afterPartial = await call("GET", `/api/v1/chain/invoices/${id}`);
  check(
    "client pays 40 MUSD: invoice becomes Partially paid with 60 MUSD still owed",
    r1.status === "success" &&
      Number(afterPartial.json?.invoice?.status) === STATUS.PartiallyPaid &&
      afterPartial.json?.amountOwed === (60n * E18).toString(),
    `${r1.status} ${afterPartial.text}`,
  );
  check("freelancer received the 40 MUSD", (await musdOf(issuer.address)) - startIssuer === partial, fmt((await musdOf(issuer.address)) - startIssuer));

  // 4. Pay the rest exactly the way the Pay page does: amount = amountOwed.
  const owed = await owedOf(id);
  const r2 = await payLikeTheFrontend(id, owed);
  const afterFull = await call("GET", `/api/v1/chain/invoices/${id}`);
  check(
    "client pays the remaining balance: invoice is Settled and nothing is owed",
    r2.status === "success" && Number(afterFull.json?.invoice?.status) === STATUS.Settled && afterFull.json?.amountOwed === "0",
    `${r2.status} ${afterFull.text}`,
  );
  const issuerGain = (await musdOf(issuer.address)) - startIssuer;
  const payerSpent = startPayer - (await musdOf(payer.address));
  check("freelancer received exactly 100 MUSD in total", issuerGain === invoiceAmount, fmt(issuerGain));
  check("client spent exactly 100 MUSD in total", payerSpent === invoiceAmount, fmt(payerSpent));

  // 5. The API and the reputation record reflect it.
  const rec = await call("POST", `/api/v1/invoices/${id}/reconcile`, { cookie: issuerCookie, body: { txHash: r2.transactionHash } });
  check("API reconcile shows the invoice as Settled", rec.json?.status === STATUS.Settled && rec.json?.paid === invoiceAmount.toString(), rec.text);
  const list = await call("GET", "/api/v1/invoices", { cookie: issuerCookie });
  check("the freelancer's invoice list shows it as Settled", list.json?.some((r: any) => r.invoiceId === id.toString() && r.status === STATUS.Settled), list.text);

  const stats = await pub.readContract({ address: REPUTATION, abi: reputationAbi, functionName: "payers", args: [payer.address] });
  const score = await pub.readContract({ address: REPUTATION, abi: reputationAbi, functionName: "clientScore", args: [payer.address] });
  check("client's on-chain payment record counts the on-time settlement", stats[0] >= 1 && stats[1] >= 1 && score > 0n, `settled ${stats[0]} onTime ${stats[1]} score ${score}`);
  console.log(`      client record: ${stats[0]} settled, ${stats[1]} on time, score ${score}/1000`);

  // 6. Nothing more can be paid.
  let overpayRejected = false;
  try {
    await pub.simulateContract({ account: payer, address: ROUTER, abi: routerAbi, functionName: "pay", args: [id, E18] });
  } catch {
    overpayRejected = true;
  }
  check("paying a settled invoice again is rejected", overpayRejected);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
