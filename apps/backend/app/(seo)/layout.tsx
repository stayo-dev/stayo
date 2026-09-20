import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";

import "./seo.css";
import { frontendUrl } from "@/lib/config/domains";

/**
 * The root layout for Stayo's indexable pages.
 *
 * WHY THIS IS A SECOND ROOT LAYOUT, SEPARATE FROM `app/(app)/layout.tsx`:
 * that layout wraps everything in `Providers`, a `"use client"` component
 * whose effect redirects any path outside `["/login", "/register", "/"]` to
 * `/login`. A public hostel page rendered under it would arrive with correct
 * HTML and then bounce — for a person and for Googlebot, which renders JS.
 * Route groups do not appear in a URL, so `(app)` and `(seo)` are two roots
 * over one `app/` tree and no path changed when this split landed. See
 * ADR-224.
 *
 * Nothing here is a client component: no auth, no React Query, no theme
 * provider. These pages are read, not operated. Anything interactive lives on
 * the SPA and is linked to.
 */

// Self-hosted at build time by `next/font`, so an indexable page costs no DNS
// lookup, no round trip to fonts.googleapis.com and no layout shift waiting
// for one. The SPA still uses <link> tags; this tree does not share its head.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

/**
 * `metadataBase` is what lets every page below hand Next a relative canonical
 * and still emit an absolute URL. It must be the PUBLIC origin
 * (`yourstayo.com`), never this backend's own host — these pages are reached
 * through a rewrite from the frontend project, and a canonical pointing at
 * `api.yourstayo.com` would hand Google the wrong address for every hostel.
 */
export const metadata: Metadata = {
  metadataBase: new URL(frontendUrl()),
  title: {
    default: "Stayo",
    template: "%s",
  },
};

export default function SeoRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
