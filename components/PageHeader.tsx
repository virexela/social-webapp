"use client";

import clsx from "clsx";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  divider?: boolean;
}

export function PageHeader({ title, subtitle, onBack, divider = false }: PageHeaderProps) {
  return (
    <div className={clsx("mb-[var(--space-6)]", { "pb-[var(--space-6)]": divider, "border-b border-[var(--color-border)]": divider })}>
      {onBack && (
        <button
          onClick={onBack}
          className="text-[var(--font-size-body)] text-[var(--color-fg-secondary)] hover:text-[var(--color-fg-primary)] transition-colors mb-4"
        >
          ← BACK
        </button>
      )}
      <h1 className="text-[var(--font-size-hero)] font-bold uppercase text-[var(--color-fg-primary)] mb-2">
        {title}
      </h1>
      {subtitle && (
        <p className="text-[var(--font-size-body)] text-[var(--color-fg-secondary)] max-w-[var(--content-max-width)]">
          {subtitle}
        </p>
      )}
    </div>
  );
}
