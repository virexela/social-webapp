const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/"];
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/octet-stream",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".js",
  ".vbs",
  ".ps1",
  ".msi",
  ".dll",
  ".jar",
  ".hta",
]);

export function isAllowedMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  if (ALLOWED_MIME_TYPES.has(normalized)) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function hasBlockedExtension(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex < 0) return false;
  const extension = lower.slice(dotIndex);
  return BLOCKED_EXTENSIONS.has(extension);
}

export function isValidBase64UrlPayload(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
