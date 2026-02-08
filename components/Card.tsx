"use client";

import { motion, HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";
import clsx from "clsx";

interface CardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  hover?: boolean;
  className?: string;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ children, hover = true, className, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        whileHover={hover ? { y: -2, boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)" } : {}}
        className={clsx(
          "bg-white border border-gray-200 p-6 transition-all",
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = "Card";
