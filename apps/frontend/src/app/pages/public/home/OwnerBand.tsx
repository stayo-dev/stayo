import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { StayoMark } from '@shared/ui/brand';

/**
 * The seam, kept and repurposed.
 *
 * `WelcomePage` used this diagonal as a gate you had to resolve before you saw
 * anything. Here it is the same gesture — same clip-path, same mark riding it —
 * marking where the page turns from students to owners. You scroll past it
 * instead of being stopped by it, which is the whole difference between a brand
 * and an interrogation.
 */
export function OwnerBand() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-foreground [clip-path:polygon(0_62px,100%_0,100%_100%,0_100%)] sm:[clip-path:polygon(0_88px,100%_0,100%_100%,0_100%)]" />

      <div className="absolute left-1/2 top-[31px] z-10 -translate-x-1/2 -translate-y-1/2 sm:top-[44px]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background shadow-xl ring-[5px] ring-background/90 sm:h-14 sm:w-14">
          <StayoMark className="h-6 w-auto text-primary sm:h-7" />
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-[104px] sm:px-6 sm:pb-20 sm:pt-[168px]">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-3.5 py-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-primary">
              For hostel owners
            </span>
            <h2 className="mt-4 font-display text-[clamp(28px,4.2vw,42px)] font-extrabold leading-[1.08] tracking-tight text-background">
              Run a hostel? Fill it, and stop chasing rent.
            </h2>
            <p className="mt-3.5 max-w-[560px] text-base leading-relaxed text-background/70 sm:text-[16.5px]">
              Live occupancy, rent on autopilot, WhatsApp reminders that chase themselves — and the students above, sent
              straight to your inbox.
            </p>
          </div>

          <div className="lg:pt-14">
            <Link
              to="/owners"
              state={{ declaredOwnerIntent: true }}
              className="flex h-14 items-center justify-center gap-2.5 rounded-[15px] bg-primary font-display text-base font-extrabold text-primary-foreground"
            >
              List your hostel
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </Link>
            <p className="mt-3.5 text-center text-[13px] font-semibold text-background/60">Free to list · No card needed</p>
          </div>
        </div>
      </div>
    </section>
  );
}
