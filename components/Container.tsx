import { ReactNode } from "react";
import clsx from "clsx";

interface ContainerProps {
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function Container({ children, size = "lg", className }: ContainerProps) {
  return (
    <div
      className={clsx(
        "mx-auto px-4 sm:px-6 lg:px-8 w-full",
        {
          "max-w-3xl": size === "sm",
          "max-w-5xl": size === "md",
          "max-w-7xl": size === "lg",
          "max-w-[1400px]": size === "xl",
        },
        className
      )}
    >
      {children}
    </div>
  );
}
