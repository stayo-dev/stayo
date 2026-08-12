import { Check, Building2, ArrowRight } from 'lucide-react';

interface SuccessStepProps {
  onExplore: () => void;
}

/**
 * The end of onboarding, which now finishes at "your account is ready" rather
 * than "your hostel is live".
 *
 * It used to claim "You built a hostel" because the wizard provisioned one
 * from four numbers on the way past. Building is its own flow now — offered
 * here, and waiting on the dashboard if the owner would rather look around
 * first. Nothing about the account is incomplete without it.
 */
export function SuccessStep({ onExplore }: SuccessStepProps) {
  return (
    <div>
      <div className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 font-display text-[11px] font-bold tracking-wider text-success">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        ACCOUNT READY
      </div>
      <h1 className="mb-3 font-display text-[clamp(32px,4.2vw,46px)] font-extrabold leading-[1.06] tracking-tight text-foreground">
        You&apos;re all set.
      </h1>
      <p className="mb-6.5 max-w-[440px] text-[17px] leading-relaxed text-muted-foreground">
        Your Stayo account is ready. Whenever you like, set up your hostel — floors first, then the rooms on
        each one.
      </p>

      <div className="flex max-w-[420px] flex-col gap-2.5">
        <button
          type="button"
          onClick={onExplore}
          className="flex items-center gap-3.5 rounded-2xl bg-primary px-4.5 py-4 text-left text-primary-foreground transition-transform active:scale-[0.99]"
        >
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-white/15">
            <Building2 className="h-4.5 w-4.5" strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[15px] font-bold">Set up my hostel</span>
            <span className="block text-[12.5px] opacity-85">Floors, rooms and rent — a couple of minutes</span>
          </span>
          <ArrowRight className="h-4.5 w-4.5 flex-none" strokeWidth={2.2} />
        </button>

        <button
          type="button"
          onClick={onExplore}
          className="rounded-2xl border border-border bg-card px-4.5 py-3.5 font-display text-[14px] font-bold text-foreground/80"
        >
          Look around first
        </button>
      </div>
    </div>
  );
}
