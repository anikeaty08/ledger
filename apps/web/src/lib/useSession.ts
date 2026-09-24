"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { createChallenge, createSession, getSession, ApiError } from "./api";

/**
 * Wallet-signature login against apps/api (see apps/api/src/routes/auth.ts). Does NOT run on wallet
 * connect — only the first time a screen actually needs the API (saving an invoice, a split), so
 * connecting a wallet never pops an unexpected signature request on page load.
 */
export function useSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [sessionAddress, setSessionAddress] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then((r) => setSessionAddress(r.address))
      .catch(() => setSessionAddress(null));
  }, []);

  const ensureSession = useCallback(async (): Promise<`0x${string}`> => {
    if (!address) throw new Error("Connect a wallet first.");
    if (sessionAddress && sessionAddress.toLowerCase() === address.toLowerCase()) return sessionAddress;

    setLoading(true);
    setError(null);
    try {
      const { challengeId, message } = await createChallenge(address);
      const signature = await signMessageAsync({ message });
      const { address: confirmed } = await createSession(challengeId, signature);
      setSessionAddress(confirmed);
      return confirmed;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Sign-in failed.";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [address, sessionAddress, signMessageAsync]);

  return { sessionAddress, ensureSession, loading, error };
}
