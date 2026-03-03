import { getRelayWsUrl, getRelayWsUrlCandidates } from "@/lib/network/relayUrl";

export type InviteSocketHandlers = {
  onInviteAccepted?: (by: string) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
};

type InviteJoinOptions = {
  limit?: number;
  creator?: boolean;
  token?: string;
};

function makeWsUrl(path: string): string {
  const candidateBase = getRelayWsUrlCandidates()[0] ?? getRelayWsUrl();
  const url = new URL(candidateBase);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function makeWsUrlFromBase(base: string, path: string): string {
  const url = new URL(base);
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
  if (options.token) {
    url.searchParams.set("token", options.token);
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
export function buildRelayChatUrl(roomId: string, token?: string): string {
  const url = new URL(makeWsUrl(`/ws/${encodeURIComponent(roomId)}`));
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

export function buildRelayChatUrlCandidates(roomId: string, token?: string): string[] {
  const path = `/ws/${encodeURIComponent(roomId)}`;
  return getRelayWsUrlCandidates().map((base) => {
    const url = new URL(makeWsUrlFromBase(base, path));
    if (token) {
      url.searchParams.set("token", token);
    }
    return url.toString();
  });
}
