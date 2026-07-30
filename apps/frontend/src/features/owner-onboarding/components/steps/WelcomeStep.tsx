import { Check, Clock } from 'lucide-react';

const CHECKS = ['Meet the owner — you', 'Verify & earn your badge', 'Raise floors, rooms & beds', 'Open your doors to tenants'];

export function WelcomeStep() {
  return (
    <div>
      <div className="mb-5.5 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 font-display text-[11px] font-bold tracking-wider text-primary">
        FOR HOSTEL OWNERS
      </div>
      <h1 className="mb-4 font-display text-[clamp(34px,4.6vw,50px)] font-extrabold leading-[1.06] tracking-tight text-foreground">
        Let&apos;s build your hostel, together.
      </h1>
      <p className="mb-7.5 max-w-[430px] text-lg leading-relaxed text-muted-foreground">
        In a few calm steps you&apos;ll go from owner to a live hostel. Watch your world take shape as you go.
      </p>
      <div className="mb-7.5 flex flex-col gap-3.5">
        {CHECKS.map((c) => (
          <div key={c} className="flex items-center gap-3">
            <span className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-full bg-success/10">
              <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.8} />
            </span>
            <span className="text-[15.5px] font-semibold text-foreground">{c}</span>
          </div>
        ))}
      </div>
      <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
        <Clock className="h-4 w-4 text-primary" strokeWidth={2} />
        <span className="text-sm font-semibold text-foreground/80">
          About <b className="font-display text-foreground">4–5 minutes</b> · nothing is final
        </span>
      </div>
    </div>
  );
}
