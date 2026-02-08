import { SocialCryptoBridge } from "./bridge";

let singleton: SocialCryptoBridge | null = null;

export function getCrypto(): SocialCryptoBridge {
  if (!singleton) singleton = new SocialCryptoBridge();
  return singleton;
}

export * from "./types";
