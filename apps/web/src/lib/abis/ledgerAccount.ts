export const ledgerAccountFactoryAbi = [
  {
    type: "function",
    name: "accountOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "account", type: "address" }],
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
    name: "configureGuardian",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "enabled", type: "bool" },
          { name: "warnICRBps", type: "uint16" },
          { name: "actionICRBps", type: "uint16" },
          { name: "targetICRBps", type: "uint16" },
          { name: "criticalICRBps", type: "uint16" },
          { name: "maxDailyRepay", type: "uint128" },
          { name: "maxDailyBTC", type: "uint128" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "configureTreasury",
    stateMutability: "nonpayable",
    inputs: [
      { name: "yieldVault", type: "address" },
      { name: "autoSweep", type: "bool" },
      { name: "paydownBps", type: "uint16" },
    ],
    outputs: [],
  },
] as const;
