export const invoiceRegistryAbi = [
  {
    type: "event",
    name: "InvoiceCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "issuer", type: "address", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "dueDate", type: "uint64", indexed: false },
      { name: "commitment", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "InvoiceStatusChanged",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "from", type: "uint8", indexed: false },
      { name: "to", type: "uint8", indexed: false },
    ],
  },
  {
    type: "function",
    name: "nextId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
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
    name: "markOverdue",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
] as const;

export const collectionsManagerAbi = [
  {
    type: "function",
    name: "defaultableAt",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "declareDefault",
    stateMutability: "nonpayable",
    inputs: [{ name: "invoiceId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const ledgerAccountFactoryAbi = [
  {
    type: "event",
    name: "AccountCreated",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "account", type: "address", indexed: false },
    ],
  },
] as const;

export const ledgerAccountAbi = [
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "coll", type: "uint256" },
      { name: "debt", type: "uint256" },
      { name: "icr", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "guardian",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "enabled", type: "bool" },
      { name: "warnICRBps", type: "uint16" },
      { name: "actionICRBps", type: "uint16" },
      { name: "targetICRBps", type: "uint16" },
      { name: "criticalICRBps", type: "uint16" },
      { name: "maxDailyRepay", type: "uint128" },
      { name: "maxDailyBTC", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "guardianCheck",
    stateMutability: "nonpayable",
    inputs: [
      { name: "upperHint", type: "address" },
      { name: "lowerHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "paydown",
    stateMutability: "nonpayable",
    inputs: [
      { name: "upperHint", type: "address" },
      { name: "lowerHint", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
