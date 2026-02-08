"use client";

import { motion, MotionProps } from "framer-motion";
import { forwardRef, ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps> {
  children?: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = "primary", size = "md", loading, className, disabled, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileHover={!disabled && !loading ? { scale: 1.02, y: -1 } : {}}
        whileTap={!disabled && !loading ? { scale: 0.98 } : {}}
        className={clsx(
          "inline-flex items-center justify-center gap-2 font-medium transition-all",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          {
            "bg-black text-white hover:bg-gray-800": variant === "primary" && !disabled,
            "bg-white text-black border border-black hover:bg-black hover:text-white":
              variant === "secondary" && !disabled,
            "bg-transparent text-black hover:bg-gray-100": variant === "ghost" && !disabled,
            "px-3 py-1.5 text-sm": size === "sm",
            "px-4 py-2 text-base": size === "md",
            "px-6 py-3 text-lg": size === "lg",
          },
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
          />
        )}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = "Button";
