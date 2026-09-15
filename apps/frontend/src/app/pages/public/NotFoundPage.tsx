import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Home, LifeBuoy } from 'lucide-react';
import { COMPANY } from '@/content/company';
import { StayoErrorScreen } from '@shared/ui/brand';
import { MarketingLayout } from './components/MarketingLayout';
import { notFoundCopy, wrapsInMarketingLayout } from './notFoundAudience';

/**
 * 404, in whichever part of Stayo the address belongs to (ADR-209).
 *
 * Two things were wrong with the previous version, and only the first was
 * visible. It drew its own little house with a question mark — a second house
 * in a brand whose error surface is already a house with the lights out. And
 * it always rendered `MarketingLayout`, because the single catch-all route sat
 * outside every app shell: an owner who mistyped a URL inside their console
 * was dropped onto the public site, under a marketing header, and invited to
 * "Find a stay".
 *
 * Now it is the same `StayoErrorScreen` every other failure uses — one house,
 * with the dog waiting outside it — and `notFoundAudience` decides who is
 * being spoken to. `OwnerRoutes` and `TenantRoutes` carry their own catch-all
 * inside their shells, so those two render with the person's real navigation
 * still around them.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();
  const copy = notFoundCopy(pathname);

  useEffect(() => {
    document.title = 'Page not found | Stayo';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', 'This Stayo page could not be found.');
    // Nothing here is worth indexing, and the URL is by definition not canonical.
    const robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.setAttribute('content', 'noindex, follow');
  }, []);

  const body = (
    <section className="px-4 pb-20 pt-8 sm:px-6">
      <div className="mx-auto max-w-xl">
        <StayoErrorScreen
          tone="notFound"
          variant="inset"
          mascot
          title={copy.title}
          description={copy.body}
          onRetry={undefined}
          secondaryAction={
            <>
              <Link
                to={copy.primary.to}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-display text-[14.5px] font-bold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(164,93,68,0.65)] transition-transform hover:-translate-y-0.5"
              >
                <Home className="h-4 w-4" strokeWidth={2.4} />
                {copy.primary.label}
              </Link>
              {copy.secondary ? (
                <Link
                  to={copy.secondary.to}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 font-display text-[14.5px] font-bold text-foreground transition-colors hover:border-primary"
                >
                  {copy.secondary.label}
                </Link>
              ) : null}
            </>
          }
          className="rounded-[20px] border border-border"
        />

        {/* The address they actually tried. A typo is only obvious once it is shown. */}
        <p className="mt-4 break-all text-center font-mono text-[12px] text-muted-foreground/70">{pathname}</p>

        <div className="mx-auto mt-6 flex max-w-sm items-center justify-center gap-2 rounded-[16px] border border-border bg-card px-5 py-3.5">
          <LifeBuoy className="h-4 w-4 flex-none text-primary" strokeWidth={2.2} />
          <span className="text-[13px] text-muted-foreground">
            Think this is our mistake?{' '}
            <Link
              to={copy.audience === 'tenant' ? '/tenant/help' : '/contact'}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              Tell us
              <ArrowRight className="h-3 w-3" strokeWidth={2.6} />
            </Link>
          </span>
        </div>

        {copy.audience === 'public' ? (
          <p className="mt-8 text-center text-[12px] text-muted-foreground/70">{COMPANY.name} · Stayo</p>
        ) : null}
      </div>
    </section>
  );

  return wrapsInMarketingLayout(copy.audience) ? <MarketingLayout>{body}</MarketingLayout> : (body as ReactNode);
}
