import { Check, Users, BedDouble, Share2, LayoutGrid, ArrowRight } from 'lucide-react';

interface SuccessStepProps {
  hostelDisplay: string;
  publishChoice: 'now' | 'draft';
  onExplore: () => void;
}

const NEXT_STEPS = [
  { label: 'Invite your manager', icon: Users },
  { label: 'Add your first tenant', icon: BedDouble },
  { label: 'Share your listing', icon: Share2 },
  { label: 'Explore the dashboard', icon: LayoutGrid },
];

export function SuccessStep({ hostelDisplay, publishChoice, onExplore }: SuccessStepProps) {
  const stateText = publishChoice === 'now' ? 'live and discoverable' : 'saved as a draft';
  return (
    <div>
      <div className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 font-display text-[11px] font-bold tracking-wider text-success">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        LIVE ON STAYO
      </div>
      <h1 className="mb-3 font-display text-[clamp(32px,4.2vw,46px)] font-extrabold leading-[1.06] tracking-tight text-foreground">
        You built a hostel.
      </h1>
      <p className="mb-6.5 text-[17px] leading-relaxed text-muted-foreground">
        {hostelDisplay} is now {stateText}. Here&apos;s where to go next:
      </p>
      <div className="flex max-w-[420px] flex-col gap-2.5">
        {NEXT_STEPS.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={onExplore}
            className="flex items-center gap-3.5 rounded-2xl border border-border bg-card px-4.5 py-4 text-left transition-transform hover:translate-x-1"
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-secondary">
              <Icon className="h-4.5 w-4.5 text-primary" strokeWidth={1.9} />
            </span>
            <span className="flex-1 font-display text-[15px] font-bold text-foreground">{label}</span>
            <ArrowRight className="h-4 w-4 text-primary" strokeWidth={2.4} />
          </button>
        ))}
      </div>
    </div>
  );
}
