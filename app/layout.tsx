import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PwaBootstrap, ThemeProvider } from "@/components";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SOCIAL — Encrypted Communication",
  description: "Secure messaging platform with end-to-end encryption",
  manifest: "/manifest.webmanifest",
  applicationName: "SOCIAL",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SOCIAL",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icon-192.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0f17",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <PwaBootstrap />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
