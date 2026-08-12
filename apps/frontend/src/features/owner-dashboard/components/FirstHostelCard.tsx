import { ArrowRight, Building2, Hammer } from 'lucide-react';

/**
 * The home screen for an owner who has no hostel yet, or whose hostel is
 * still being built.
 *
 * Hostel setup used to be the tail end of signup, which made it feel demanded
 * rather than chosen. Here it is an invitation on the owner's real dashboard:
 * nothing is blocked, no sample data is invented, and a half-built hostel says
 * exactly how far it got rather than hiding until it is finished.
 */
export function FirstHostelCard({
  onStart,
  inProgress,
}: {
  onStart: () => void;
  /** A hostel that exists but still has floors without rooms. */
  inProgress?: { name: string; summary: string } | null;
}) {
  const building = Boolean(inProgress);

  return (
    <section className="rounded-[22px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_8px_20px_rgba(40,30,20,0.05)]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
        {building ? (
          <Hammer className="h-5.5 w-5.5 text-primary" strokeWidth={1.9} />
        ) : (
          <Building2 className="h-5.5 w-5.5 text-primary" strokeWidth={1.9} />
        )}
      </span>

      <h2 className="mt-3.5 font-display text-[19px] font-extrabold leading-snug text-foreground">
        {building ? `${inProgress!.name} is half built` : 'Set up your first hostel'}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {building
          ? `${inProgress!.summary}. Pick up where you left off — nothing you've done is lost.`
          : 'Add your floors, then the rooms on each one. Takes a couple of minutes, and everything stays editable afterwards.'}
      </p>

      <button
        type="button"
        onClick={onStart}
        className="mt-4 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-primary px-5 font-display text-[14px] font-bold text-primary-foreground shadow-sm transition-transform active:scale-[0.98]"
      >
        {building ? 'Continue building' : 'Start building'}
        <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
      </button>
    </section>
  );
}
