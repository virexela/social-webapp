"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { motion } from "framer-motion";

interface ContactListItemProps {
  id: string;
  name: string;
  subtitle?: string;
  time?: string;
  online?: boolean;
  onClick?: () => void;
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ContactListItem({ id, name, subtitle, time, online = false, onClick }: ContactListItemProps) {
  return (
    <motion.button
      data-contact-id={id}
      onClick={onClick}
      whileHover={{ x: 4 }}
      className={clsx(
        "w-full flex items-center gap-4 py-[var(--space-4)] px-[var(--space-6)]",
        "border-b border-[var(--color-border)]",
        "text-left transition-colors duration-[var(--transition-base)] hover:bg-[rgba(255,255,255,0.02)] active:bg-[rgba(255,255,255,0.04)]"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-[var(--color-border-strong)] flex items-center justify-center font-bold text-[var(--font-size-body)] text-[var(--color-fg-primary)]">{initials(name)}</div>
          <div
            className={clsx(
              "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--color-bg)]",
              online ? "bg-[var(--color-success)]" : "bg-[var(--color-border-strong)]"
            )}
            aria-hidden
          />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-4">
          <div className="text-[var(--font-size-body)] lg:text-sm font-bold uppercase text-[var(--color-fg-primary)] truncate">{name}</div>
          {time && <div className="text-[var(--font-size-meta)] lg:text-xs text-[var(--color-fg-muted)] uppercase">{time}</div>}
        </div>
        {subtitle && <div className="text-[var(--font-size-meta)] lg:text-xs uppercase letter-spacing-[var(--letter-spacing-label)] text-[var(--color-fg-muted)] mt-1 truncate">{subtitle}</div>}
      </div>

      <ChevronRight size={18} className="text-[var(--color-fg-muted)]" />
    </motion.button>
  );
}
