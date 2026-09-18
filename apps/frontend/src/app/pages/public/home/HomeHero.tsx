import { Link } from 'react-router-dom';
import { ArrowRight, FileText, ShieldCheck, Users } from 'lucide-react';

import type { DiscoverCard } from '@features/discover/api';
import { hostelCardFacts } from '@/app/pages/discover/hostelCardFacts';

import { listingPhotoUrl } from './listingPhoto';
import { GROUND_LIGHT } from './ground';

interface HomeHeroProps {
  /** "Now live in Pune", or null when there is nothing to promise. */
  cityLabel: string | null;
  /** The city the CTA names, or null when there are no listings. */
  ctaCity: string | null;
  /** The listing whose photograph fronts the page, if any. */
  lead: DiscoverCard | null;
  /** Listings are still in flight — withhold the empty treatment. */
  loading: boolean;
}

/**
 * The hero, in both supply states.
 *
 * With listings it carries the lead listing's own photograph — credited and
 * linked, so it is at once the hero and the first listing, and it cannot be a
 * picture of a hostel you can't actually book. With none it goes brand-only:
 * no stock photography, because a stock hostel is exactly the lie the whole
 * product is positioned against.
 *
 * The trust line is a chip up here as well as a section far below, because the
 * strongest thing the page has to say was otherwise 2,000px past the fold.
 */
export function HomeHero({ cityLabel, ctaCity, lead, loading }: HomeHeroProps) {
  const facts = lead ? hostelCardFacts(lead) : null;
  const photo = listingPhotoUrl(facts?.photo ?? null, 620);
  const showPhoto = !loading && lead && facts && photo && lead.slug;

  return (
    <header className={`relative px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16 ${GROUND_LIGHT}`}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          {cityLabel && (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-2.5 pr-3.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="font-display text-[11px] font-bold uppercase tracking-wider text-primary">{cityLabel}</span>
            </span>
          )}

          <h1 className="mt-5 font-display text-[clamp(42px,6vw,74px)] font-extrabold leading-[1.02] tracking-tight text-foreground">
            Hostel living,
            <br />
            sorted.
          </h1>

          <p className="mt-5 max-w-[470px] text-[clamp(15px,1.6vw,18px)] leading-relaxed text-muted-foreground">
            Verified hostels with real photos, real prices and a real person on the other end.
          </p>

          <p className="mt-5 inline-flex items-center gap-2.5 rounded-xl bg-secondary px-4 py-2.5">
            <Users className="h-[17px] w-[17px] flex-none text-primary" strokeWidth={2} aria-hidden="true" />
            <span className="font-display text-[13px] font-bold text-foreground sm:text-[14.5px]">
              Straight to the hostel owner — no agents in the middle.
            </span>
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Link
              to="/discover"
              className="inline-flex h-14 items-center gap-2.5 rounded-[15px] bg-foreground px-6 font-display text-base font-bold text-background"
            >
              {ctaCity ? `See hostels in ${ctaCity}` : 'Browse hostels'}
              <ArrowRight className="h-4 w-4 text-primary" strokeWidth={2.2} />
            </Link>
            <span className="text-[13.5px] font-semibold text-muted-foreground">Visited and verified before listing</span>
          </div>

          <ul className="mt-8 flex flex-wrap items-center gap-6">
            <li className="inline-flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
              <ShieldCheck className="h-4 w-4 text-primary" strokeWidth={1.9} aria-hidden="true" /> Verified hostels only
            </li>
            <li className="inline-flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
              <FileText className="h-4 w-4 text-primary" strokeWidth={1.9} aria-hidden="true" /> Digital agreement
            </li>
          </ul>
        </div>

        {loading && <div className="h-[280px] w-full animate-pulse rounded-3xl bg-secondary sm:h-[430px]" aria-hidden="true" />}

        {showPhoto && (
          <div className="relative">
            <Link to={`/discover/h/${lead.slug}`} className="block">
              <img
                src={photo as string}
                alt={`${lead.name} — ${facts.location}`}
                width={620}
                height={430}
                className="h-[280px] w-full rounded-3xl border border-border object-cover sm:h-[430px]"
              />
              <div className="absolute inset-x-4 bottom-4 flex items-center gap-4 rounded-[18px] bg-card p-4 shadow-2xl sm:inset-x-6 sm:bottom-6 sm:p-5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[17px] font-extrabold text-foreground">{lead.name}</div>
                  <div className="mt-0.5 truncate text-[13px] font-medium text-muted-foreground">
                    {facts.location} · <span className="font-bold text-[#3F6B50]">{facts.availability.label}</span>
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="font-display text-lg font-extrabold text-foreground">{facts.price ?? 'On request'}</div>
                  {facts.price && <div className="text-[11.5px] font-semibold text-muted-foreground">per month</div>}
                </div>
              </div>
            </Link>
            <span className="mt-2.5 block text-right text-xs font-semibold text-muted-foreground">
              A real listing's own photograph — never stock
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
