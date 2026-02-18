"use client";

import { InputHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  error?: string;
  variant?: "underline" | "outline";
  type?: "text" | "password" | "email" | "number";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, variant = "underline", className, type = "text", ...props }, ref) => {
    const inputClass = clsx(
      "w-full font-[var(--font-family-base)] text-[var(--font-size-body)]",
      "bg-transparent text-[var(--color-fg-primary)] outline-none",
      "placeholder:text-[var(--color-fg-muted)]",
      "transition-colors duration-[var(--transition-base)]",
      {
        "h-[var(--input-height)] px-0 py-2 border-b border-[var(--color-border)]":
          variant === "underline",
        "focus:border-b-[var(--color-border-strong)]": variant === "underline",
        "h-[var(--input-height)] px-3 py-2 border border-[var(--color-border)]":
          variant === "outline",
        "focus:border-[var(--color-border-strong)]": variant === "outline",
        "border-[var(--color-fg-primary)] focus:border-[var(--color-fg-primary)]": error,
      },
      className
    );

    return (
      <div className="w-full">
        {label && (
          <label className="block text-[var(--font-size-meta)] font-bold uppercase letter-spacing-[var(--letter-spacing-label)] text-[var(--color-fg-primary)] mb-2">
            {label}
          </label>
        )}
        <input ref={ref} type={type} className={inputClass} {...props} />
        {error && (
          <div className="mt-1 text-[var(--font-size-meta)] text-[var(--color-fg-secondary)]">
            {error}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
