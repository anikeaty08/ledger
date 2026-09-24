/**
 * Minimal read ABIs for the Ledger contracts (kept hand-trimmed here; the full ABI lives in
 * contracts/out/*.json after `forge build` and should be copied in by the build/deploy script once the
 * contracts are compiled and this app is wired to a real deployment).
 */

export const invoiceRegistryAbi = [
  {
    type: "function",
    name: "getInvoice",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "issuer", type: "address" },
          { name: "payer", type: "address" },
          { name: "commitment", type: "bytes32" },
          { name: "amount", type: "uint128" },
          { name: "paid", type: "uint128" },
          { name: "issuedAt", type: "uint64" },
          { name: "dueDate", type: "uint64" },
          { name: "acceptedAt", type: "uint64" },
          { name: "closedAt", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "statusBeforeDispute", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "amountOwed",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "acceptanceDigest",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "acceptInvoiceWithSig",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const advanceEngineAbi = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "eligible", type: "bool" },
          { name: "maxAdvance", type: "uint256" },
          { name: "feeForMax", type: "uint256" },
          { name: "advanceRateBps", type: "uint16" },
          { name: "feePer30dBps", type: "uint16" },
          { name: "recourseBps", type: "uint16" },
          { name: "tenorDays", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export const settlementRouterAbi = [
  {
    type: "function",
    name: "previewPayment",
    stateMutability: "view",
    inputs: [
      { name: "invoiceId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "used", type: "uint256" },
      { name: "toVaults", type: "uint256" },
      { name: "remainder", type: "uint256" },
    ],
  },
] as const;

export const reputationRegistryAbi = [
  {
    type: "function",
    name: "clientScore",
    stateMutability: "view",
    inputs: [{ name: "payer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "hasHistory",
    stateMutability: "view",
    inputs: [{ name: "payer", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;
