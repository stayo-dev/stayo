import type { Metadata } from "next"
import { legalSections } from "@/content/legal"
import LegalNav from "@/components/legal/LegalNav"
import LegalSection from "@/components/legal/LegalSection"

export const metadata: Metadata = {
  title: "Legal & Policies | Sri Adithya Boys Hostel",
  description:
    "Terms & Conditions, Privacy Policy, and Refund Policy for Sri Adithya Boys Hostel.",
  alternates: {
    canonical: "https://sriadithyahostels.in/legal",
  },
  openGraph: {
    title: "Legal & Policies | Sri Adithya Boys Hostel",
    description:
      "Terms & Conditions, Privacy Policy, and Refund Policy for Sri Adithya Boys Hostel.",
    url: "https://sriadithyahostels.in/legal",
    siteName: "Sri Adithya Boys Hostel",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
}

const navItems = legalSections.map((s) => ({ id: s.id, title: s.title }))

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      {/* Page Header */}
      <header className="bg-slate-900 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20 text-center">
          <p className="text-indigo-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">
            Sri Adithya Boys Hostel
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Legal &amp; Policies
          </h1>
          <p className="mt-4 text-slate-400 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            Our commitment to transparency, privacy, and fair usage of the Sri
            Adithya Boys Hostel platform.
          </p>
          {/* Quick jump links for no-JS fallback */}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {navItems.map(({ id, title }) => (
              <a
                key={id}
                href={`#${id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm font-medium transition-colors border border-slate-700"
              >
                {title}
              </a>
            ))}
          </div>
        </div>
      </header>

      {/* Sticky Section Navigation */}
      <LegalNav sections={navItems} />

      {/* Main Content */}
      <main
        id="legal-content"
        className="max-w-3xl mx-auto px-4 sm:px-6 py-14 space-y-20"
      >
        {legalSections.map((section) => (
          <LegalSection key={section.id} section={section} />
        ))}
      </main>

      {/* Page Footer */}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} Sri Adithya Boys Hostel. All rights
            reserved.
          </p>
          <nav aria-label="Policy quick links" className="flex gap-5">
            {navItems.map(({ id, title }) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                {title}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  )
}
