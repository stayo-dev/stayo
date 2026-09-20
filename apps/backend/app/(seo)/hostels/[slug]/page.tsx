import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { loadHostelPage, listDiscoverableSlugs } from "@/src/services/seo/seo-service";
import { serialiseJsonLd } from "@/src/services/seo/jsonld";
import { normaliseSlug } from "@/src/services/seo/slug";
import { resolveHostelSlug } from "@/src/services/discovery/slug-resolution";
import { availabilityBand, priceLabel, sharingLabel } from "@/src/services/seo/copy";
import { ogImageUrl } from "@/src/services/discovery/share-card";
import { frontendUrl } from "@/lib/config/domains";
import { SeoShell } from "../../_components/SeoShell";

/**
 * The canonical public page for a hostel.
 *
 * Reached at `yourstayo.com/hostels/:slug` through a rewrite in the frontend's
 * `vercel.json` — the same arrangement `/h/:slug` and `/pay/:token` already
 * use. It exists because `apps/frontend` is a client-rendered Vite SPA that
 * serves one `index.html`, with one hardcoded title and one hardcoded
 * canonical, for every URL: a crawler asking for a hostel is handed the
 * generic Stayo shell and no amount of client-side metadata can change that,
 * because crawlers do not run the JavaScript that would set it. ADR-084
 * established the pattern for share unfurls; ADR-226 scales it to the page
 * itself.
 *
 * Every decision about what this page SAYS lives in `src/services/seo/` and is
 * tested without a database. This file only arranges the result.
 */

// One hour. Long enough that a forwarded link is not a query per reader, short
// enough to bound how stale a page can be if a write path ever fails to
// invalidate its tag. Owner edits bust it immediately via
// `invalidatePublicListing`; this is the backstop, not the mechanism.
export const revalidate = 3600;

/**
 * REQUIRED. Without it a hostel listed after the last build 404s until the
 * next deploy — which is the whole "onboarding a hostel improves SEO with no
 * one doing anything" property, lost to a default.
 */
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    const slugs = await listDiscoverableSlugs();
    return slugs.map((slug) => ({ slug }));
  } catch {
    // A build must not fail because the database was unreachable. Every page
    // still renders on demand; only the prerender is skipped.
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const page = await loadHostelPage(normaliseSlug(params.slug));
  if (!page) return { title: "Hostel not found | Stayo", robots: { index: false, follow: true } };

  const { spec } = page;
  const image = ogImageUrl(spec.image ?? undefined, frontendUrl("/og-cover.png"));

  return {
    title: spec.title,
    description: spec.description,
    alternates: { canonical: spec.canonicalUrl },
    robots: { index: spec.robots.index, follow: spec.robots.follow },
    openGraph: {
      type: "website",
      siteName: "Stayo",
      title: spec.title,
      description: spec.description,
      url: spec.canonicalUrl,
      locale: "en_IN",
      images: [{ url: image, width: 1200, height: 630, alt: page.facts.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: spec.title,
      description: spec.description,
      images: [image],
    },
  };
}

export default async function HostelPage({ params }: { params: { slug: string } }) {
  const slug = normaliseSlug(params.slug);

  // `/hostels/Sri-Adithya-.../` and `/hostels/sri-adithya-...` must not both
  // serve 200 — that is one hostel at two indexable addresses.
  if (slug !== params.slug) permanentRedirect(`/hostels/${slug}`);

  let page = await loadHostelPage(slug);

  if (!page) {
    // Before 404ing, ask whether this slug was retired by a rename. An
    // indexed URL and a WhatsApp message both outlive a rename, so a retired
    // slug redirects permanently rather than dying. ADR-226.
    const resolved = await resolveHostelSlug(slug);
    if (resolved.kind === "retired") permanentRedirect(`/hostels/${resolved.currentSlug}`);
    notFound();
  }

  const { facts, spec } = page;
  const band = availabilityBand(facts);
  const price = priceLabel(facts.startingPrice);
  const sharing = sharingLabel(facts.sharing);

  return (
    <SeoShell spec={spec}>
      {serialiseJsonLd(spec.jsonLd).map((json, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: json }}
        />
      ))}

      <section className="hero">
        <h1>{spec.h1}</h1>
        <p className="lede">{spec.lede}</p>

        <ul className="facts">
          {/* Price first: it is what a reader is looking for, and "Price on
              request" is the honest answer when an owner has not set one. */}
          <li className={price ? "fact fact--price" : "fact"}>
            {price ? `From ${price}/month` : "Price on request"}
          </li>
          {sharing && <li className="fact">{sharing}</li>}
          {facts.foodIncluded && <li className="fact">Meals included</li>}
          {facts.verified && <li className="fact">Verified by Stayo</li>}
          {/* A band, never a count — see availabilityBand. */}
          {band && <li className={`fact ${band.open ? "fact--open" : "fact--full"}`}>{band.label}</li>}
        </ul>
      </section>

      {facts.photos.length > 0 && (
        <section className="gallery" aria-label={`Photos of ${facts.name}`}>
          {facts.photos.slice(0, 5).map((photo, index) => (
            <img
              key={photo}
              src={photo}
              // Descriptive alt, built from the hostel's own name — image
              // search matters a great deal for accommodation.
              alt={index === 0 ? `${facts.name} — main photo` : `${facts.name} — photo ${index + 1}`}
              // The hero is the LCP element, so it must not be lazy.
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : undefined}
              decoding={index === 0 ? "sync" : "async"}
            />
          ))}
        </section>
      )}

      {facts.about && (
        <section>
          <h2>About {facts.name}</h2>
          <p>{facts.about}</p>
          {facts.highlights.length > 0 && (
            <ul className="chips">
              {facts.highlights.map((highlight) => (
                <li key={highlight} className="chip">{highlight}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {facts.bedTiers.length > 0 && (
        <section>
          <h2>Rooms and rent</h2>
          <ul className="grid">
            {facts.bedTiers.map((tier, index) => (
              <li key={`${tier.name}-${tier.sharing}-${index}`} className="tier">
                <h3>{tier.name || (tier.sharing === 1 ? "Single room" : `${tier.sharing}-sharing`)}</h3>
                {/* Never ₹0: an unpriced room means the owner has not said. */}
                <p className="price">
                  {tier.price == null ? "Price on request" : `₹${tier.price.toLocaleString("en-IN")}`}
                  {tier.price != null && <span className="sub"> /month</span>}
                </p>
                {tier.space && <p className="sub">{tier.space}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {facts.amenities.length > 0 && (
        <section>
          <h2>Facilities</h2>
          <ul className="chips">
            {facts.amenities.map((amenity) => (
              <li key={amenity} className="chip">{amenity}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Rendered only when the hostel actually serves meals: `mess.provided`
          defaults false because silence must not read as "meals included". */}
      {facts.mess && facts.mess.week.length > 0 && (
        <section>
          <h2>This week&rsquo;s mess menu</h2>
          <div className="table-scroll">
            <table className="menu">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  {facts.mess.meals.map((meal) => (
                    <th key={meal.key} scope="col">
                      {meal.label}
                      {meal.time && <span className="muted"> · {meal.time}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facts.mess.week.map((day, index) => (
                  <tr key={index}>
                    <th scope="row">{DAY_NAMES[index] ?? `Day ${index + 1}`}</th>
                    {facts.mess!.meals.map((meal) => (
                      <td key={meal.key}>{day[meal.key] || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {facts.places.length > 0 && (
        <section>
          <h2>What&rsquo;s nearby</h2>
          <ul className="rows">
            {facts.places.map((place, index) => (
              <li key={`${place.name}-${index}`}>
                <span className="label">{place.name}</span>
                {/* Free text, exactly as entered — ADR-088 keeps it free text
                    because a metres column invites a precision nobody measured. */}
                {place.distance && <span className="value">{place.distance}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* A hostel nobody has located renders no directions block at all —
          no landmark beats a landmark that points at the wrong building. */}
      {facts.navigation?.landmark && (
        <section>
          <h2>Finding it</h2>
          <p>{facts.navigation.landmark}</p>
        </section>
      )}

      {/*
        Reviews.

        Rendered whenever there are any — an empty section is not drawn at all
        (ADR-102: "an empty reviews section is not rendered"). This section is
        also what LICENSES the `aggregateRating` in the structured data above:
        a rating in markup that a reader cannot see on the page is a Google
        guideline violation, so the two ship together or not at all.
      */}
      {facts.reviews.length > 0 && (
        <section>
          <h2>
            What residents say
            {facts.rating != null && (
              <span className="muted">
                {" "}
                · {facts.rating.toFixed(1)} out of 5 from {facts.reviewCount}{" "}
                {facts.reviewCount === 1 ? "review" : "reviews"}
              </span>
            )}
          </h2>

          <ul className="grid">
            {facts.reviews.map((review, index) => (
              <li key={index} className="card">
                <p className="price" aria-label={`Rated ${review.rating} out of 5`}>
                  {review.rating.toFixed(1)}
                  <span className="sub"> / 5</span>
                </p>
                {review.body && <p>{review.body}</p>}
                <p className="muted">
                  {review.author}
                  {/* Only claimed when the database says so — ADR-086 scopes
                      reviewing to current and former residents. */}
                  {review.stayedHere && " · Verified resident"}
                  {review.stayDuration && ` · stayed ${review.stayDuration}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* "Meet your host" (ADR-200). Never shown for a PLATFORM_LISTED hostel,
          which has no real owner, and never with a phone or email. */}
      {facts.host?.name && !facts.host.platformListed && (
        <section>
          <h2>Meet your host</h2>
          <div className="card">
            <h3>{facts.host.name}</h3>
            <p className="muted">
              Owner
              {facts.host.hostingSince && ` · On Stayo since ${formatMonth(facts.host.hostingSince)}`}
            </p>
            {facts.host.languages.length > 0 && (
              <p className="muted">Speaks {facts.host.languages.join(", ")}</p>
            )}
          </div>
        </section>
      )}

      <section>
        <h2>Enquire about {facts.name}</h2>
        <p className="muted">
          Live availability, photos and enquiry are on the listing itself.
        </p>
        {spec.links.app.map((link) => (
          <a key={link.href} className="cta" href={link.href}>
            {link.label}
          </a>
        ))}
      </section>
    </SeoShell>
  );
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function formatMonth(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
