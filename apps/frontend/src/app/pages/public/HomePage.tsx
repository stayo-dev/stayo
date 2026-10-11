import { useEffect, useMemo, useState } from 'react';

import { useHomepageListings } from '@features/homepage/hooks/useHomepageListings';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { LoginModal, type LoginModalUser } from '@shared/ui-patterns/LoginModal';
import {
  crossSurfaceHandoff,
} from '@shared/lib/crossSurfaceLogin';

import { PublicHeader } from './components/PublicHeader';
import { MarketingFooter } from './components/MarketingFooter';
import { FeaturedHostels } from './home/FeaturedHostels';
import { HomeHero } from './home/HomeHero';
import { HowItWorks } from './home/HowItWorks';
import { OwnerBand } from './home/OwnerBand';
import { SupplyRequestSection } from './home/SupplyRequestSection';
import { TrustSection } from './home/TrustSection';
import { homeSupplyState, planFeatured } from './home/homeFeatured';
import { citiesFromFacets, liveCities, liveCityLabel, primaryCity } from './home/liveCities';

/**
 * `/` — the student-first front door (ADR-223).
 *
 * This is the v2 homepage. It does NOT replace `WelcomePage`: both ship, and
 * `homepageVersion.ts` decides which one `/` serves, so switching back is a
 * config change rather than a revert. `/owners` is untouched either way.
 *
 * The page renders for everyone including signed-in owners and never redirects
 * off `/` — an owner has to be able to look at the marketplace they are paying
 * for (ADR-071 point 4, which was reverted in a day the one time it was
 * violated). The header's owner CTA changes wording and destination instead.
 */
export function HomePage() {
  // Admin-curated when a line-up exists, the default recommended sort when it
  // does not — see homepage-feature-service.ts. The page never has to know
  // which, beyond not re-sorting what a human already ordered.
  const { data, isLoading } = useHomepageListings();

  useEffect(() => {
    document.title = 'Stayo — hostel living, sorted';
  }, []);

  const cards = useMemo(() => data?.results ?? [], [data]);
  const plan = useMemo(() => planFeatured(cards, data?.curated ?? false), [cards, data]);
  // Facets describe every matching hostel; the cards are only this page of
  // them. Fall back to the cards if the server ever stops sending facets.
  const cities = useMemo(() => {
    const faceted = citiesFromFacets(data?.facets?.cities);
    return faceted.length > 0 ? faceted : liveCities(cards);
  }, [data, cards]);

  // Sign-in opens over the homepage rather than sending anyone to `/login`,
  // which renders the owner marketing page. `mode="tenant"` is the only mode
  // with a signup tab, and anyone with a dashboard who signs in here goes
  // straight to it via `crossSurfaceHandoff` — the same rule Discover uses.
  const [signInOpen, setSignInOpen] = useState(false);

  const handleSignedIn = (user: LoginModalUser) => {
    setSignInOpen(false);
    const crossing = crossSurfaceHandoff({ role: user.role, tenantId: user.tenantId }, 'home');
    // A full page load: the owner, admin and tenant apps have their own
    // providers and session bootstrap.
    if (crossing) window.location.assign(crossing.path);
    // A seeker (no tenancy) stays on the homepage — they came to look at hostels.
  };

  const state = homeSupplyState(isLoading, cards.length);
  const city = state === 'ready' ? primaryCity(cities) : null;

  return (
    <ThemeProvider theme="marketing">
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader onSignIn={() => setSignInOpen(true)} />
        {/* While loading, the chip and the lead photo are withheld rather than
            replaced with the zero-supply treatment — see `homeSupplyState`. */}
        <HomeHero
          cityLabel={state === 'ready' ? liveCityLabel(cities) : null}
          ctaCity={city}
          lead={state === 'ready' ? plan.lead : null}
          loading={state === 'loading'}
        />
        <FeaturedHostels plan={plan} loading={state === 'loading'} city={city} />
        <SupplyRequestSection source={state === 'empty' ? 'HOME_EMPTY' : 'HOME'} />
        <TrustSection />
        <HowItWorks />
        <OwnerBand />
        <MarketingFooter />

        <LoginModal
          open={signInOpen}
          mode="tenant"
          initialTab="login"
          onClose={() => setSignInOpen(false)}
          onSuccess={handleSignedIn}
        />

      </div>
    </ThemeProvider>
  );
}
