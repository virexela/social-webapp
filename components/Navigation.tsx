"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Home, Settings, UserPlus } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import clsx from "clsx";

export function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: "/", label: "New chat", icon: UserPlus },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <Logo size={64} animated={false} />
            <span className="text-xl font-medium tracking-tight transition-opacity group-hover:opacity-70">
              SOCIAL
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-1">
            {links.map((link) => {
              const isActive = pathname === link.href;
              const Icon = link.icon;
              
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    "relative px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2",
                    isActive
                      ? "text-black dark:text-white"
                      : "text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white"
                  )}
                >
                  <Icon size={16} />
                  <span className="hidden sm:inline">{link.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-black dark:bg-white"
                      initial={false}
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                </Link>
              );
            })}

            <div className="ml-1">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </motion.nav>
  );
}
