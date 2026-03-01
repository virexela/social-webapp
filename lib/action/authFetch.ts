import { authenticateSessionWithRecovery } from "@/lib/action/session";

type AuthFetchInit = RequestInit & {
  socialId?: string;
  skipAuthRetry?: boolean;
};

let inflightSessionRestore: Promise<boolean> | null = null;

function isValidSocialId(value: string | null | undefined): value is string {
  return !!value && /^[a-fA-F0-9]{24}$/.test(value);
}

function isValidRecoveryKey(value: string | null | undefined): value is string {
  return !!value && /^[a-fA-F0-9]{64}$/.test(value);
}

async function restoreSession(socialIdHint?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const socialId = socialIdHint ?? localStorage.getItem("social_id");
  const recoveryKey = localStorage.getItem("recovery_key")?.trim().toLowerCase();

  if (!isValidSocialId(socialId) || !isValidRecoveryKey(recoveryKey)) {
    return false;
  }

  if (inflightSessionRestore) {
    return inflightSessionRestore;
  }

  inflightSessionRestore = (async () => {
    const result = await authenticateSessionWithRecovery({
      socialId,
      recoveryKeyHex: recoveryKey,
    });
    return Boolean(result.success);
  })();

  try {
    return await inflightSessionRestore;
  } finally {
    inflightSessionRestore = null;
  }
}

export async function fetchWithAutoSession(
  input: RequestInfo | URL,
  init: AuthFetchInit = {}
): Promise<Response> {
  const { socialId, skipAuthRetry, ...requestInit } = init;

  const firstResponse = await fetch(input, requestInit);
  if (firstResponse.status !== 401 || skipAuthRetry === true) {
    return firstResponse;
  }

  const restored = await restoreSession(socialId);
  if (!restored) {
    return firstResponse;
  }

  return fetch(input, requestInit);
}
