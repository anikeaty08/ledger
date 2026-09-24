import { env } from "./env.js";
import { runOverdueAndDefaultSweep } from "./jobs/overdueAndDefault.js";
import { runGuardianSweep } from "./jobs/guardianSweep.js";

async function tick(): Promise<void> {
  const startedAt = Date.now();
  try {
    const [invoiceResult, guardianResult] = await Promise.allSettled([
      runOverdueAndDefaultSweep(),
      runGuardianSweep(),
    ]);

    if (invoiceResult.status === "fulfilled") {
      const { overdued, defaulted, errors } = invoiceResult.value;
      console.log(`[keeper] invoices: ${overdued} marked overdue, ${defaulted} defaulted, ${errors} skipped`);
    } else {
      console.error("[keeper] overdue/default sweep failed:", invoiceResult.reason);
    }

    if (guardianResult.status === "fulfilled") {
      const { checked, acted, errors } = guardianResult.value;
      console.log(`[keeper] accounts: ${checked} checked, ${acted} acted on, ${errors} skipped`);
    } else {
      console.error("[keeper] guardian sweep failed:", guardianResult.reason);
    }
  } finally {
    console.log(`[keeper] tick finished in ${Date.now() - startedAt}ms`);
  }
}

const runOnce = process.argv.includes("--once");

if (runOnce) {
  await tick();
  process.exit(0);
} else {
  console.log(`[keeper] starting, polling every ${env.pollIntervalMs}ms`);
  await tick();
  setInterval(() => {
    void tick();
  }, env.pollIntervalMs);
}
