import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { COMPANY } from '@/content/company';
import { MarketingLayout } from './components/MarketingLayout';

const REASONS = [
  'Manually verified hostels and verified owners',
  'Transparent pricing — rent, deposit and inclusions upfront',
  'Real photos and secure, digital documents',
  'Automated rent collection with WhatsApp reminders',
  'Paperless KYC and e-signed agreements',
  'Occupancy, dues and revenue insights for owners',
  'No instant booking — owners review every request',
];

/**
 * /about — moved off the legacy navy `PublicLayout` onto the shared
 * `MarketingLayout` (2026-08-01), the last marketing page still carrying the
 * retired identity. Content was already Stayo-framed; only the shell and
 * typography changed.
 */
export function AboutPage() {
  useEffect(() => {
    document.title = 'About Us | Stayo';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        'About Stayo — a hostel management platform and verified marketplace, developed and operated by Trishul Solutions.',
      );
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `${COMPANY.website}/about`);
  }, []);

  return (
    <MarketingLayout
      eyebrow="ABOUT"
      title="One platform for the entire stay lifecycle"
      subtitle="A verified marketplace for students, and a complete operations system for the people who run the places they stay in."
    >
      <section className="px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-[22px] border border-border bg-card p-6 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)] sm:p-9">
            <h2 className="mb-3 font-display text-[19px] font-bold text-foreground">What Stayo is</h2>
            <p className="mb-8 text-[15px] leading-[1.75] text-foreground/80">
              Stayo is a hostel and PG management platform — a verified marketplace where students discover
              safe, transparently-priced homes, and a complete operations system where owners run them:
              enquiries, onboarding, digital agreements, rent collection and reporting, all on one rail from
              move-in to move-out.
            </p>

            <h2 className="mb-3 border-t border-border pt-8 font-display text-[19px] font-bold text-foreground">
              Our mission
            </h2>
            <p className="text-[15px] leading-[1.75] text-foreground/80">
              We believe finding a place to stay — and running one — should be effortless and trustworthy.
              Stayo brings transparency to students and automation to owners, replacing broker games and
              manual paperwork with verified listings, clear pricing, and software that does the busywork.
            </p>
          </div>

          <h2 className="mb-5 mt-10 text-center font-display text-[clamp(22px,3vw,30px)] font-extrabold tracking-tight">
            Why people choose Stayo
          </h2>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {REASONS.map((item) => (
              <div key={item} className="flex items-start gap-2.5 rounded-[16px] border border-border bg-card p-4">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-secondary text-primary">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="text-[14px] leading-relaxed text-foreground/85">{item}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              to="/contact"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-6 py-3 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(164,93,68,0.65)] transition-transform hover:-translate-y-0.5"
            >
              Contact us
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </Link>
            <Link
              to="/company"
              className="inline-flex items-center rounded-xl border border-border bg-card px-6 py-3 font-display text-[15px] font-bold text-foreground transition-colors hover:border-primary"
            >
              About {COMPANY.name}
            </Link>
          </div>

          <p className="mt-10 border-t border-border pt-6 text-[13px] text-muted-foreground">
            Stayo is developed and operated by{' '}
            <Link to="/company" className="font-semibold text-foreground hover:text-primary">
              {COMPANY.name}
            </Link>
            .
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}
