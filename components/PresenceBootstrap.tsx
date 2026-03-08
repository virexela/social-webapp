"use client";

import { useEffect, useMemo } from "react";
import { getPresenceByRoom, sendPresenceHeartbeat } from "@/lib/action/presence";
import { useSocialStore } from "@/lib/state/store";

const HEARTBEAT_INTERVAL_MS = 25_000;

export function PresenceBootstrap() {
  const contacts = useSocialStore((s) => s.contacts);
  const hydrated = useSocialStore((s) => s._hydrated);
  const setPresenceByRoom = useSocialStore((s) => s.setPresenceByRoom);

  const connectedRoomIds = useMemo(
    () => contacts.filter((contact) => contact.status === "connected").map((contact) => contact.roomId),
    [contacts]
  );
  const connectedRoomIdsKey = useMemo(() => connectedRoomIds.join("|"), [connectedRoomIds]);

  useEffect(() => {
    if (!hydrated) return;

    const socialId = typeof window !== "undefined" ? localStorage.getItem("social_id") ?? "" : "";
    if (!socialId) return;

    const roomIds = connectedRoomIdsKey ? connectedRoomIdsKey.split("|").filter(Boolean) : [];

    if (roomIds.length === 0) {
      setPresenceByRoom({});
      return;
    }

    let cancelled = false;

    const syncPresence = async () => {
      if (cancelled) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setPresenceByRoom({});
        return;
      }

      const heartbeat = await sendPresenceHeartbeat(socialId);
      if (!heartbeat.success || cancelled) return;

      const presence = await getPresenceByRoom(roomIds, socialId);
      if (!cancelled && presence.success) {
        setPresenceByRoom(presence.onlineByRoom ?? {});
      }
    };

    void syncPresence();

    const intervalId = window.setInterval(() => {
      void syncPresence();
    }, HEARTBEAT_INTERVAL_MS);

    const onOnline = () => {
      void syncPresence();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncPresence();
      }
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [connectedRoomIdsKey, hydrated, setPresenceByRoom]);

  return null;
}