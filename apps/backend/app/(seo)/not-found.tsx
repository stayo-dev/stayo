import type { Metadata } from "next";

import { hubUrl, siteUrl } from "@/src/services/seo/seo-links";

/**
 * The 404 for the indexable tree.
 *
 * `noindex, follow`: a page that does not exist must not be indexed, but its
 * links should still be crawled so a reader (and a crawler) that landed on a
 * retired or gated URL is carried back into the live graph.
 *
 * This is what a collection page below its content threshold renders. That is
 * deliberate — see `thresholds.ts`: not existing is cheaper and more honest
 * than existing and asking to be ignored.
 */
export const metadata: Metadata = {
  title: "Page not found | Stayo",
  robots: { index: false, follow: true },
};

export default function SeoNotFound() {
  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href={siteUrl()}>Stayo</a>
        </div>
      </header>

      <div className="wrap">
        <main>
          <section className="hero">
            <h1>We couldn&rsquo;t find that page</h1>
            <p className="lede">
              The hostel may have been taken off Stayo, or the link may be out of date.
            </p>
            <a className="cta" href={hubUrl()}>Browse hostels on Stayo</a>
          </section>
        </main>
      </div>
    </>
  );
}
