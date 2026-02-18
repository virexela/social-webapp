"use client";

import React from "react";

export function ContactListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="px-[var(--space-6)] py-[var(--space-4)]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-[var(--space-4)] border-b border-[var(--color-border)]">
          <div className="w-12 h-12 rounded-full bg-[var(--color-border-strong)] animate-pulse" />
          <div className="flex-1">
            <div className="h-4 bg-[var(--color-border-strong)] rounded animate-pulse w-1/3 mb-2" />
            <div className="h-3 bg-[var(--color-border-strong)] rounded animate-pulse w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
