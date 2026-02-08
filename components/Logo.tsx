"use client";

import { motion } from "framer-motion";

interface LogoProps {
  size?: number;
  animated?: boolean;
}

export function Logo({ size = 48, animated = true }: LogoProps) {
  const lines = [
    { x1: 8, y1: 8, x2: 24, y2: 24 },
    { x1: 12, y1: 8, x2: 28, y2: 24 },
    { x1: 16, y1: 8, x2: 32, y2: 24 },
    { x1: 20, y1: 8, x2: 36, y2: 24 },
    { x1: 24, y1: 8, x2: 40, y2: 24 },
    { x1: 8, y1: 24, x2: 24, y2: 40 },
    { x1: 12, y1: 24, x2: 28, y2: 40 },
    { x1: 16, y1: 24, x2: 32, y2: 40 },
    { x1: 20, y1: 24, x2: 36, y2: 40 },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-black"
    >
      {lines.map((line, i) =>
        animated ? (
          <motion.line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{
              duration: 0.5,
              delay: i * 0.05,
              ease: "easeOut",
            }}
          />
        ) : (
          <line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )
      )}
    </svg>
  );
}
