"use client";

import { useState } from "react";
import { waitForReceipt, withGas } from "@/lib/tx";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { zeroAddress } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LedgerSheet, LedgerSheetHeader, LedgerRow, Button, Gate, Notice } from "@/components/Ledger";
import { Amount } from "@/components/Amount";
import { NotDeployed } from "@/components/NotDeployed";
import { addresses, requireAddress } from "@/lib/addresses";
import { ledgerAccountFactoryAbi, ledgerAccountAbi } from "@/lib/abis/ledgerAccount";
import { formatBps } from "@/lib/format";

export default function PositionPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accountAddress, refetch: refetchAccount } = useReadContract({
    address: addresses.ledgerAccountFactory,
    abi: ledgerAccountFactoryAbi,
    functionName: "accountOf",
    args: [address ?? zeroAddress],
    query: { enabled: !!address && !!addresses.ledgerAccountFactory },
  });

  const hasAccount = accountAddress && accountAddress !== zeroAddress;

  const { data: positionRaw } = useReadContract({
    address: accountAddress,
    abi: ledgerAccountAbi,
    functionName: "position",
    query: { enabled: !!hasAccount },
  });
  // wagmi types a multi-output view as a labeled tuple (array), not an object — destructure by
  // position (the labels are documentation only) into a named shape the rest of this component uses.
  const position = positionRaw
    ? { coll: positionRaw[0], debt: positionRaw[1], icr: positionRaw[2], active: positionRaw[3] }
    : undefined;

  const { data: guardianRaw, refetch: refetchGuardian } = useReadContract({
    address: accountAddress,
    abi: ledgerAccountAbi,
    functionName: "guardian",
    query: { enabled: !!hasAccount },
  });
  // wagmi types a multi-output view as a labeled tuple (array), not an object — destructure by
  // position (the labels are documentation only) into a named shape the rest of this component uses.
  const guardian = guardianRaw
    ? {
        enabled: guardianRaw[0],
        warnICRBps: guardianRaw[1],
        actionICRBps: guardianRaw[2],
        targetICRBps: guardianRaw[3],
        criticalICRBps: guardianRaw[4],
        maxDailyRepay: guardianRaw[5],
        maxDailyBTC: guardianRaw[6],
      }
    : undefined;

  async function handleCreateAccount() {
    setWorking(true);
    setError(null);
    try {
      const hash = await writeContractAsync(
        await withGas(publicClient!, address!, {
          address: requireAddress("ledgerAccountFactory"),
          abi: ledgerAccountFactoryAbi,
          functionName: "createAccount",
        }),
      );
      await waitForReceipt(publicClient!, hash);
      await refetchAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.");
    } finally {
      setWorking(false);
    }
  }

  async function handleToggleGuardian(enabled: boolean) {
    if (!guardian) return;
    setWorking(true);
    setError(null);
    try {
      const hash = await writeContractAsync(
        await withGas(publicClient!, address!, {
          address: accountAddress!,
          abi: ledgerAccountAbi,
          functionName: "configureGuardian",
          args: [
            {
              enabled,
              warnICRBps: guardian.warnICRBps,
              actionICRBps: guardian.actionICRBps,
              targetICRBps: guardian.targetICRBps,
              criticalICRBps: guardian.criticalICRBps,
              maxDailyRepay: guardian.maxDailyRepay,
              maxDailyBTC: guardian.maxDailyBTC,
            },
          ],
        }),
      );
      await waitForReceipt(publicClient!, hash);
      await refetchGuardian();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the guardian.");
    } finally {
      setWorking(false);
    }
  }

  if (!isConnected) {
    return (
      <Gate title="Your position" body="Connect a wallet to see the BTC you've kept as collateral and your MUSD debt against it.">
        <ConnectButton />
      </Gate>
    );
  }

  if (!addresses.ledgerAccountFactory) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-6 text-2xl font-semibold text-ink">Your position</h1>
        <NotDeployed what="Positions" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">Your position</h1>
      <p className="mt-2 text-ink-soft">
        BTC you keep instead of selling, held as collateral in your own MUSD position on Mezo.
      </p>

      {error && <Notice className="mt-4">{error}</Notice>}

      {!hasAccount ? (
        <LedgerSheet className="mt-6">
          <div className="p-6">
            <p className="mb-4 text-ink-soft">
              You don&apos;t have a Ledger account yet. Create one to keep BTC payments as collateral instead of
              converting them to MUSD.
            </p>
            <Button variant="primary" onClick={handleCreateAccount} disabled={working}>
              {working ? "Creating…" : "Create your account"}
            </Button>
          </div>
        </LedgerSheet>
      ) : !position?.active ? (
        <LedgerSheet className="mt-6">
          <div className="p-6 text-ink-soft">
            No open position yet. It opens automatically the first time a client pays an invoice in BTC
            with your Keep-BTC preference on.
          </div>
        </LedgerSheet>
      ) : (
        <>
          <LedgerSheet className="mt-6">
            <LedgerSheetHeader>
              <span className="text-[15px] text-ink">MUSD position</span>
            </LedgerSheetHeader>
            <LedgerRow label="BTC collateral">
              <Amount value={position.coll} currency="BTC" decimals={6} />
            </LedgerRow>
            <LedgerRow label="MUSD debt">
              <Amount value={position.debt} currency="MUSD" />
            </LedgerRow>
            <LedgerRow label="Collateral ratio" last>
              <span className={Number(position.icr) < 1.5e18 ? "text-red font-medium" : "text-ink"}>
                {formatBps(Number(position.icr / 10n ** 14n))}
              </span>
            </LedgerRow>
          </LedgerSheet>

          {guardian && (
            <LedgerSheet className="mt-6">
              <LedgerSheetHeader>
                <span className="text-[15px] text-ink">Liquidation guardian</span>
              </LedgerSheetHeader>
              <div className="p-5">
                <p className="mb-4 text-sm text-ink-soft">
                  When it&apos;s on, a public keeper can repay debt or add collateral for you if your ratio drops.
                  It can only reduce risk. It can never borrow or withdraw.
                </p>
                <p className="mb-4 text-sm">
                  <span className="text-ink-soft">Status: </span>
                  <span className="font-medium text-ink">{guardian.enabled ? "On" : "Off"}</span>
                </p>
                <Button
                  variant={guardian.enabled ? "secondary" : "primary"}
                  onClick={() => handleToggleGuardian(!guardian.enabled)}
                  disabled={working}
                >
                  {working ? "Confirm in your wallet…" : guardian.enabled ? "Turn off guardian" : "Turn on guardian"}
                </Button>
              </div>
            </LedgerSheet>
          )}
        </>
      )}
    </div>
  );
}
