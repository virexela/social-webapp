"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getCrypto } from "@/lib/crypto";
import { idbClear } from "@/lib/storage/db";
import { useRouter } from "next/navigation";
import { Copy, LogOut, Trash2, Cloud, Bell, ChevronLeft, User, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSocialStore } from "@/lib/state/store";

export default function SettingsPage() {
  const router = useRouter();
  const [publicBundleHex, setPublicBundleHex] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>(() => {
    try {
      return localStorage.getItem("display_name") ?? "";
    } catch {
      return "";
    }
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("notify") === "1";
    } catch {
      return false;
    }
  });
  const [cloudBackup, setCloudBackup] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cloud_backup") === "1";
    } catch {
      return false;
    }
  });
  const [devicesCount, setDevicesCount] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>("");

  const clearAllData = useSocialStore((s) => s.clearAllData);

  // Theme control
  const { theme: rawTheme, setTheme } = useTheme();
  const [themeSelection, setThemeSelection] = useState<string>(() => rawTheme ?? "system");

  useEffect(() => {
    void (async () => {
      try {
        const pb = await getCrypto().export_public_bundle();
        // show a short hex for identification
        const hex = Array.from(pb.slice(0, 8))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        setPublicBundleHex(hex);
      } catch {
        // ignore
      }
    })();
  }, []);

  async function doLogout() {
    setBusy(true);
    setActionError("");
    try {
      await clearClientState();
      router.replace("/login");
    } catch (e) {
      setActionError((e as Error).message || "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  function saveDisplayName(name: string) {
    setDisplayName(name);
    try {
      localStorage.setItem("display_name", name);
    } catch {}
  }

  function setThemeChoice(choice: "light" | "dark" | "system") {
    setTheme(choice);
    setThemeSelection(choice);
    try {
      localStorage.setItem("theme_choice", choice);
    } catch {}
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account? This will remove your local identity and cannot be undone.")) return;
    setBusy(true);
    setActionError("");
    try {
      await clearClientState();
      router.replace("/login");
    } catch (e) {
      setActionError((e as Error).message || "Account deletion failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteData() {
    if (!window.confirm("Delete local app data? This will remove messages and local caches.")) return;
    setBusy(true);
    setActionError("");
    try {
      await clearClientState();
      alert("Local data deleted");
    } catch (e) {
      setActionError((e as Error).message || "Failed to delete local data");
    } finally {
      setBusy(false);
    }
  }

  async function clearClientState(): Promise<void> {
    const cryptoBridge = getCrypto();

    const tasks: Promise<unknown>[] = [
      idbClear("keyblobs"),
      cryptoBridge.reset_runtime(),
    ];

    tasks.push(
      Promise.resolve().then(() => {
        if (typeof window !== "undefined") {
          window.localStorage.clear();
          window.sessionStorage.clear();
        }
      })
    );

    const results = await Promise.allSettled(tasks);
    clearAllData();

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const firstFailure = failures[0] as PromiseRejectedResult;
      const message =
        firstFailure.reason instanceof Error
          ? firstFailure.reason.message
          : "Failed to fully clear local state";
      throw new Error(message);
    }
  }

  function toggleNotifications() {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    try {
      localStorage.setItem("notify", next ? "1" : "0");
    } catch {}
  }

  function toggleCloud() {
    const next = !cloudBackup;
    setCloudBackup(next);
    try {
      localStorage.setItem("cloud_backup", next ? "1" : "0");
    } catch {}
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
    <main className="min-h-screen bg-[var(--color-bg)] p-[var(--space-6)]">
      <div className="mx-auto max-w-3xl space-y-[var(--space-9)]">
        <div className="border-b border-[var(--color-border)] pb-[var(--space-4)] flex items-center gap-4">
          <Link href="/" className="p-2 rounded hover:bg-[rgba(255,255,255,0.03)] transition-colors flex items-center">
            <ChevronLeft size={18} />
          </Link>
          <div className="flex-1">
            <h1 className="text-[var(--font-size-hero)] font-bold uppercase">Settings</h1>
            <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)] mt-1">Manage your profile, privacy and backups</div>
          </div>
        </div>
        {actionError ? (
          <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        ) : null}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded-lg overflow-hidden">
            <div className="px-[var(--space-6)] py-[var(--space-6)] flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-[var(--color-border-strong)] flex items-center justify-center font-bold text-[var(--font-size-body)]">
                {displayName ? (
                  <div className="uppercase truncate">{displayName.slice(0, 2)}</div>
                ) : (
                  <User size={20} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold uppercase text-[var(--font-size-body)]">{displayName || "Your profile"}</div>
                <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)] mt-1">ID: {publicBundleHex ?? "—"}</div>
                <div className="mt-3 flex gap-3">
                  <input
                    value={displayName}
                    onChange={(e) => saveDisplayName(e.target.value)}
                    placeholder="Display name"
                    className="px-3 py-2 bg-transparent border border-[var(--color-border)] rounded w-full text-[var(--color-fg-primary)]"
                  />
                </div>
              </div>
              <button
                className="p-2 text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)] transition-colors"
                onClick={() => {
                  if (!publicBundleHex) return;
                  try {
                    navigator.clipboard.writeText(publicBundleHex);
                  } catch {}
                }}
              >
                <Copy size={16} />
              </button>
            </div>

            <div className="px-[var(--space-6)] py-[var(--space-4)] border-t border-[var(--color-border)]">
              <div className="text-[var(--font-size-body)] text-[var(--color-fg-muted)]">Profile details are stored locally in your device. Use recovery to restore on another device.</div>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="px-[var(--space-6)] py-[var(--space-6)]">
              <div className="font-bold uppercase text-[var(--font-size-body)]">Preferences</div>
              <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)] mt-1">Control app behaviour and backups.</div>
            </div>

            <div className="px-[var(--space-6)] py-[var(--space-4)] space-y-4 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell size={18} />
                  <div>
                    <div className="font-semibold uppercase text-[var(--font-size-body)]">Notifications</div>
                    <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)]">Enable or disable notifications.</div>
                  </div>
                </div>
                <div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={notificationsEnabled} className="sr-only" onChange={toggleNotifications} />
                    <span className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-[var(--color-fg-primary)] inline-block" />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Cloud size={18} />
                  <div>
                    <div className="font-semibold uppercase text-[var(--font-size-body)]">Cloud backup</div>
                    <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)]">Store backups on cloud for multi-device restore.</div>
                  </div>
                </div>
                <div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={cloudBackup} className="sr-only" onChange={toggleCloud} />
                    <span className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-[var(--color-fg-primary)] inline-block" />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="font-semibold uppercase text-[var(--font-size-body)]">Connected devices</div>
                  <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)]">Number of devices linked to this account.</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-[var(--font-size-body)] font-bold">{devicesCount}</div>
                  <button onClick={() => void refreshDevices()} className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg-primary)]">Refresh</button>
                </div>
              </div>

              <div className="border-t border-[var(--color-border)] pt-4">
                <div className="font-semibold uppercase text-[var(--font-size-body)] mb-3">Theme</div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setThemeChoice("light")}
                    className={`px-3 py-2 rounded-md border transition-colors ${themeSelection === "light" ? "border-[var(--color-fg-primary)] bg-[rgba(255,255,255,0.02)]" : "border-[var(--color-border)]"}`}
                  >
                    <div className="flex items-center gap-2"><Sun size={16} /> Light</div>
                  </button>

                  <button
                    onClick={() => setThemeChoice("dark")}
                    className={`px-3 py-2 rounded-md border transition-colors ${themeSelection === "dark" ? "border-[var(--color-fg-primary)] bg-[rgba(255,255,255,0.02)]" : "border-[var(--color-border)]"}`}
                  >
                    <div className="flex items-center gap-2"><Moon size={16} /> Dark</div>
                  </button>

                  <button
                    onClick={() => setThemeChoice("system")}
                    className={`px-3 py-2 rounded-md border transition-colors ${themeSelection === "system" ? "border-[var(--color-fg-primary)] bg-[rgba(255,255,255,0.02)]" : "border-[var(--color-border)]"}`}
                  >
                    System
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 border rounded-lg overflow-hidden">
            <div className="px-[var(--space-6)] py-[var(--space-6)]">
              <div className="font-bold uppercase text-[var(--font-size-body)]">Account & Data</div>
              <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)] mt-1">Manage local data, logout or delete your account.</div>
            </div>

            <div className="px-[var(--space-6)] py-[var(--space-4)] space-y-3 border-t border-[var(--color-border)]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => void doLogout()}
                  disabled={busy}
                  className="w-full flex items-center gap-2 justify-center px-4 py-3 text-sm bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800"
                >
                  <LogOut size={18} /> Logout
                </button>

                <button
                  type="button"
                  onClick={() => void deleteData()}
                  disabled={busy}
                  className="w-full flex items-center gap-2 justify-center px-4 py-3 text-sm bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800"
                >
                  <Trash2 size={18} /> Delete local data
                </button>

                <button
                  type="button"
                  onClick={() => void deleteAccount()}
                  disabled={busy}
                  className="w-full flex items-center gap-2 justify-center px-4 py-3 text-sm text-red-600 bg-white dark:bg-gray-900 hover:bg-red-50 dark:hover:bg-red-900 border border-gray-200 dark:border-gray-800"
                >
                  <Trash2 size={18} /> Delete account
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4">
          <div className="text-[var(--font-size-meta)] text-[var(--color-fg-muted)]">More settings are available in the sub-pages below.</div>
          <div className="mt-3 space-y-2">
            <Link href="/settings/privacy" className="block text-[var(--color-fg-primary)]">Privacy</Link>
            <Link href="/settings/recovery" className="block text-[var(--color-fg-primary)]">Recovery</Link>
            <Link href="/settings/backups" className="block text-[var(--color-fg-primary)]">Backups</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
