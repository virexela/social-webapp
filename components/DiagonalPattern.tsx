"use client";

import { motion } from "framer-motion";

interface DiagonalPatternProps {
  opacity?: number;
  animated?: boolean;
}

export function DiagonalPattern({ opacity = 0.03, animated = true }: DiagonalPatternProps) {
  if (animated) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="fixed inset-0 -z-10 pointer-events-none text-[var(--color-fg-primary)]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 18px,
            currentColor 18px,
            currentColor 20px
          )`,
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 -z-10 pointer-events-none text-[var(--color-fg-primary)]"
      style={{
        opacity,
        backgroundImage: `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 18px,
          currentColor 18px,
          currentColor 20px
        )`,
      }}
    />
  );
}
