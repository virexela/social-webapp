"use client";

import React, { useRef, useEffect } from "react";
import { motion } from "framer-motion";

interface ActionStripProps {
  onSelect: (action: "send" | "accept") => void;
  onClose?: () => void;
}

export function ActionStrip({ onSelect, onClose }: ActionStripProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose?.();
      if (e.key === "ArrowLeft") onSelect("send");
      if (e.key === "ArrowRight") onSelect("accept");
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect, onClose]);

  function handleTap(e: React.MouseEvent | React.TouchEvent) {
    // determine which half was tapped
    const clientX = (e as React.TouchEvent).changedTouches ? (e as React.TouchEvent).changedTouches[0].clientX : (e as React.MouseEvent).clientX;
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const isLeft = clientX - rect.left < rect.width / 2;
    onSelect(isLeft ? "send" : "accept");
    onClose?.();
  }

  return (
    <div className="md:hidden fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={() => onClose?.()} aria-hidden />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.92 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="w-full max-w-md mx-4 mb-4"
      >
        <div
          ref={ref}
          onClick={(e) => handleTap(e)}
          onTouchEnd={(e) => handleTap(e)}
          className="relative rounded-lg overflow-hidden shadow-lg border border-[var(--color-border)] flex select-none"
          role="dialog"
          aria-label="Choose add contact action"
        >
          <button
            type="button"
            onClick={() => {
              onSelect("send");
              onClose?.();
            }}
            className="w-1/2 bg-black text-white px-5 py-4 flex items-center justify-center"
          >
            <div className="text-sm font-semibold">Send</div>
          </button>

          <button
            type="button"
            onClick={() => {
              onSelect("accept");
              onClose?.();
            }}
            className="w-1/2 bg-white text-black px-5 py-4 flex items-center justify-center"
          >
            <div className="text-sm font-semibold">Accept</div>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
