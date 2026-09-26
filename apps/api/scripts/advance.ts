/**
 * End-to-end advance test: seed the lending pools → invoice → gasless accept → advance (the same calls as
 * apps/web/src/app/invoices/[id]/page.tsx) → client pays in full → lenders repaid with their fee, recourse
 * and the receivable NFT returned, freelancer nets invoice − fee.
 *
 *   LENDER_KEY=0x… ISSUER_KEY=0x… PAYER_KEY=0x… npx tsx scripts/advance.ts
 *
 * LENDER_KEY seeds the vaults if they're empty (needs ~1,500 MUSD). ISSUER_KEY needs gas plus MUSD for
 * recourse collateral; PAYER_KEY needs gas plus the invoice amount in MUSD. Gas is left to estimation,
 * the way a browser wallet does it.
 */
import "dotenv/config";
import { webcrypto } from "node:crypto";
import { createPublicClient, createWalletClient, decodeEventLog, http, keccak256, nonceManager, parseAbi, toHex, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = process.env.API_URL ?? "http://localhost:8787";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const RPC = process.env.RPC_URL ?? "https://rpc.test.mezo.org";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31611);
const REGISTRY = process.env.INVOICE_REGISTRY_ADDRESS as Hex;
const ROUTER = process.env.SETTLEMENT_ROUTER_ADDRESS as Hex;
const ENGINE = process.env.ADVANCE_ENGINE_ADDRESS as Hex;
const SENIOR = process.env.SENIOR_VAULT_ADDRESS as Hex;
const JUNIOR = process.env.JUNIOR_VAULT_ADDRESS as Hex;
const MUSD = process.env.MUSD_ADDRESS as Hex;

const lender = privateKeyToAccount(process.env.LENDER_KEY as Hex, { nonceManager });
const issuer = privateKeyToAccount(process.env.ISSUER_KEY as Hex, { nonceManager });
const payer = privateKeyToAccount(process.env.PAYER_KEY as Hex, { nonceManager });
const chain = { id: CHAIN_ID, name: "Mezo Testnet", nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (a: typeof issuer) => createWalletClient({ account: a, chain, transport: http(RPC) });

const registryAbi = parseAbi([
  "function createInvoice(address payer, bytes32 commitment, uint128 amount, uint64 dueDate) returns (uint256)",
  "function amountOwed(uint256 id) view returns (uint256)",
  "function receivableNFT() view returns (address)",
  "event InvoiceCreated(uint256 indexed id, address indexed issuer, address indexed payer, uint256 amount, uint64 dueDate, bytes32 commitment)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const vaultAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function utilizationBps() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalFeesEarned() view returns (uint256)",
  "function lockedProfit() view returns (uint256)",
]);
const nftAbi = parseAbi(["function approve(address to, uint256 tokenId)", "function ownerOf(uint256) view returns (address)"]);
const engineAbi = parseAbi([
  "function requestAdvance(uint256 invoiceId, uint256 amount, uint256 maxFee, uint256 recourseMUSD) payable",
  "function protocolFeesAccrued() view returns (uint256)",
  "function getAdvance(uint256) view returns ((address borrower, address payer, uint128 principal, uint128 fee, uint128 seniorPrincipalDue, uint128 juniorPrincipalDue, uint128 seniorFeeDue, uint128 juniorFeeDue, uint128 protocolFeeDue, uint128 recourseMUSD, uint128 recourseBTC, uint128 seniorLoss, uint128 juniorLoss, uint64 fundedAt, uint16 advanceRateBps, uint16 feePer30dBps, bool active, bool defaulted))",
]);
const routerAbi = parseAbi(["function pay(uint256 invoiceId, uint256 amount) returns (uint256)"]);

const E18 = 10n ** 18n;
const STATUS = { Accepted: 2, Financed: 3, Settled: 7 } as const;
let passed = 0;
let failed = 0;
const fmt = (v: bigint) => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${a / E18}.${((a % E18) / 10n ** 14n).toString().padStart(4, "0")}`;
};
function check(name: string, ok: boolean, detail = "") {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -> ${detail}` : ""}`);
}

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
const vaultAssets = (v: Hex) => pub.readContract({ address: v, abi: vaultAbi, functionName: "totalAssets" });

/** Same polling as apps/web/src/lib/tx.ts: Mezo nodes can disagree about whether a receipt exists yet. */
async function waitForReceipt(hash: Hex) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      return await pub.getTransactionReceipt({ hash });
    } catch (err) {
      if (!(err instanceof Error) || err.name !== "TransactionReceiptNotFoundError" || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

/** Same as withGas in apps/web/src/lib/tx.ts: Mezo's estimate can fall below the EIP-7623 floor, so every
 *  write carries an explicit limit of estimate × 1.5 + 50k, with the estimate retried on a lagging node. */
async function withGas(account: typeof issuer, req: object) {
  let lastError: unknown;
  let sawBogus = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const estimate = await pub.estimateContractGas({ ...req, account } as never);
      if (estimate >= 30_000n) return { ...req, gas: (estimate * 3n) / 2n + 50_000n };
      sawBogus = true;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  if (sawBogus) return { ...req, gas: 1_500_000n };
  throw lastError;
}

async function send(account: typeof issuer, req: Parameters<ReturnType<typeof wallet>["writeContract"]>[0]) {
  const withLimit = await withGas(account, req as object);
  const hash = await wallet(account).writeContract(withLimit as never);
  const receipt = await waitForReceipt(hash);
  if (receipt.status !== "success") {
    const limit = (withLimit as { gas?: bigint }).gas;
    throw new Error(`${(req as { functionName?: string }).functionName} reverted on-chain: used ${receipt.gasUsed} of gas limit ${limit} (tx ${hash})`);
  }
  return receipt;
}
async function approveIfNeeded(account: typeof issuer, spender: Hex, amount: bigint) {
  const allowance = await pub.readContract({ address: MUSD, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
  if (allowance < amount) await send(account, { address: MUSD, abi: erc20Abi, functionName: "approve", args: [spender, amount] } as never);
}

async function main() {
  console.log(`lender ${lender.address}\nissuer ${issuer.address}\nclient ${payer.address}\n`);

  // 0. Seed the pools (only if empty, so reruns don't keep depositing).
  for (const [vault, amount] of [[SENIOR, 1_200n * E18], [JUNIOR, 300n * E18]] as const) {
    if ((await vaultAssets(vault)) > 0n) continue;
    await approveIfNeeded(lender, vault, amount);
    await send(lender, { address: vault, abi: vaultAbi, functionName: "deposit", args: [amount, lender.address] } as never);
  }
  const [s0, j0] = [await vaultAssets(SENIOR), await vaultAssets(JUNIOR)];
  const shares = await pub.readContract({ address: SENIOR, abi: vaultAbi, functionName: "balanceOf", args: [lender.address] });
  check("lender deposits into the senior and junior pools and receives shares", s0 > 0n && j0 > 0n && shares > 0n, `${fmt(s0)} / ${fmt(j0)}`);
  console.log(`      pools: senior ${fmt(s0)} MUSD, junior ${fmt(j0)} MUSD`);
  const stats = await call("GET", "/api/v1/chain/contracts");
  check("API still serves the deployment", stats.status === 200);

  // 1. Invoice + gasless acceptance.
  const issuerCookie = await signIn(issuer);
  const invoiceAmount = 100n * E18;
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode('{"description":"Advance test"}')));
  const commitment = keccak256(toHex(ct));
  const dueDate = BigInt(Math.floor(Date.now() / 1000) + 60 * 86_400);
  const createReceipt = await send(issuer, {
    address: REGISTRY,
    abi: registryAbi,
    functionName: "createInvoice",
    args: [zeroAddress, commitment, invoiceAmount, dueDate],
  } as never);
  const created = createReceipt.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: registryAbi, ...l });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "InvoiceCreated");
  const id = created && created.eventName === "InvoiceCreated" ? created.args.id : 0n;
  check("freelancer creates a 100 MUSD invoice due in 60 days", id > 0n);
  console.log(`      invoice #${id}`);
  await call("POST", "/api/v1/invoices", {
    cookie: issuerCookie,
    body: { invoiceId: id.toString(), ciphertext: Buffer.from(ct).toString("base64"), iv: Buffer.from(iv).toString("base64"), commitment },
  });
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
  if (accept.json?.txHash) await waitForReceipt(accept.json.txHash);
  const nft = await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "receivableNFT" });
  const nftOwner0 = await pub.readContract({ address: nft, abi: nftAbi, functionName: "ownerOf", args: [id] });
  check("client accepts; the freelancer now holds the receivable NFT", nftOwner0.toLowerCase() === issuer.address.toLowerCase(), accept.text);

  // 2. Quote, exactly what the invoice page shows.
  const q = (await call("GET", `/api/v1/chain/invoices/${id}/quote`)).json?.quote;
  check("API quote says the invoice is eligible for an advance", q?.eligible === true, JSON.stringify(q));
  console.log(`      quote: up to ${fmt(BigInt(q.maxAdvance))} MUSD, ${Number(q.feePer30dBps) / 100}%/30d, recourse ${Number(q.recourseBps) / 100}%, ${q.tenorDays} days`);

  // 3. Advance, mirroring handleAdvance() in the invoice page.
  const requested = 50n * E18;
  const projectedFee = (requested * BigInt(q.feePer30dBps) * BigInt(Math.ceil(Number(q.tenorDays) / 30) || 1)) / 10_000n;
  const recourse = requested > 0n ? (requested * BigInt(q.recourseBps)) / 10_000n + 1n : 0n;
  const maxFee = projectedFee + projectedFee / 10n + 1n;
  const issuerStart = await musdOf(issuer.address);
  check("freelancer has enough MUSD to post the recourse collateral", issuerStart >= recourse, `${fmt(issuerStart)} < ${fmt(recourse)}`);

  const protocol0 = await pub.readContract({ address: ENGINE, abi: engineAbi, functionName: "protocolFeesAccrued" });
  const feesEarned = (v: Hex) => pub.readContract({ address: v, abi: vaultAbi, functionName: "totalFeesEarned" });
  const [sFees0, jFees0] = [await feesEarned(SENIOR), await feesEarned(JUNIOR)];
  let advanceOk = false;
  let advanceErr = "";
  try {
    if (recourse > 0n) await approveIfNeeded(issuer, ENGINE, recourse);
    await send(issuer, { address: nft, abi: nftAbi, functionName: "approve", args: [ENGINE, id] } as never);
    const r = await send(issuer, { address: ENGINE, abi: engineAbi, functionName: "requestAdvance", args: [id, requested, maxFee, recourse] } as never);
    advanceOk = r.status === "success";
  } catch (e) {
    advanceErr = e instanceof Error ? `${e.message.split("\n")[0]} | ${e.message.match(/Details: (.*)/)?.[1] ?? ""} | ${e.message.match(/nonce:\s+(\d+)/)?.[0] ?? ""}` : String(e);
  }
  check("requestAdvance succeeds (with the app's buffered gas limit)", advanceOk, advanceErr);

  const adv = await pub.readContract({ address: ENGINE, abi: engineAbi, functionName: "getAdvance", args: [id] });
  const afterAdvance = await call("GET", `/api/v1/chain/invoices/${id}`);
  const issuerAfterAdvance = await musdOf(issuer.address);
  check("invoice is Financed and the advance is active for 50 MUSD", Number(afterAdvance.json?.invoice?.status) === STATUS.Financed && adv.active && adv.principal === requested, afterAdvance.text);
  check("the fee charged is within the page's estimate + 10% slippage cap", adv.fee <= maxFee && adv.fee >= projectedFee, `fee ${fmt(adv.fee)} est ${fmt(projectedFee)}`);
  check(
    "freelancer received 50 MUSD minus the recourse they posted",
    issuerAfterAdvance - issuerStart === requested - recourse,
    fmt(issuerAfterAdvance - issuerStart),
  );
  const nftOwner1 = await pub.readContract({ address: nft, abi: nftAbi, functionName: "ownerOf", args: [id] });
  check("the advance engine holds the receivable NFT", nftOwner1.toLowerCase() === ENGINE.toLowerCase(), nftOwner1);
  const util = await pub.readContract({ address: SENIOR, abi: vaultAbi, functionName: "utilizationBps" });
  check("the senior pool shows the money as lent out", util > 0n, util.toString());
  console.log(`      advance: principal ${fmt(adv.principal)}, fee ${fmt(adv.fee)}, recourse ${fmt(adv.recourseMUSD)} MUSD`);

  // 4. Client pays in full (Pay page: amount = amountOwed), gas estimated.
  const owed = await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "amountOwed", args: [id] });
  let payOk = false;
  let payErr = "";
  try {
    await approveIfNeeded(payer, ROUTER, owed);
    const r = await send(payer, { address: ROUTER, abi: routerAbi, functionName: "pay", args: [id, owed] } as never);
    payOk = r.status === "success";
  } catch (e) {
    payErr = e instanceof Error ? `${e.message.split("\n")[0]} | ${e.message.match(/Details: (.*)/)?.[1] ?? ""} | ${e.message.match(/nonce:\s+(\d+)/)?.[0] ?? ""}` : String(e);
  }
  check("client pays the financed invoice (with the app's buffered gas limit)", payOk, payErr);

  // 5. Waterfall results.
  const done = await call("GET", `/api/v1/chain/invoices/${id}`);
  const advDone = await pub.readContract({ address: ENGINE, abi: engineAbi, functionName: "getAdvance", args: [id] });
  check("invoice is Settled and the advance is closed", Number(done.json?.invoice?.status) === STATUS.Settled && !advDone.active, done.text);

  const [s1, j1] = [await vaultAssets(SENIOR), await vaultAssets(JUNIOR)];
  const lpFee = adv.fee - adv.protocolFeeDue;
  const [sFees1, jFees1] = [await feesEarned(SENIOR), await feesEarned(JUNIOR)];
  check(
    "lenders were paid their exact share of the fee (senior 70%, junior 30% of the LP fee)",
    sFees1 - sFees0 === adv.seniorFeeDue && jFees1 - jFees0 === adv.juniorFeeDue && adv.seniorFeeDue + adv.juniorFeeDue === lpFee,
    `senior +${fmt(sFees1 - sFees0)} (due ${fmt(adv.seniorFeeDue)}), junior +${fmt(jFees1 - jFees0)} (due ${fmt(adv.juniorFeeDue)})`,
  );
  const [sLocked, jLocked] = [
    await pub.readContract({ address: SENIOR, abi: vaultAbi, functionName: "lockedProfit" }),
    await pub.readContract({ address: JUNIOR, abi: vaultAbi, functionName: "lockedProfit" }),
  ];
  check(
    "lender principal is fully back and the fee is unlocking to lenders over time",
    s1 + sLocked >= s0 + adv.seniorFeeDue - 1n && j1 + jLocked >= j0 + adv.juniorFeeDue - 1n && sLocked > 0n && jLocked > 0n,
    `senior ${fmt(s1)} + locked ${fmt(sLocked)}, junior ${fmt(j1)} + locked ${fmt(jLocked)}`,
  );
  const protocol1 = await pub.readContract({ address: ENGINE, abi: engineAbi, functionName: "protocolFeesAccrued" });
  check("the protocol booked its cut of the fee", protocol1 - protocol0 === adv.protocolFeeDue, fmt(protocol1 - protocol0));

  const issuerEnd = await musdOf(issuer.address);
  check("freelancer netted exactly the invoice minus the fee (recourse returned)", issuerEnd - issuerStart === invoiceAmount - adv.fee, fmt(issuerEnd - issuerStart));
  const nftOwner2 = await pub.readContract({ address: nft, abi: nftAbi, functionName: "ownerOf", args: [id] });
  check("the receivable NFT went back to the freelancer", nftOwner2.toLowerCase() === issuer.address.toLowerCase(), nftOwner2);

  const rec = await call("POST", `/api/v1/invoices/${id}/reconcile`, { cookie: issuerCookie, body: {} });
  check("API shows the invoice as Settled", rec.json?.status === STATUS.Settled, rec.text);
  console.log(`      lenders earned: senior ${fmt(sFees1 - sFees0)}, junior ${fmt(jFees1 - jFees0)} MUSD (unlocking gradually); protocol ${fmt(protocol1 - protocol0)}`);
  console.log(`      freelancer: advance ${fmt(requested)} early, ${fmt(invoiceAmount - adv.fee)} net after fee ${fmt(adv.fee)}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
