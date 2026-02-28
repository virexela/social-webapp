import { getRelayWsUrl } from "@/lib/network/relayUrl";

export type InviteSocketHandlers = {
  onInviteAccepted?: (by: string) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
};

type InviteJoinOptions = {
  limit?: number;
  creator?: boolean;
};

function makeWsUrl(path: string): string {
  const url = new URL(getRelayWsUrl());
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function joinInviteRoom(
  roomId: string,
  handlers: InviteSocketHandlers = {},
  options: InviteJoinOptions = {}
): WebSocket {
  const url = new URL(makeWsUrl(`/invite-ws/${encodeURIComponent(roomId)}`));
  if (options.limit && Number.isFinite(options.limit)) {
    url.searchParams.set("limit", String(Math.trunc(options.limit)));
  }
  if (options.creator) {
    url.searchParams.set("creator", "1");
  }
  const socket = new WebSocket(url.toString());

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const data = JSON.parse(event.data);
      if (data?.type === "invite_accepted" && data.by) {
        handlers.onInviteAccepted?.(data.by);
      }
    } catch {
      // ignore invalid JSON
    }
  });

  if (handlers.onClose) socket.addEventListener("close", handlers.onClose);
  if (handlers.onError) socket.addEventListener("error", handlers.onError);

  return socket;
}

// build a relay websocket url for chat (user path)
export function buildRelayChatUrl(roomId: string): string {
  return makeWsUrl(`/ws/${encodeURIComponent(roomId)}`);
}
