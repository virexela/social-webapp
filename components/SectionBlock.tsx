"use client";

import React from "react";
import clsx from "clsx";

interface SectionBlockProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

export function SectionBlock({ label, children, className }: SectionBlockProps) {
  return (
    <div className={clsx("mb-[var(--section-gap)]", className)}>
      <h3 className="text-[var(--font-size-meta)] font-bold uppercase letter-spacing-[var(--letter-spacing-label)] text-[var(--color-fg-primary)] mb-4">
        {label}
      </h3>
      <div>{children}</div>
    </div>
  );
}
