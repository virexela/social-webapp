/**
 * Validation schemas and utilities shared between frontend and backend.
 * These ensure consistent validation across all API boundaries.
 */

/**
 * Room ID validation pattern.
 * Allows: alphanumeric, hyphens, underscores, colons
 * Max length: 128 characters
 * Example valid RoomIDs: "room-123", "call_session:abc", "workspace:team-1"
 */
export const ROOM_ID_PATTERN = /^[a-zA-Z0-9\-_:]{1,128}$/;

/**
 * Social ID validation pattern.
 * Must be a 24-character hexadecimal string (MongoDB ObjectId format).
 */
export const SOCIAL_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

/**
 * Message ID validation pattern.
 * Alphanumeric, hyphens, underscores; max 128 characters
 */
export const MESSAGE_ID_PATTERN = /^[a-zA-Z0-9\-_]{1,128}$/;

/**
 * Validates a room ID according to the standard pattern.
 * @param roomId The room ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidRoomId(roomId: string | undefined): boolean {
  if (!roomId || typeof roomId !== 'string') return false;
  return ROOM_ID_PATTERN.test(roomId);
}

/**
 * Validates a social ID (MongoDB ObjectId as hex string).
 * @param socialId The social ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidSocialId(socialId: string | undefined): boolean {
  if (!socialId || typeof socialId !== 'string') return false;
  return SOCIAL_ID_PATTERN.test(socialId);
}

/**
 * Validates a message ID.
 * @param messageId The message ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidMessageId(messageId: string | undefined): boolean {
  if (!messageId || typeof messageId !== 'string') return false;
  return MESSAGE_ID_PATTERN.test(messageId);
}

/**
 * Validates message timestamp.
 * Must be a finite number representing milliseconds since epoch.
 * @param timestamp The timestamp to validate
 * @returns true if valid, false otherwise
 */
export function isValidTimestamp(timestamp: unknown): boolean {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0;
}

/**
 * Validates recovery auth hash format.
 * Must be 64 hex characters (SHA-256 output).
 * @param hash The hash to validate
 * @returns true if valid, false otherwise
 */
export function isValidRecoveryAuthHashFormat(hash: string | undefined): boolean {
  if (!hash || typeof hash !== 'string') return false;
  return /^[a-fA-F0-9]{64}$/i.test(hash);
}

/**
 * Validates contact encryption payload size.
 * @param payload The encrypted contact string
 * @param maxBytes Maximum allowed size (default 200KB)
 * @returns true if valid, false otherwise
 */
export function isValidEncryptedContactSize(payload: string | undefined, maxBytes = 200_000): boolean {
  if (!payload || typeof payload !== 'string') return false;
  return payload.length <= maxBytes;
}

/**
 * Validates message encryption payload size.
 * @param payload The encrypted message string
 * @param maxBytes Maximum allowed size (default 2MB)
 * @returns true if valid, false otherwise
 */
export function isValidEncryptedMessageSize(payload: string | undefined, maxBytes = 2_000_000): boolean {
  if (!payload || typeof payload !== 'string') return false;
  return payload.length <= maxBytes;
}

/**
 * Validates push notification endpoint URL.
 * @param endpoint The push endpoint URL
 * @param maxLength Maximum URL length (default 1024)
 * @returns true if valid, false otherwise
 */
export function isValidPushEndpoint(endpoint: string | undefined, maxLength = 1024): boolean {
  if (!endpoint || typeof endpoint !== 'string') return false;
  if (endpoint.length > maxLength) return false;
  
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:';  // Push endpoints must use HTTPS
  } catch {
    return false;
  }
}

/**
 * Validates VAPID key format (base64url string).
 * @param key The VAPID key to validate
 * @param maxLength Maximum key length (default 256)
 * @returns true if valid, false otherwise
 */
export function isValidVapidKey(key: string | undefined, maxLength = 256): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.length > maxLength) return false;
  return /^[A-Za-z0-9\-_]+={0,2}$/.test(key);  // Base64url format
}
