import type { ReactNode } from "react";

import type { SeoPageSpec } from "@/src/services/seo/page-spec";
import { hubUrl, siteUrl } from "@/src/services/seo/seo-links";

/**
 * The chrome every indexable page shares: header, visible breadcrumbs, the
 * internal link clusters, and the footer.
 *
 * The breadcrumbs are rendered here AND emitted as `BreadcrumbList` JSON-LD by
 * the page — Google asks for both, and a breadcrumb trail in structured data
 * that does not appear on the page is the kind of mismatch that gets markup
 * ignored. Both come from the same `spec.breadcrumbs` array, so they cannot
 * disagree.
 *
 * The link clusters are what turn a set of pages into a graph. A hostel page
 * links up to its area and its colleges and across to its neighbours; an area
 * page links to its city, its siblings and its own filtered views. Every link
 * here has already been gated by the generator — a page that has not passed
 * its threshold is never linked to, because a link into a 404 is the same
 * defect as a sitemap entry for one. See ADR-226.
 */
export function SeoShell({ spec, children }: { spec: SeoPageSpec; children: ReactNode }) {
  const { parents, siblings, intents } = spec.links;

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href={siteUrl()}>
            Stayo
          </a>
          <a href={hubUrl()}>All hostels</a>
        </div>
      </header>

      <div className="wrap">
        {spec.breadcrumbs.length > 1 && (
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              {spec.breadcrumbs.map((crumb, index) => {
                const isCurrent = index === spec.breadcrumbs.length - 1;
                return (
                  <li key={crumb.url}>
                    {isCurrent ? (
                      <span aria-current="page">{crumb.name}</span>
                    ) : (
                      <a href={crumb.url}>{crumb.name}</a>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        <main>
          {children}

          {parents.length > 0 && (
            <section>
              <h2>Browse nearby</h2>
              <ul className="linkset">
                {parents.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {intents.length > 0 && (
            <section>
              <h2>Narrow it down</h2>
              <ul className="linkset">
                {intents.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {siblings.length > 0 && (
            <section>
              <h2>Other hostels nearby</h2>
              <ul className="linkset">
                {siblings.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>

      <footer className="site-footer">
        <div className="wrap">
          <ul className="footer-links">
            <li><a href={siteUrl()}>Home</a></li>
            <li><a href={hubUrl()}>All hostels</a></li>
            <li><a href={`${siteUrl()}/owners`}>List your hostel</a></li>
            <li><a href={`${siteUrl()}/about`}>About</a></li>
            <li><a href={`${siteUrl()}/contact`}>Contact</a></li>
            <li><a href={`${siteUrl()}/legal`}>Legal</a></li>
          </ul>
          <p>© {new Date().getFullYear()} Stayo</p>
        </div>
      </footer>
    </>
  );
}
