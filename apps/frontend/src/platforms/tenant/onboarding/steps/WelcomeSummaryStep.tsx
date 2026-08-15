import { ArrowRight, Download } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import type { ActivationContext } from '../activationTypes';
import { PrimaryActionButton, StepActionBar } from './shared';
import { currency, fmtDate } from '../activationTypes';

/**
 * Step 5 — "Welcome to the Stayo Family!": a celebration/summary screen
 * shown after the backend's `ACTIVATE` step succeeds, before handing off the
 * new session and entering the tenant portal. Rebuilt 2026-08-14 to match
 * `Stayo Onboarding.dc.html`'s Step 5 exactly — inline hex colors/cards/copy
 * read directly from the design source, including its dark (not primary)
 * "Enter Stayo" CTA and the "Download signed agreement" row inside the
 * summary card, which the previous version was missing.
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
    <div className="px-1 pb-1 pt-1.5 text-center" style={{ animation: 'obFade .3s ease' }}>
      <div className="relative mx-auto mt-1.5" style={{ width: 96, height: 96 }}>
        <div className="absolute inset-0 rounded-full" style={{ background: '#DCEFE4', opacity: 0.6 }} />
        <div className="absolute overflow-hidden rounded-full" style={{ inset: 12, boxShadow: '0 10px 26px rgba(180,106,85,.4)' }}>
          <img src="/stayo-icon.png" alt="Stayo" className="h-full w-full object-cover" />
        </div>
        <div className="absolute rounded-[2px]" style={{ top: -4, left: 6, width: 7, height: 7, background: '#D2986C', transform: 'rotate(20deg)' }} />
        <div className="absolute rounded-full" style={{ top: 8, right: -6, width: 6, height: 6, background: '#1F9D57' }} />
        <div className="absolute rounded-full" style={{ bottom: 2, left: -8, width: 6, height: 6, background: '#B46A55' }} />
        <div className="absolute rounded-[2px]" style={{ bottom: -4, right: 10, width: 7, height: 7, background: '#E0B15E', transform: 'rotate(-15deg)' }} />
      </div>

      <p className="mt-4.5 text-[10px] font-extrabold uppercase" style={{ color: '#B46A55', letterSpacing: '.14em' }}>
        Admission Complete
      </p>
      <h2 className="font-display mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight" style={{ color: '#1A1A1A' }}>
        Welcome to the
        <br />
        Stayo family!
      </h2>
      <p className="mx-auto mt-2 max-w-sm px-1.5 text-[12.5px] leading-relaxed" style={{ color: '#6E6459' }}>
        You're officially a resident, {displayName}. Your room is ready — we can't wait to have you.
      </p>

      <div className="mt-4.5 rounded-2xl p-3.5 text-left" style={{ background: '#fff', border: '1px solid #EFE6DA', boxShadow: '0 6px 18px rgba(40,30,20,.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: '#1F9D57', boxShadow: '0 0 8px #1F9D57' }} />
            <span className="font-display text-xs font-extrabold" style={{ color: '#1F7A52' }}>
              Room confirmed
            </span>
          </div>
          <span className="text-[11px] font-bold" style={{ color: '#8A7F75' }}>
            Move-in {fmtDate(ctx.room_summary.joining_date)}
          </span>
        </div>
        <div className="mt-3.5 flex gap-2.5">
          {[
            { value: ctx.room_summary.room_number || 'Assigned', label: 'Room' },
            { value: currency(ctx.room_summary.monthly_rent), label: 'Rent/mo' },
            { value: fmtDate(ctx.room_summary.joining_date), label: 'Move-in' },
          ].map((m) => (
            <div key={m.label} className="flex-1 rounded-[10px] p-[10px_8px] text-center" style={{ background: '#F9F5EF' }}>
              <div className="font-display text-sm font-extrabold" style={{ color: '#1A1A1A' }}>
                {m.value}
              </div>
              <div className="mt-0.5 text-[9.5px] font-semibold uppercase" style={{ color: '#8A7F75', letterSpacing: '.04em' }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>
        {ctx.agreement?.pdf_url && (
          <a
            href={ctx.agreement.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-center gap-1.5 rounded-[10px] py-2.5 text-[12.5px] font-bold"
            style={{ background: '#F6F1EA', border: '1px solid #E7DDCE', color: '#3A342E' }}
          >
            <Download className="h-3.5 w-3.5" />
            Download signed agreement
          </a>
        )}
      </div>

      <div className="mt-3 rounded-2xl p-[13px_14px] text-left" style={{ background: '#F9F5EF', border: '1px dashed #E2D3C4' }}>
        <p className="mb-1 text-[10px] font-extrabold uppercase" style={{ color: '#9A8F84', letterSpacing: '.08em' }}>
          What's next
        </p>
        {[
          'Collect your keys at the front desk on move-in day.',
          `Your first rent cycle begins ${fmtDate(ctx.room_summary.joining_date)}.`,
          'Message your hostel manager anytime from the app.',
        ].map((n) => (
          <div key={n} className="mt-2 flex items-start gap-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ background: '#B46A55' }} />
            <span className="text-xs leading-snug" style={{ color: '#5A5147' }}>
              {n}
            </span>
          </div>
        ))}
      </div>

      <StepActionBar>
        <PrimaryActionButton dark onClick={onEnter} disabled={entering}>
          {entering ? (
            <StayoLoader size="sm" label={null} />
          ) : (
            <>
              Enter Stayo
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </PrimaryActionButton>
      </StepActionBar>
    </div>
  );
}
