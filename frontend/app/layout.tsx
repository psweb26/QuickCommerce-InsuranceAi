import type { Metadata } from "next";
import Link from "next/link";
import { Sora, Space_Grotesk } from "next/font/google";
import "leaflet/dist/leaflet.css";

import "./globals.css";
import { AnimatedBackdrop } from "@/components/AnimatedBackdrop";

const headingFont = Sora({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["400", "600", "700", "800"],
});

const bodyFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "GigProtect AI",
  description: "AI-powered parametric insurance for quick-commerce delivery workers",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body>
        <AnimatedBackdrop />
        <div className="grid-overlay min-h-screen">
          <header className="sticky top-0 z-30 border-b border-white/70 bg-white/65 backdrop-blur-xl">
            <nav className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Link
                  href="/"
                  className="text-xl font-extrabold tracking-tight text-gradient"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  GigProtect AI
                </Link>
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Secure: Market Crash v1.0 Compliant
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700 md:gap-3">
                <Link href="/worker" className="rounded-full px-3 py-2 transition hover:bg-white/80 md:px-4">
                  Worker Console
                </Link>
                <Link href="/worker/claims" className="rounded-full px-3 py-2 transition hover:bg-white/80 md:px-4">
                  Claims
                </Link>
                <Link
                  href="/worker/disruptions"
                  className="rounded-full px-3 py-2 transition hover:bg-white/80 md:px-4"
                >
                  Disruptions
                </Link>
                <Link
                  href="/admin"
                  className="rounded-full bg-ocean px-3 py-2 text-white transition hover:bg-slate-700 md:px-4"
                >
                  Admin Command Center
                </Link>
              </div>
            </nav>
          </header>

          <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
