"use client";

import { useMemo, useState } from "react";
import { useSocialStore } from "@/lib/state/store";

export function DebugConnections() {
  const isDev = useMemo(() => process.env.NODE_ENV !== "production", []);
  const connections = useSocialStore((s) => s.connections);
  const refresh = useSocialStore((s) => s.refreshConnectionsFromWasm);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isDev) return null;

  async function onRefresh() {
    setBusy(true);
    setError(null);
    try {
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-md border border-black/10 bg-white p-4 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-zinc-700">Dev: Connections</div>
        <button
          onClick={() => void onRefresh()}
          disabled={busy}
          className="rounded bg-zinc-800 px-2 py-1 font-medium text-white disabled:opacity-50"
        >
          Refresh (WASM)
        </button>
      </div>

      <div className="mt-2 text-zinc-700">Count: {connections.length}</div>
      {error ? <div className="mt-2 text-red-600">Error: {error}</div> : null}

      <ul className="mt-2 space-y-1 break-all text-zinc-700">
        {connections.map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
    </section>
  );
}
