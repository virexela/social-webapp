"use client";

import clsx from "clsx";

interface RecoveryKeyDisplayProps {
  words: string[];
  columns?: number;
  monospace?: boolean;
}

export function RecoveryKeyDisplay({ words, columns = 4, monospace = false }: RecoveryKeyDisplayProps) {
  return (
    <div
      className="grid gap-0 border border-[var(--color-border)]"
      style={{
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
      }}
    >
      {words.map((word, idx) => (
        <div
          key={idx}
          className={clsx(
            "p-3 text-center border-r border-b border-[var(--color-border)]",
            "last-of-type:border-r-0",
            "text-[var(--font-size-body)] text-[var(--color-fg-primary)]",
            "bg-transparent hover:bg-[rgba(255,255,255,0.02)]",
            { "font-mono": monospace }
          )}
          style={{
            borderRightColor: idx % columns === columns - 1 ? "transparent" : "var(--color-border)",
            borderBottomColor:
              Math.floor(idx / columns) === Math.floor((words.length - 1) / columns)
                ? "transparent"
                : "var(--color-border)",
          }}
        >
          {word}
        </div>
      ))}
    </div>
  );
}
