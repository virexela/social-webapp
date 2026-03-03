import { createHmac } from "crypto";

function getPrivacyPepper(): string {
  const pepper = process.env.PRIVACY_ID_PEPPER?.trim() ?? "";
  if (!pepper) {
    // Development fallback only; production should set PRIVACY_ID_PEPPER.
    return "dev-privacy-pepper";
  }
  return pepper;
}

export function blindStableId(raw: string): string {
  return createHmac("sha256", getPrivacyPepper()).update(raw).digest("hex");
}

