import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Home, LifeBuoy, Search } from 'lucide-react';
import { COMPANY } from '@/content/company';
import { MarketingLayout } from './components/MarketingLayout';

/**
 * 404. Replaces a blanket `<Navigate to="/" />` catch-all that silently
 * dumped every unknown URL on the marketing page with no explanation — which
 * also meant a typo and a retired page were indistinguishable.
 *
 * Kept deliberately light: an apology, the path they tried, and the three
 * places they were probably heading.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = 'Page not found | Stayo';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', 'This Stayo page could not be found.');
    // Nothing here is worth indexing, and the URL is by definition not canonical.
    const robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.setAttribute('content', 'noindex, follow');
  }, []);

  return (
    <MarketingLayout>
      <section className="px-4 pb-24 pt-10 sm:px-6">
        <div className="mx-auto max-w-xl text-center">
          {/* A little house that has clearly lost its door. */}
          <div className="relative mx-auto mb-8 h-28 w-32" aria-hidden="true">
            <div className="absolute inset-x-0 bottom-0 mx-auto h-16 w-24 rounded-b-[14px] rounded-t-md border-[3px] border-primary/25 bg-secondary/60" />
            <div className="absolute left-1/2 top-1 h-0 w-0 -translate-x-1/2 border-x-[62px] border-b-[38px] border-x-transparent border-b-primary/30" />
            <div className="absolute bottom-0 left-1/2 h-8 w-6 -translate-x-1/2 rounded-t-md border-[3px] border-b-0 border-primary/25 bg-background" />
            <span className="absolute -right-1 top-6 rotate-12 font-display text-[26px] font-extrabold text-primary">?</span>
          </div>

          <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">404</div>
          <h1 className="mb-4 text-balance font-display text-[clamp(28px,4.5vw,44px)] font-extrabold leading-[1.08] tracking-tight">
            This room doesn't exist
          </h1>
          <p className="mx-auto mb-2 max-w-md text-[15.5px] leading-relaxed text-muted-foreground">
            We couldn't find anything at that address. It may have moved, or the link might have a typo.
          </p>
          <p className="mb-9 break-all font-mono text-[12.5px] text-muted-foreground/70">{pathname}</p>

          <div className="mb-10 flex flex-wrap justify-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(164,93,68,0.65)] transition-transform hover:-translate-y-0.5"
            >
              <Home className="h-4 w-4" strokeWidth={2.4} />
              Back home
            </Link>
            <Link
              to="/#search"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 font-display text-[15px] font-bold text-foreground transition-colors hover:border-primary"
            >
              <Search className="h-4 w-4" strokeWidth={2.4} />
              Find a stay
            </Link>
          </div>

          <div className="mx-auto flex max-w-sm items-center justify-center gap-2 rounded-[16px] border border-border bg-card px-5 py-3.5">
            <LifeBuoy className="h-4 w-4 flex-none text-primary" strokeWidth={2.2} />
            <span className="text-[13px] text-muted-foreground">
              Think this is our mistake?{' '}
              <Link to="/contact" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                Tell us
                <ArrowRight className="h-3 w-3" strokeWidth={2.6} />
              </Link>
            </span>
          </div>

          <p className="mt-8 text-[12px] text-muted-foreground/70">
            {COMPANY.name} · Stayo
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}
