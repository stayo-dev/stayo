import { Check, Sparkles } from 'lucide-react';
import { usePublicPlans } from '@features/public-plans/hooks/usePublicPlans';
import type { PublicPlan } from '@features/public-plans/api';
import { capacityLabel, extraBedLabel, featuredPlanCode, formatMonthlyPrice } from '../pricingView';

/** Common to every tier — the platform itself doesn't shrink as the plan gets smaller. */
const COMMON_PERKS = [
  'Automated rent collection & WhatsApp reminders',
  'Digital agreements & KYC',
  'Occupancy & revenue dashboard',
];

interface PricingSectionProps {
  /** Opens the lead-capture conversation, pre-tagged with the clicked plan. */
  onSubscribe: (plan: PublicPlan) => void;
}

/**
 * Landing page pricing section. Plans are fetched live from
 * subscription_plans (via GET /public/subscription-plans) rather than
 * hardcoded, so this can never drift from what the admin console shows.
 * "Subscribe" does not charge anything — Stayo has no self-serve checkout —
 * it opens the same lead-capture conversation every other CTA on this page
 * uses, tagged with `source: pricing_plan` + the plan's code, so an admin
 * follows up and activates the subscription by hand.
 */
export function PricingSection({ onSubscribe }: PricingSectionProps) {
  const { data, isLoading, isError } = usePublicPlans();
  const plans = data?.plans ?? [];

  // No live pricing to show — quietly omit the section rather than risk
  // stale hardcoded numbers next to a live admin console that disagrees.
  if (!isLoading && (isError || plans.length === 0)) return null;

  const featured = featuredPlanCode(plans);

  return (
    <section id="pricing" className="px-4 py-16 sm:px-6">
      <div className="mx-auto mb-11 max-w-2xl text-center">
        <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">PRICING</div>
        <h2 className="mb-3 text-balance font-display text-[clamp(30px,4vw,46px)] font-extrabold leading-[1.08] tracking-tight">
          Plans that grow with your hostel
        </h2>
        <p className="text-base leading-relaxed text-muted-foreground">
          One flat monthly fee by bed capacity. Pick a plan and our team sets you up.
        </p>
      </div>

      {isLoading ? (
        <div className="mx-auto grid max-w-5xl gap-5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[340px] animate-pulse rounded-[22px] border border-border bg-card" />
          ))}
        </div>
      ) : (
        <div className="mx-auto grid max-w-5xl items-stretch gap-5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {plans.map((plan) => {
            const isFeatured = plan.code === featured;
            const extraBed = extraBedLabel(plan);
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-[22px] p-6.5 transition-transform hover:-translate-y-1 ${
                  isFeatured
                    ? 'bg-foreground shadow-[0_32px_60px_-28px_rgba(47,47,47,0.7)] ring-2 ring-primary'
                    : 'border border-border bg-card shadow-[0_24px_48px_-28px_rgba(47,47,47,0.34)]'
                }`}
              >
                {isFeatured && (
                  <div className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 font-display text-[11px] font-bold tracking-wide text-primary-foreground shadow-[0_8px_18px_-8px_rgba(164,93,68,0.6)]">
                    <Sparkles className="h-3 w-3" strokeWidth={2.6} />
                    MOST POPULAR
                  </div>
                )}

                <h3 className={`font-display text-lg font-bold ${isFeatured ? 'text-background' : 'text-foreground'}`}>
                  {plan.name}
                </h3>
                <p className={`mb-4.5 text-[12.5px] font-semibold ${isFeatured ? 'text-[#D2986C]' : 'text-primary'}`}>
                  {capacityLabel(plan)}
                </p>

                <div className={`mb-5 flex items-baseline gap-1.5 ${isFeatured ? 'text-background' : 'text-foreground'}`}>
                  <span className="font-display text-[34px] font-extrabold leading-none">
                    {formatMonthlyPrice(plan.price_paise)}
                  </span>
                  <span className={`text-[13px] font-semibold ${isFeatured ? 'text-background/55' : 'text-muted-foreground'}`}>
                    /month
                  </span>
                </div>

                <ul className="mb-6 flex-1 space-y-2.5">
                  {COMMON_PERKS.map((perk) => (
                    <li key={perk} className="flex items-start gap-2.5">
                      <Check
                        className={`mt-0.5 h-4 w-4 flex-none ${isFeatured ? 'text-[#D2986C]' : 'text-primary'}`}
                        strokeWidth={2.6}
                      />
                      <span className={`text-[13.5px] leading-snug ${isFeatured ? 'text-background/78' : 'text-foreground/85'}`}>
                        {perk}
                      </span>
                    </li>
                  ))}
                  {extraBed && (
                    <li className="flex items-start gap-2.5">
                      <Check
                        className={`mt-0.5 h-4 w-4 flex-none ${isFeatured ? 'text-[#D2986C]' : 'text-primary'}`}
                        strokeWidth={2.6}
                      />
                      <span className={`text-[13.5px] leading-snug ${isFeatured ? 'text-background/78' : 'text-foreground/85'}`}>
                        {extraBed}
                      </span>
                    </li>
                  )}
                </ul>

                <button
                  type="button"
                  onClick={() => onSubscribe(plan)}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-[13px] py-3 font-display text-[14.5px] font-bold transition-transform hover:scale-[1.02] ${
                    isFeatured
                      ? 'bg-primary text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)]'
                      : 'border border-border bg-background text-foreground hover:border-primary/40'
                  }`}
                >
                  Subscribe
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="mx-auto mt-7 max-w-lg text-center text-[12.5px] leading-relaxed text-muted-foreground">
        "Subscribe" sends your details to our team — we'll confirm your plan and get your hostel set up, no card
        needed upfront.
      </p>
    </section>
  );
}
