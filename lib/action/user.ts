import { BackendKeyEnvelope } from "@/lib/protocol/recoveryVault";

interface RegisterInput {
  recoveryAuthPublicKey: string;
  backendKeyEnvelope: BackendKeyEnvelope;
  temporary?: boolean;
}

export async function registerUser(input: RegisterInput): Promise<{ success: boolean; error?: string, socialId?: string }> {
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const socialId = data.insertedId;

    return { success: Boolean(data?.success), error: data?.error, socialId };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}
