export default function SettingsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-zinc-600">
        Backup export/import UX will live here. Recovery keys must not be stored
        in React state.
      </p>
    </main>
  );
}
