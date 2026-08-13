import { ArrowRight, CheckCircle2, Home, Key, MessageCircle } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import type { ActivationContext } from '../activationTypes';
import { currency, fmtDate } from '../activationTypes';

/**
 * Step 5 — "Welcome to the Stayo Family!": a celebration/summary screen
 * shown after the backend's `ACTIVATE` step succeeds, before handing off the
 * new session and entering the tenant portal. New relative to the legacy
 * page (which navigated immediately on success) — added to match the design
 * source's Step 5, which shows this summary before "Enter Stayo →".
 */
interface WelcomeSummaryStepProps {
  ctx: ActivationContext;
  tenantName: string;
  entering: boolean;
  onEnter: () => void;
}

export function WelcomeSummaryStep({ ctx, tenantName, entering, onEnter }: WelcomeSummaryStepProps) {
  const displayName = tenantName || ctx.profile?.name || 'there';

  return (
    <div className="space-y-6 text-center">
      <div className="flex flex-col items-center pt-2">
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary/15">
          <div className="absolute inset-0 animate-pulse rounded-full bg-primary/10" />
          <Home className="relative h-9 w-9 text-primary" strokeWidth={1.8} />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-wider text-primary">Admission Complete</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground">Welcome to the Stayo family!</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          You're officially a resident, {displayName}. Your room is ready — we can't wait to have you.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-secondary/20 p-4 text-left shadow-sm">
        <div className="flex items-center gap-2 border-b border-border/50 pb-2.5">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="text-xs font-bold text-success">Room confirmed · Move-in {fmtDate(ctx.room_summary.joining_date)}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-card border border-border/60 p-2.5">
            <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Room</span>
            <span className="text-base font-extrabold text-foreground">{ctx.room_summary.room_number || 'Assigned'}</span>
          </div>
          <div className="rounded-xl bg-card border border-border/60 p-2.5">
            <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Rent/mo</span>
            <span className="text-base font-extrabold text-foreground">{currency(ctx.room_summary.monthly_rent)}</span>
          </div>
          <div className="rounded-xl bg-card border border-border/60 p-2.5">
            <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Move-in</span>
            <span className="text-xs font-extrabold text-foreground block mt-1">{fmtDate(ctx.room_summary.joining_date)}</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-border bg-background p-4 text-left">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">What's next</p>
        <ul className="mt-2.5 space-y-2 text-sm text-foreground">
          <li className="flex items-start gap-2">
            <Key className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
            Collect your keys at the front desk on move-in day.
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
            Your first rent cycle begins {fmtDate(ctx.room_summary.joining_date)}.
          </li>
          <li className="flex items-start gap-2">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
            Message your hostel manager anytime from the app.
          </li>
        </ul>
      </div>

      <button
        type="button"
        onClick={onEnter}
        disabled={entering}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground px-5 py-3.5 text-sm font-semibold text-background disabled:opacity-60 active:scale-[0.98] transition-transform shadow-sm cursor-pointer"
      >
        {entering ? (
          <StayoLoader size="sm" label={null} />
        ) : (
          <>
            Enter Stayo
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}
