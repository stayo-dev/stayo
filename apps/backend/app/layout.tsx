import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { Providers } from "@/lib/providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sunrise Residency",
  description: "Modern hostel management platform for Sunrise Residency.",
  alternates: {
    canonical: "https://example-hostel.in/",
  },
  openGraph: {
    title: "Sunrise Residency",
    description: "Modern hostel management platform for Sunrise Residency.",
    url: "https://example-hostel.in/",
    siteName: "Sunrise Residency",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sunrise Residency",
    description: "Modern hostel management platform for Sunrise Residency.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
