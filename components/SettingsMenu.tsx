"use client";

import React from "react";
import { Settings } from "lucide-react";
import { useRouter } from "next/navigation";

export function SettingsMenu() {
  const router = useRouter();

  function openSettings() {
    router.push("/settings");
  }

  return (
    <div className="relative">
      <button
        aria-label="Settings"
        title="Settings"
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        onClick={() => openSettings()}
      >
        <Settings size={20} />
      </button>
    </div>
  );
}
