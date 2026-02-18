"use client";

import { motion } from "framer-motion";
import React from "react";
import clsx from "clsx";

interface ListItemProps {
  title: string;
  subtitle?: string;
  onClick?: () => void;
  variant?: "button" | "text";
  children?: React.ReactNode;
}

export function ListItem({ title, subtitle, onClick, variant = "button", children }: ListItemProps) {
  const content = (
    <>
      <div className="flex-1 text-left min-w-0">
        <div className="text-[var(--font-size-body)] font-bold uppercase text-[var(--color-fg-primary)]">
          {title}
        </div>
        {subtitle && (
          <div className="text-[var(--font-size-meta)] uppercase letter-spacing-[var(--letter-spacing-label)] text-[var(--color-fg-muted)] mt-1">
            {subtitle}
          </div>
        )}
      </div>
      {children && <div>{children}</div>}
    </>
  );

  if (variant === "button" && onClick) {
    return (
      <motion.button
        onClick={onClick}
        className={clsx(
          "w-full flex items-center gap-4 py-[var(--space-4)] px-0",
          "border-b border-[var(--color-border)]",
          "transition-colors duration-[var(--transition-base)]",
          "hover:bg-[rgba(255,255,255,0.04)]",
          "active:bg-[rgba(255,255,255,0.08)]",
          "text-left"
        )}
        whileHover={{ opacity: 0.9 }}
      >
        {content}
      </motion.button>
    );
  }

  return (
    <div className={clsx("w-full flex items-center gap-4 py-[var(--space-4)] px-0", "border-b border-[var(--color-border)]")}>
      {content}
    </div>
  );
}
