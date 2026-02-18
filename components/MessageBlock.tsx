"use client";

import { motion } from "framer-motion";
import clsx from "clsx";

interface MessageBlockProps {
  content: string;
  timestamp: string;
  isOwn: boolean;
  status?: "sending" | "sent" | "failed";
}

export function MessageBlock({ content, timestamp, isOwn, status }: MessageBlockProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 120, type: "tween" }}
      className={clsx("flex w-full gap-[var(--message-gap)]", {
        "justify-end": isOwn,
        "justify-start": !isOwn,
      })}
    >
      <div
        className={clsx("max-w-[var(--chat-max-width)] text-left", {
          "text-right": isOwn,
        })}
      >
        <div className="text-[var(--font-size-body)] text-[var(--color-fg-primary)] py-[var(--message-padding-y)] border-b border-[var(--color-border)]">
          {content}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[var(--font-size-meta)] text-[var(--color-fg-muted)]">
          <span>{timestamp}</span>
          {isOwn && status && (
            <span className={clsx("text-[10px]", { "text-red-400": status === "failed" })}>
              {status === "sending" ? "Sending" : status === "failed" ? "Failed" : "Sent"}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
