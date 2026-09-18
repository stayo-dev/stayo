import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';

import type { DiscoverCard } from '@features/discover/api';
import { hostelCardFacts } from '@/app/pages/discover/hostelCardFacts';

import { listingPhotoUrl } from './listingPhoto';
import type { FeaturedPlan } from './homeFeatured';
import { ANCHOR_OFFSET } from './ground';

/**
 * ONE link, not a card containing a button.
 *
 * A card with a link around the photo and a second link in the footer looks
 * entirely clickable while only parts of it are, and costs a keyboard user two
 * tab stops for one destination. The whole card is the target; "View listing"
 * is an affordance, not a second control.
 */
function FeaturedHostelCard({ hostel, wide = false }: { hostel: DiscoverCard; wide?: boolean }) {
  const facts = hostelCardFacts(hostel);
  const photo = listingPhotoUrl(facts.photo, wide ? 760 : 560);

  return (
    <Link
      to={hostel.slug ? `/discover/h/${hostel.slug}` : '/discover'}
      aria-label={`${hostel.name}, ${facts.location}`}
      className={`block overflow-hidden rounded-[22px] border border-border bg-card no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        wide ? 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-stretch' : ''
      }`}
    >
      <div className="relative">
        {photo ? (
          <img
            src={photo}
            alt=""
            width={wide ? 760 : 560}
            height={wide ? 420 : 240}
            className={`w-full object-cover ${wide ? 'h-[210px] sm:h-full sm:min-h-[340px]' : 'h-[190px] sm:h-[240px]'}`}
          />
        ) : (
          <div className={`w-full bg-secondary ${wide ? 'h-[210px] sm:h-full sm:min-h-[340px]' : 'h-[190px] sm:h-[240px]'}`} />
        )}
        {hostel.verified && (
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-[11.5px] font-bold text-[#3F6B50]">
            <Check className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" /> Verified
          </span>
        )}
      </div>

      <div className={`p-5 sm:p-6 ${wide ? "sm:flex sm:flex-col sm:justify-center sm:p-9" : ""}`}>
        <div className="flex items-baseline gap-3">
          <h3 className={`flex-1 font-display font-extrabold text-foreground ${wide ? "text-xl sm:text-[26px]" : "text-lg sm:text-xl"}`}>{hostel.name}</h3>
          <span className={facts.price ? 'font-display text-lg font-extrabold text-foreground' : 'text-sm font-bold text-muted-foreground'}>
            {facts.price ?? 'Price on request'}
          </span>
        </div>
        <p className="mt-1.5 text-sm font-medium text-muted-foreground">{facts.location}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {facts.sharing.map((label) => (
            <span key={label} className="rounded-full bg-secondary px-3 py-1.5 text-[12.5px] font-semibold text-foreground/80">
              {label}
            </span>
          ))}
          {facts.meals && (
            <span className="rounded-full bg-secondary px-3 py-1.5 text-[12.5px] font-semibold text-foreground/80">Food included</span>
          )}
          {facts.audience && (
            <span className="rounded-full bg-secondary px-3 py-1.5 text-[12.5px] font-semibold text-foreground/80">{facts.audience}</span>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
          <span className="flex-1 text-[13.5px] font-bold text-[#3F6B50]">{facts.availability.label}</span>
          <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold text-primary" aria-hidden="true">
            View listing <ArrowRight className="h-4 w-4" strokeWidth={2.3} />
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * Every listing, framed as every listing.
 *
 * "Not a selection — all of them" turns a small marketplace into a claim about
 * honesty rather than an apology for size, and it stays true automatically: the
 * heading does not have to change when supply grows, only the layout does.
 */
/**
 * One listing is shown as one WIDE card, not as a lonely column beside an
 * empty one. `sm:grid-cols-2` with a single child left two thirds of the row
 * blank and read as a page that had failed to load the rest.
 */
function gridClass(count: number): string {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'sm:grid-cols-2';
  return 'sm:grid-cols-2 lg:grid-cols-3';
}

export function FeaturedHostels({ plan, loading, city }: { plan: FeaturedPlan; loading: boolean; city: string | null }) {
  if (loading) {
    return (
      <section className="bg-card px-4 py-16 sm:px-6 sm:py-20" aria-busy="true">
        <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2">
          <div className="h-[420px] animate-pulse rounded-[22px] bg-secondary" />
          <div className="h-[420px] animate-pulse rounded-[22px] bg-secondary" />
        </div>
      </section>
    );
  }
  if (plan.layout === 'none') return null;

  return (
    <section id="listings" className={`bg-card px-4 py-16 sm:px-6 sm:py-20 ${ANCHOR_OFFSET}`}>
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex-1">
            <h2 className="font-display text-[clamp(28px,4vw,40px)] font-extrabold leading-[1.08] tracking-tight text-foreground">
              {city ? `Hostels in ${city}` : 'Hostels on Stayo'}
            </h2>
            <p className="mt-3.5 max-w-[620px] text-base leading-relaxed text-muted-foreground sm:text-[16.5px]">
              Every one we have, not a selection. We would rather show you all of them than pretend to be bigger than we are.
            </p>
          </div>
          {plan.showBrowseAll && (
            <Link to="/discover" className="inline-flex items-center gap-2 font-display text-[14.5px] font-bold text-primary">
              Browse all <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
            </Link>
          )}
        </div>

        <div className={`mt-9 grid gap-6 ${gridClass(plan.cards.length)}`}>
          {plan.cards.map((hostel) => (
            <FeaturedHostelCard key={hostel.id} hostel={hostel} wide={plan.cards.length === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}
