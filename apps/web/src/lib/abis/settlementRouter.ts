export const settlementRouterAbi = [
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "invoiceId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "used", type: "uint256" }],
  },
  {
    type: "function",
    name: "payWithBTC",
    stateMutability: "payable",
    inputs: [
      { name: "invoiceId", type: "uint256" },
      { name: "minMUSDOut", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setPayoutPrefs",
    stateMutability: "nonpayable",
    inputs: [
      { name: "splitter", type: "address" },
      { name: "toAccount", type: "bool" },
      { name: "keepBTC", type: "bool" },
      { name: "targetCRBps", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "prefs",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [
      { name: "splitter", type: "address" },
      { name: "toAccount", type: "bool" },
      { name: "keepBTC", type: "bool" },
      { name: "targetCRBps", type: "uint16" },
    ],
  },
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
