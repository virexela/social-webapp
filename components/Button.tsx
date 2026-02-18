"use client";

import { motion, MotionProps } from "framer-motion";
import Link from "next/link";
import type { Ref } from "react";
import { forwardRef, ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

type ButtonBaseProps = {
  children?: ReactNode;
  variant?: "primary" | "secondary";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
};

type ButtonAsButtonProps = ButtonBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps> & {
    href?: undefined;
  };

type ButtonAsLinkProps = ButtonBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof MotionProps | "href"> & {
    href: string;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  ({
    children,
    variant = "primary",
    loading,
    className,
    disabled,
    fullWidth = false,
    ...props
  }, ref) => {
    const isPrimary = variant === "primary" && !disabled;
    const isSecondary = variant === "secondary" && !disabled;

    const sharedClassName = clsx(
      "inline-flex items-center justify-center gap-3",
      "h-[var(--button-height)] px-[var(--button-padding-x)]",
      "font-bold text-[var(--font-size-body)] uppercase",
      "transition-colors duration-[var(--transition-base)]",
      "disabled:text-[var(--color-fg-muted)] disabled:cursor-not-allowed",
      {
        "w-full": fullWidth,
      },
      // Primary variant
      isPrimary && "bg-[var(--color-fg-primary)] text-[var(--color-interactive-inverse)] border-[1px] border-[var(--color-interactive-inverse)]",
      isPrimary && "hover:bg-[var(--color-interactive-inverse)] hover:text-[var(--color-fg-primary)]",
      isPrimary && "active:border-2 active:border-[var(--color-fg-primary)]",
      // Secondary variant
      isSecondary && "bg-transparent text-[var(--color-fg-primary)] border border-[var(--color-border-strong)]",
      isSecondary && "hover:bg-[var(--color-fg-primary)] hover:text-[var(--color-interactive-inverse)]",
      isSecondary && "active:border-2 active:border-[var(--color-fg-primary)]",
      className
    );

    const isInteractive = !disabled && !loading;

    if ("href" in props && typeof props.href === "string") {
      const { href, onClick, ...rest } = props as ButtonAsLinkProps;
      return (
        <Link href={href} legacyBehavior>
          <motion.a
            ref={ref as Ref<HTMLAnchorElement>}
            initial={{ opacity: 1 }}
            whileHover={isInteractive ? { opacity: 0.8 } : {}}
            className={sharedClassName}
            style={isPrimary ? { color: "var(--color-interactive-inverse)" } : undefined}
            aria-disabled={disabled || loading ? true : undefined}
            tabIndex={disabled || loading ? -1 : rest.tabIndex}
            onClick={(e) => {
              if (disabled || loading) {
                e.preventDefault();
                return;
              }
              onClick?.(e);
            }}
            {...rest}
          >
            {loading && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-4 h-4 border-2 border-current border-t-transparent"
              />
            )}
            {children}
          </motion.a>
        </Link>
      );
    }

    return (
      <motion.button
        ref={ref as Ref<HTMLButtonElement>}
        initial={{ opacity: 1 }}
        whileHover={isInteractive ? { opacity: 0.8 } : {}}
        className={sharedClassName}
        style={isPrimary ? { color: "var(--color-interactive-inverse)" } : undefined}
        disabled={disabled || loading}
        {...(props as ButtonAsButtonProps)}
      >
        {loading && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-4 h-4 border-2 border-current border-t-transparent"
          />
        )}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = "Button";
