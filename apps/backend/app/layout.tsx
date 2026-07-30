import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { Providers } from "@/lib/providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sri Adithya Boys Hostel",
  description: "Modern hostel management platform for Sri Adithya Boys Hostel.",
  alternates: {
    canonical: "https://sriadithyahostels.in/",
  },
  openGraph: {
    title: "Sri Adithya Boys Hostel",
    description: "Modern hostel management platform for Sri Adithya Boys Hostel.",
    url: "https://sriadithyahostels.in/",
    siteName: "Sri Adithya Boys Hostel",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sri Adithya Boys Hostel",
    description: "Modern hostel management platform for Sri Adithya Boys Hostel.",
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
