"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Trash2, Cloud, Bell, ChevronLeft, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import clsx from "clsx";
import { clearRemoteData, deleteRemoteUser } from "@/lib/action/account";
import {
  getPushSubscriptionStatus,
  registerPushSubscription,
  unregisterPushSubscription,
} from "@/lib/action/push";

export default function SettingsPage() {
  const router = useRouter();
  const social_id = typeof window !== "undefined" ? localStorage.getItem("social_id") : null;

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("notify") === "1";
    } catch {
      return false;
    }
  });

  const [devicesCount, setDevicesCount] = useState<number>(1);
  const [pushStatus, setPushStatus] = useState<"checking" | "subscribed" | "not-subscribed">("checking");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>("");

  // Theme control
  const { theme: rawTheme, setTheme } = useTheme();
  const [themeSelection, setThemeSelection] = useState<string>(() => rawTheme ?? "system");

  useEffect(() => {
    void (async () => {
      const status = await getPushSubscriptionStatus();
      if (!status.success) {
        setPushStatus("not-subscribed");
        return;
      }
      setPushStatus(status.subscribed ? "subscribed" : "not-subscribed");
    })();
  }, []);

  async function logout() {
    setBusy(true);
    setActionError("");
    try {
      localStorage.clear();
      router.replace("/login");
    } catch (e) {
      setActionError((e as Error).message || "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  function setThemeChoice(choice: "light" | "dark" | "system") {
    setTheme(choice);
    setThemeSelection(choice);
    try {
      localStorage.setItem("theme_choice", choice);
    } catch { }
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account? This will remove your user, contacts, and messages permanently.")) return;
    setBusy(true);
    setActionError("");
    try {
      const recoveryKeyHex = getRecoveryKeyFromStorage();
      if (!social_id) throw new Error("Missing social ID");

      const result = await deleteRemoteUser({ socialId: social_id, recoveryKeyHex });
      if (!result.success) {
        throw new Error(result.error || "Failed to delete remote user");
      }

      await clearClientState();
      router.replace("/login");
    } catch (e) {
      setActionError((e as Error).message || "Account deletion failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteData() {
    if (!window.confirm("Clear all contacts and messages for this account?")) return;
    setBusy(true);
    setActionError("");
    try {
      const recoveryKeyHex = getRecoveryKeyFromStorage();
      if (!social_id) throw new Error("Missing social ID");

      const result = await clearRemoteData({ socialId: social_id, recoveryKeyHex });
      if (!result.success) {
        throw new Error(result.error || "Failed to clear remote data");
      }

      clearLocalConversationData();
      alert("Contacts and messages cleared");
    } catch (e) {
      setActionError((e as Error).message || "Failed to delete local data");
    } finally {
      setBusy(false);
    }
  }

  function getRecoveryKeyFromStorage(): string {
    const stored = localStorage.getItem("recovery_key");
    const normalized = stored?.trim().toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      throw new Error("Missing valid recovery key in local storage");
    }
    return normalized;
  }

  async function clearClientState() {
    if (typeof window !== "undefined") {
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  }

  function clearLocalConversationData() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem("social_store_v1");
    window.sessionStorage.clear();
  }

  async function toggleNotifications() {
    const next = !notificationsEnabled;
    if (!social_id) {
      setActionError("Missing social ID");
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      const result = next
        ? await registerPushSubscription(social_id)
        : await unregisterPushSubscription(social_id);
      if (!result.success) {
        throw new Error(result.error || "Unable to update notifications");
      }

      setNotificationsEnabled(next);
      setPushStatus(next ? "subscribed" : "not-subscribed");
      localStorage.setItem("notify", next ? "1" : "0");
    } catch (e) {
      setActionError((e as Error).message || "Failed to update notifications");
    } finally {
      setBusy(false);
    }
  }

  async function refreshDevices() {
    // Best-effort: cannot reliably enumerate other devices; show placeholder
    setBusy(true);
    try {
      // For now, we assume only this device is active locally
      setDevicesCount(1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-[var(--space-6)] py-[var(--space-8)] md:px-[var(--space-10)] md:py-[var(--space-10)]">
      <div className="mx-auto max-w-5xl">
        <header className="grid grid-cols-12 items-end border-b border-[var(--color-border)] pb-[var(--space-6)]">
          <div className="col-span-12 md:col-span-2">
            <Link href="/" className="inline-flex items-center gap-2 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] transition-colors">
              <ChevronLeft size={16} /> Back
            </Link>
          </div>
          <div className="col-span-12 md:col-span-10 mt-[var(--space-4)] md:mt-0">
            <h1 className="text-[var(--font-size-hero)] font-bold uppercase tracking-wide">Settings</h1>
          </div>
        </header>

        {actionError ? (
          <div className="mt-[var(--space-6)] border-l-4 border-red-500 px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-meta)] text-red-600 dark:text-red-400">
            {actionError}
          </div>
        ) : null}

        <section className="mt-[var(--space-8)] space-y-[var(--space-8)]">
          <div className="grid grid-cols-12 gap-x-[var(--space-6)] gap-y-[var(--space-4)] border-b border-[var(--color-border)] pb-[var(--space-6)]">
            <div className="col-span-12 md:col-span-3 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)]">Identity</div>
            <div className="col-span-12 md:col-span-9">
              <div className="text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)]">Social ID</div>
              <div className="mt-[var(--space-2)] font-mono text-[var(--font-size-body)] break-all">{social_id}</div>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-x-[var(--space-6)] gap-y-[var(--space-4)] border-b border-[var(--color-border)] pb-[var(--space-6)]">
            <div className="col-span-12 md:col-span-3 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)]">Theme</div>
            <div className="col-span-12 md:col-span-9 flex flex-wrap gap-3">
              <button
                onClick={() => setThemeChoice("light")}
                className={`inline-flex items-center gap-2 border px-4 py-2 text-[var(--font-size-meta)] uppercase tracking-wide transition-colors ${themeSelection === "light" ? "border-[var(--color-fg-primary)] text-[var(--color-fg-primary)]" : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] hover:border-[var(--color-fg-muted)]"}`}
              >
                <Sun size={14} /> Light
              </button>
              <button
                onClick={() => setThemeChoice("dark")}
                className={`inline-flex items-center gap-2 border px-4 py-2 text-[var(--font-size-meta)] uppercase tracking-wide transition-colors ${themeSelection === "dark" ? "border-[var(--color-fg-primary)] text-[var(--color-fg-primary)]" : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] hover:border-[var(--color-fg-muted)]"}`}
              >
                <Moon size={14} /> Dark
              </button>
              <button
                onClick={() => setThemeChoice("system")}
                className={`border px-4 py-2 text-[var(--font-size-meta)] uppercase tracking-wide transition-colors ${themeSelection === "system" ? "border-[var(--color-fg-primary)] text-[var(--color-fg-primary)]" : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] hover:border-[var(--color-fg-muted)]"}`}
              >
                System
              </button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-x-[var(--space-6)] gap-y-[var(--space-4)] border-b border-[var(--color-border)] pb-[var(--space-6)]">
            <div className="col-span-12 md:col-span-3 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)]">Preferences</div>
            <div className="col-span-12 md:col-span-9 space-y-[var(--space-6)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell size={16} className="text-[var(--color-fg-muted)]" />
                  <div>
                    <div className="text-[var(--font-size-body)] font-semibold">Notifications</div>
                    <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)]">Push notifications</div>
                  </div>
                </div>
                <button
                  onClick={toggleNotifications}
                  className={clsx("w-16 border px-3 py-2 text-[var(--font-size-meta)] uppercase tracking-wide transition-colors", 
                  notificationsEnabled ? "border-[var(--color-fg-primary)] text-[var(--color-fg-primary)] bg-[var(--color-fg-primary)]" 
                  : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] hover:border-[var(--color-fg-muted)]"
                  )}
                >
                    <span className={notificationsEnabled ? "text-white dark:text-black" : "text-[var(--color-fg-muted)]"}>
                    {notificationsEnabled ? "On" : "Off"}
                    </span>
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Cloud size={16} className="text-[var(--color-fg-muted)]" />
                  <div>
                    <div className="text-[var(--font-size-body)] font-semibold">Connected Devices</div>
                    <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)]">{devicesCount} active device(s)</div>
                  </div>
                </div>
                <button
                  onClick={() => void refreshDevices()}
                  className="border border-[var(--color-border)] px-3 py-2 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] hover:border-[var(--color-fg-muted)] transition-colors"
                >
                  Refresh
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell size={16} className="text-[var(--color-fg-muted)]" />
                  <div>
                    <div className="text-[var(--font-size-body)] font-semibold">Push Status</div>
                    <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)]">
                      {pushStatus === "checking" ? "Checking..." : pushStatus === "subscribed" ? "Subscribed" : "Not subscribed"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-x-[var(--space-6)] gap-y-[var(--space-4)] border-b border-[var(--color-border)] pb-[var(--space-6)]">
            <div className="col-span-12 md:col-span-3 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)]">Account</div>
            <div className="col-span-12 md:col-span-9 grid grid-cols-1 gap-3 md:grid-cols-3">
              <button
                type="button"
                onClick={() => void logout()}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 border border-[var(--color-border)] px-4 py-3 text-[var(--font-size-meta)] uppercase tracking-wide hover:border-[var(--color-fg-muted)] transition-colors disabled:opacity-60"
              >
                <LogOut size={14} /> Logout
              </button>
              <button
                type="button"
                onClick={() => void deleteData()}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 border border-[var(--color-border)] px-4 py-3 text-[var(--font-size-meta)] uppercase tracking-wide hover:border-[var(--color-fg-muted)] transition-colors disabled:opacity-60"
              >
                <Trash2 size={14} /> Clear Data
              </button>
              <button
                type="button"
                onClick={() => void deleteAccount()}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 border border-red-500 px-4 py-3 text-[var(--font-size-meta)] uppercase tracking-wide text-red-600 dark:text-red-400 hover:border-red-400 transition-colors disabled:opacity-60"
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>

          {/* <div className="grid grid-cols-12 gap-x-[var(--space-6)] gap-y-[var(--space-4)]">
            <div className="col-span-12 md:col-span-3 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)]">More</div>
            <div className="col-span-12 md:col-span-9 grid grid-cols-1 md:grid-cols-3 gap-3">
              <Link href="/settings/privacy" className="border border-[var(--color-border)] px-4 py-3 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] hover:border-[var(--color-fg-muted)] transition-colors">
                Privacy
              </Link>
              <Link href="/settings/recovery" className="border border-[var(--color-border)] px-4 py-3 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] hover:border-[var(--color-fg-muted)] transition-colors">
                Recovery
              </Link>
              <Link href="/settings/backups" className="border border-[var(--color-border)] px-4 py-3 text-[var(--font-size-meta)] uppercase tracking-wide text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] hover:border-[var(--color-fg-muted)] transition-colors">
                Backups
              </Link>
            </div>
          </div> */}
        </section>
      </div>
    </main>
  );
}
