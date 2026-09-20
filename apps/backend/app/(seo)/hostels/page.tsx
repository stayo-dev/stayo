import type { Metadata } from "next";

import { loadHubListings } from "@/src/services/seo/seo-service";
import { breadcrumbList, organisation, serialiseJsonLd, itemListNode } from "@/src/services/seo/jsonld";
import { hostelUrl, hubUrl, siteUrl } from "@/src/services/seo/seo-links";
import { priceLabel, sharingLabel } from "@/src/services/seo/copy";

export const revalidate = 3600;

/**
 * The crawlable root of the engine.
 *
 * It exists so the hostel pages are reachable by following links, not only by
 * reading the sitemap. The SPA homepage is client-rendered, so a crawler that
 * lands on `yourstayo.com` sees no listings at all; this page is the bridge
 * from there into the indexable tree, and it is what the SPA footer links to.
 *
 * Once locality and college pages pass their thresholds they become the better
 * subdivisions and this becomes an index of those instead. See ADR-226.
 */

const TITLE = "Hostels and PGs on Stayo — verified, with real prices";
const DESCRIPTION =
  "Every hostel and PG listed on Stayo, with the rent its owner advertises, the sharing options available and whether beds are free right now.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: hubUrl() },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Stayo",
    title: TITLE,
    description: DESCRIPTION,
    url: hubUrl(),
    locale: "en_IN",
  },
};

export default async function HostelsHubPage() {
  const listings = await loadHubListings().catch(() => []);

  const crumbs = [
    { name: "Stayo", url: siteUrl() },
    { name: "Hostels", url: hubUrl() },
  ];

  const jsonLd = [
    organisation(siteUrl()),
    breadcrumbList(crumbs),
    itemListNode(
      listings.map((listing) => ({
        slug: listing.slug,
        name: listing.name,
        areaName: null,
        city: listing.city,
        hostelType: listing.hostelType,
        startingPrice: listing.startingPrice,
        sharing: listing.sharing,
        foodIncluded: listing.foodIncluded,
        photo: listing.photo,
        vacantBeds: listing.vacantBeds,
        availabilityConfirmed: true,
      })),
    ),
  ];

  return (
    <>
      {serialiseJsonLd(jsonLd).map((json, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      ))}

      <header className="site-header">
        <div className="wrap">
          <a className="brand" href={siteUrl()}>Stayo</a>
          <a href={`${siteUrl()}/owners`}>List your hostel</a>
        </div>
      </header>

      <div className="wrap">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><a href={siteUrl()}>Stayo</a></li>
            <li><span aria-current="page">Hostels</span></li>
          </ol>
        </nav>

        <main>
          <section className="hero">
            <h1>Hostels and PGs on Stayo</h1>
            <p className="lede">{DESCRIPTION}</p>
          </section>

          <section>
            <h2>
              {listings.length === 0
                ? "No hostels listed yet"
                : `${listings.length} verified ${listings.length === 1 ? "hostel" : "hostels"}`}
            </h2>

            {/* No placeholder cards. A listing that does not exist is not drawn
                as a grey box — the page says so plainly instead. */}
            {listings.length === 0 ? (
              <p className="muted">
                Stayo is onboarding hostels now. <a href={`${siteUrl()}/owners`}>List yours</a>.
              </p>
            ) : (
              <ul className="listings">
                {listings.map((listing) => {
                  const price = priceLabel(listing.startingPrice);
                  const sharing = sharingLabel(listing.sharing);

                  return (
                    <li key={listing.slug} className="listing">
                      {listing.photo && (
                        <img src={listing.photo} alt={`${listing.name} — cover photo`} loading="lazy" />
                      )}
                      <div className="body">
                        <h3>
                          <a href={hostelUrl(listing.slug)}>{listing.name}</a>
                        </h3>
                        <p className="sub">
                          {[listing.city, price ? `from ${price}/month` : "Price on request", sharing]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </main>
      </div>

      <footer className="site-footer">
        <div className="wrap">
          <ul className="footer-links">
            <li><a href={siteUrl()}>Home</a></li>
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
