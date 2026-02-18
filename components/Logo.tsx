"use client";

import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

interface LogoProps {
  size?: number;
  animated?: boolean;
}

export function Logo({ size = 128, animated = true }: LogoProps) {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const className = `object-contain ${mounted && theme === 'light' ? 'filter invert' : ''}`;

  return (
    <motion.img
      src="/logo.png"
      alt="Social Logo"
      width={size}
      height={size}
      className={className}
      initial={animated ? { opacity: 0, scale: 0.8 } : {}}
      animate={animated ? { opacity: 1, scale: 1 } : {}}
      transition={animated ? { duration: 0.5, ease: "easeOut" } : {}}
    />
  );
}
