import {
  deriveRecoveryAuthPublicKey,
  signAccountChallenge,
  signAccountChallengeLegacy,
} from "@/lib/protocol/recoveryVault";

interface SessionChallengeResponse {
  success: boolean;
  error?: string;
  challenge?: {
    nonce: string;
    expiresAt: string;
  };
}

interface SessionInput {
  socialId: string;
  recoveryKeyHex: string;
}

async function fetchSessionChallenge(socialId: string): Promise<{ success: boolean; nonce?: string; error?: string }> {
  try {
    const response = await fetch("/api/account/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialId, action: "session-auth" }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as SessionChallengeResponse;
    const nonce = data.challenge?.nonce;
    if (!data.success || !nonce) {
      return { success: false, error: data.error || "Failed to obtain session challenge" };
    }

    return { success: true, nonce };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

export async function authenticateSessionWithRecovery(input: SessionInput): Promise<{ success: boolean; error?: string }> {
  try {
    const challenge = await fetchSessionChallenge(input.socialId);
    if (!challenge.success || !challenge.nonce) {
      return { success: false, error: challenge.error || "Challenge failed" };
    }

    const signature = signAccountChallenge(
      input.recoveryKeyHex,
      "session-auth",
      input.socialId,
      challenge.nonce
    );
    const legacySignature = await signAccountChallengeLegacy(
      input.recoveryKeyHex,
      "session-auth",
      input.socialId,
      challenge.nonce
    );

    const recoveryAuthPublicKey = deriveRecoveryAuthPublicKey(input.recoveryKeyHex);

    const response = await fetch("/api/account/session/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        socialId: input.socialId,
        nonce: challenge.nonce,
        signature,
        legacySignature,
        recoveryAuthPublicKey,
      }),
    });

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
