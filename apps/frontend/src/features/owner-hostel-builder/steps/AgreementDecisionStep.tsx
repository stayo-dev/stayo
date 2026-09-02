import type { ReactNode } from 'react';
import { Check, FileText, ShieldOff } from 'lucide-react';
import { SignaturePad } from '@shared/ui/inputs';
import { eyebrow, h1, sub } from '@features/owner-onboarding/components/stepStyles';
import type { AgreementChoice } from '../agreementSetup';

/**
 * The Add Hostel builder's last question — one decision, made once, for the
 * whole hostel.
 *
 * This is deliberately the *only* place a StayO owner is asked about a tenant
 * agreement during setup: not per room (rooms just belong to the hostel and
 * inherit whatever this screen decides), and not per tenant (every tenant of
 * this hostel automatically gets whatever is configured here — the owner is
 * never asked to sign again). See `agreementSetup.ts` for why "settled" is
 * defined the way it is, and why an untouched "required" default still counts
 * as unanswered.
 *
 * The Yes/No copy mirrors `MoreConfigAgreementRequirementPage`'s consequence
 * text on purpose — an owner who later revisits that settings page should
 * recognise the same framing, not a different explanation for the same
 * switch.
 */

const CONSEQUENCES: Record<'yes' | 'no', { title: string; points: string[] }> = {
  yes: {
    title: 'Tenants sign before they are activated',
    points: [
      'They accept your hostel rules, then sign the residency agreement.',
      'Your signature below is reused automatically for every tenant here — you will not be asked again.',
      'Uses the standard agreement; edit its wording anytime from this hostel’s Settings tab.',
    ],
  },
  no: {
    title: 'Tenants are activated without signing',
    points: [
      'The rules and agreement steps are skipped during onboarding.',
      'Rent, dues, deposits and move-out settlement are unaffected.',
      'You can turn this on later from this hostel’s Settings tab.',
    ],
  },
};

function ChoiceCard({
  active,
  icon,
  title,
  description,
  onSelect,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
        active ? 'border-primary bg-primary/5' : 'border-border bg-card/90 hover:bg-muted/40'
      }`}
    >
      <div
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-display text-[14.5px] font-bold text-foreground">
          {title}
          {active && <Check className="h-3.5 w-3.5 flex-none text-primary" strokeWidth={3} />}
        </div>
        <div className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}

export function AgreementDecisionStep({
  choice,
  onChoiceChange,
  hasSignature,
  existingSignatureUrl,
  onSignatureChange,
  reusableSignature,
  onReuseSignature,
}: {
  choice: AgreementChoice;
  onChoiceChange: (choice: AgreementChoice) => void;
  hasSignature: boolean;
  existingSignatureUrl: string | null;
  onSignatureChange: (blob: Blob | null) => void;
  /** A signature this owner already captured on another hostel, if any. */
  reusableSignature: { url: string; from_hostel_name: string | null } | null;
  onReuseSignature: (url: string) => void;
}) {
  const consequence = choice ? CONSEQUENCES[choice] : null;

  return (
    <div>
      <div className={eyebrow}>ONE LAST THING</div>
      <h1 className={h1}>Does this hostel use a tenant agreement?</h1>
      <p className={sub}>
        This is a hostel-wide setting — it applies to every room and every tenant here, not one at a
        time.
      </p>

      <div className="flex max-w-[460px] flex-col gap-2.5">
        <ChoiceCard
          active={choice === 'yes'}
          icon={<FileText className="h-4.5 w-4.5" strokeWidth={2} />}
          title="Yes, this hostel uses an agreement"
          description="Tenants review and sign before activation."
          onSelect={() => onChoiceChange('yes')}
        />
        <ChoiceCard
          active={choice === 'no'}
          icon={<ShieldOff className="h-4.5 w-4.5" strokeWidth={2} />}
          title="No, this hostel doesn't use an agreement"
          description="Tenants are activated without signing anything."
          onSelect={() => onChoiceChange('no')}
        />
      </div>

      {consequence && (
        <div className="mt-4 max-w-[460px] rounded-xl border border-border bg-muted/40 px-3.5 py-3">
          <div className="font-display text-[12.5px] font-bold text-foreground">{consequence.title}</div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {consequence.points.map((point) => (
              <li key={point} className="flex gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
                <span aria-hidden className="mt-[7px] h-1 w-1 flex-none rounded-full bg-muted-foreground/60" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {choice === 'yes' && reusableSignature && !hasSignature && (
        /*
          `owner_signature_url` lives on the per-hostel agreement template, so
          an owner running three hostels was asked to draw the same signature
          three times. It is the same person signing the same way; the repeat
          asked for nothing but patience. Offered, never applied automatically
          — the owner confirms, and can still draw a fresh one below.
        */
        <div className="mt-5 max-w-[460px] rounded-xl border border-primary/30 bg-primary/5 p-3.5">
          <div className="font-display text-[12.5px] font-bold text-foreground">
            Use the signature you already have?
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {reusableSignature.from_hostel_name
              ? `The one on your ${reusableSignature.from_hostel_name} agreement.`
              : 'The one from your existing hostel agreement.'}
          </p>
          <div className="mt-2.5 overflow-hidden rounded-lg border border-border bg-card p-2">
            <img
              src={reusableSignature.url}
              alt="Your existing signature"
              className="mx-auto h-16 w-auto object-contain"
            />
          </div>
          <button
            type="button"
            onClick={() => onReuseSignature(reusableSignature.url)}
            className="mt-2.5 w-full rounded-xl bg-primary py-2.5 text-center font-display text-[13px] font-bold text-primary-foreground"
          >
            Use this signature
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Or draw a new one below</p>
        </div>
      )}

      {choice === 'yes' && (
        <div className="mt-5 max-w-[460px]">
          <span className="font-display text-xs font-bold tracking-wide text-primary">
            YOUR SIGNATURE
          </span>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Captured once here — it appears on every tenant's agreement for this hostel automatically.
            Draw it, or upload a photo of your signature on paper.
          </p>
          <div className="mt-2.5 overflow-hidden rounded-xl border border-border bg-card/90 p-3">
            {/* Upload is enabled here and nowhere else: this is the owner
                capturing their own signature once for their own hostel's
                template. The tenant-facing pads stay draw-only — see the prop's
                own note and ADR-140. */}
            <SignaturePad
              onSave={onSignatureChange}
              existingSignatureUrl={existingSignatureUrl}
              placeholder="Draw your signature here"
              allowUpload
            />
          </div>
          {hasSignature && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-success">
              <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> Signature captured
            </span>
          )}
        </div>
      )}
    </div>
  );
}
