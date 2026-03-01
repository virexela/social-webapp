import { ChatMessage } from "@/lib/state/store";

type OutboxPayload =
  | { type: "chat"; messageId: string; text: string }
  | { type: "file"; messageId: string; fileName: string; mimeType: string; fileDataBase64: string };

export interface OutboxItem {
  roomId: string;
  message: ChatMessage;
  payload: OutboxPayload;
  createdAt: number;
}

const OUTBOX_KEY = "social_outbox_v1";

function readOutbox(): OutboxItem[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.roomId === "string" &&
        typeof record.createdAt === "number" &&
        record.message !== null &&
        typeof record.message === "object" &&
        record.payload !== null &&
        typeof record.payload === "object"
      );
    }) as OutboxItem[];
  } catch {
    return [];
  }
}

function writeOutbox(items: OutboxItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
}

export function enqueueOutboxItem(item: OutboxItem) {
  const items = readOutbox();
  const withoutSameMessage = items.filter((existing) => existing.message.id !== item.message.id);
  withoutSameMessage.push(item);
  writeOutbox(withoutSameMessage);
}

export function dequeueOutboxItem(messageId: string) {
  const items = readOutbox();
  writeOutbox(items.filter((item) => item.message.id !== messageId));
}

export function getOutboxForRoom(roomId: string): OutboxItem[] {
  return readOutbox()
    .filter((item) => item.roomId === roomId)
    .sort((a, b) => a.createdAt - b.createdAt);
}
