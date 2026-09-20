import { notFound } from "next/navigation";

import { serialiseJsonLd } from "@/src/services/seo/jsonld";
import { priceLabel, sharingLabel, audienceLabel } from "@/src/services/seo/copy";
import { hostelUrl } from "@/src/services/seo/seo-links";
import type { CollectionPageResult } from "@/src/services/seo/seo-service";
import { SeoShell } from "./SeoShell";

/**
 * One renderer for every collection page — locality, city and college, with
 * or without an intent filter.
 *
 * They differ only in the data handed to them: the dimension, the breadcrumb
 * and the `about` node in the structured data. Writing them as separate
 * templates is how programmatic SEO ends up with pages that drift apart and
 * then have to be kept in sync by hand. See ADR-226.
 *
 * The sections below switch on as inventory arrives, decided by
 * `collectionFeatures` rather than by a condition buried here:
 *
 *   1 listing   → the page publishes
 *   2 listings  → comparison appears
 *   3+ listings → recommendations appear
 */
export function CollectionPage({ page }: { page: CollectionPageResult }) {
  if (page.status !== "ok" || !page.spec || !page.subject || !page.listings) notFound();

  const { spec, subject, listings, features } = page;
  const preposition = subject.kind === "college" ? "near" : "in";
  const place = subject.shortName || subject.name;

  return (
    <SeoShell spec={spec}>
      {serialiseJsonLd(spec.jsonLd).map((json, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      ))}

      <section className="hero">
        <h1>{spec.h1}</h1>
        <p className="lede">{spec.lede}</p>
      </section>

      <section>
        <h2>
          {listings.length} verified {listings.length === 1 ? "hostel" : "hostels"} {preposition} {place}
        </h2>

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
                    {[
                      audienceLabel(listing.hostelType),
                      price ? `from ${price}/month` : "Price on request",
                      sharing,
                      listing.foodIncluded ? "meals included" : null,
                      // Only on a college page, and only when a distance was
                      // actually recorded. Free text, exactly as entered.
                      listing.distanceText ? `${listing.distanceText} away` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Two listings is the first point at which comparing is possible. */}
      {features?.comparison && (
        <section>
          <h2>Compare {place} hostels</h2>
          <div className="table-scroll">
            <table className="menu">
              <thead>
                <tr>
                  <th scope="col">Hostel</th>
                  <th scope="col">From</th>
                  <th scope="col">Sharing</th>
                  <th scope="col">Meals</th>
                  <th scope="col">For</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr key={listing.slug}>
                    <th scope="row">
                      <a href={hostelUrl(listing.slug)}>{listing.name}</a>
                    </th>
                    <td>{priceLabel(listing.startingPrice) ?? "On request"}</td>
                    <td>{sharingLabel(listing.sharing) ?? "—"}</td>
                    <td>{listing.foodIncluded ? "Included" : "—"}</td>
                    <td>{audienceLabel(listing.hostelType) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recommending one of two is not a recommendation. */}
      {features?.recommendations && (
        <section>
          <h2>Where to start</h2>
          <ul className="rows">
            {(() => {
              const priced = listings.filter((l) => l.startingPrice != null);
              const cheapest = priced.slice().sort((a, b) => (a.startingPrice! - b.startingPrice!))[0];
              const roomiest = listings.slice().sort((a, b) => Math.min(...(a.sharing.length ? a.sharing : [99])) - Math.min(...(b.sharing.length ? b.sharing : [99])))[0];
              const withFood = listings.find((l) => l.foodIncluded);

              // Each row is a fact derived from the set, never a judgement:
              // "lowest advertised rent" is checkable, "best" is not.
              const picks = [
                cheapest && { label: "Lowest advertised rent", listing: cheapest },
                roomiest && { label: "Most private rooms", listing: roomiest },
                withFood && { label: "Meals included", listing: withFood },
              ].filter(Boolean) as { label: string; listing: (typeof listings)[number] }[];

              const seen = new Set<string>();
              return picks
                .filter((pick) => !seen.has(pick.listing.slug) && seen.add(pick.listing.slug))
                .map((pick) => (
                  <li key={pick.label}>
                    <span className="label">{pick.label}</span>
                    <span className="value">
                      <a href={hostelUrl(pick.listing.slug)}>{pick.listing.name}</a>
                    </span>
                  </li>
                ));
            })()}
          </ul>
        </section>
      )}
    </SeoShell>
  );
}
