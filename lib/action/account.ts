import {
  deriveRecoveryAuthPublicKey,
  signAccountChallenge,
  signAccountChallengeLegacy,
} from "@/lib/protocol/recoveryVault";
import { attachCsrfHeader } from "@/lib/action/csrf";

type ProtectedAction = "clear-data" | "delete-user";

interface ProtectedAccountActionInput {
  socialId: string;
  recoveryKeyHex: string;
}

interface ChallengeResponse {
  success: boolean;
  error?: string;
  challenge?: {
    nonce: string;
    expiresAt: string;
  };
}

async function fetchChallenge(
  socialId: string,
  action: ProtectedAction
): Promise<{ success: boolean; nonce?: string; error?: string }> {
  try {
    const response = await fetch("/api/account/challenge", attachCsrfHeader({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialId, action }),
    }));

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as ChallengeResponse;
    const nonce = data.challenge?.nonce;
    if (!data.success || !nonce) {
      return { success: false, error: data.error || "Failed to obtain challenge" };
    }

    return { success: true, nonce };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

async function runProtectedAction(
  path: string,
  action: ProtectedAction,
  input: ProtectedAccountActionInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const challenge = await fetchChallenge(input.socialId, action);
    if (!challenge.success || !challenge.nonce) {
      return { success: false, error: challenge.error || "Challenge failed" };
    }

    const signature = signAccountChallenge(
      input.recoveryKeyHex,
      action,
      input.socialId,
      challenge.nonce
    );
    const legacySignature = await signAccountChallengeLegacy(
      input.recoveryKeyHex,
      action,
      input.socialId,
      challenge.nonce
    );
    const recoveryAuthPublicKey = deriveRecoveryAuthPublicKey(input.recoveryKeyHex);

    const response = await fetch(path, attachCsrfHeader({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        socialId: input.socialId,
        nonce: challenge.nonce,
        signature,
        legacySignature,
        recoveryAuthPublicKey,
      }),
    }));

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: Boolean(data?.success), error: data?.error };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export function clearRemoteData(input: ProtectedAccountActionInput): Promise<{ success: boolean; error?: string }> {
  return runProtectedAction("/api/account/clear-data", "clear-data", input);
}

export function deleteRemoteUser(input: ProtectedAccountActionInput): Promise<{ success: boolean; error?: string }> {
  return runProtectedAction("/api/account/delete-user", "delete-user", input);
}
