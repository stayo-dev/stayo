import { useEffect } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useInviteWizard } from '../hooks/useInviteWizard';
import { InviteDeliveryResult } from './InviteDeliveryResult';
import { TenantStep } from './steps/TenantStep';
import { StayStep } from './steps/StayStep';
import { MoneyStep } from './steps/MoneyStep';
import { VerifyStep } from './steps/VerifyStep';
import type { InviteWizardData } from '../types';

interface InviteTenantWizardProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fills the form — e.g. from an accepted lead — instead of starting blank. */
  initialData?: Partial<InviteWizardData>;
  /** When set, the invitation is created via the lead-aware endpoint so the tenant links back to the enquiry it came from. */
  leadId?: string;
}

/** 4-step Invite Tenant wizard (Tenant → Stay → Money → Verify), per Stayo App.dc.html. Submits to the real invite endpoint. */
export function InviteTenantWizard({ open, onClose, initialData, leadId }: InviteTenantWizardProps) {
  const wizard = useInviteWizard({ initialData, leadId });
  const session = useOwnerSession();

  useEffect(() => {
    if (open) wizard.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    onClose();
  };

  // The invitation was created; whether it was *delivered* is a separate
  // question, answered by `wizard.delivery`. This screen used to claim success
  // unconditionally — see InviteDeliveryResult.
  if (wizard.submitted && wizard.delivery) {
    const delivered = wizard.delivery.channel !== 'none';
    return (
      <BottomSheet
        open={open}
        onOpenChange={(v) => !v && handleClose()}
        title={delivered ? 'Invitation sent' : 'Invitation not delivered'}
      >
        <InviteDeliveryResult
          delivery={wizard.delivery}
          tenantName={wizard.data.tenantName}
          tenantPhone={wizard.data.tenantPhone}
          onDone={handleClose}
          fallbackEmail={wizard.fallbackEmail}
          setFallbackEmail={wizard.setFallbackEmail}
          sendFallbackEmail={wizard.sendFallbackEmail}
          isSendingFallback={wizard.isSendingFallback}
          fallbackError={wizard.fallbackError}
          canSendFallback={wizard.canSendFallback}
        />
      </BottomSheet>
    );
  }

  const isLast = wizard.step === wizard.stepLabels.length - 1;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      title={
        <span className="flex items-center gap-2">
          {wizard.step > 0 && (
            <button type="button" onClick={wizard.back} aria-label="Back" className="text-muted-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          Invite tenant
        </span>
      }
      footer={
        <div className="flex gap-2.5">
          {wizard.step > 0 && (
            <button type="button" onClick={wizard.back} className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground">
              Back
            </button>
          )}
          <button
            type="button"
            onClick={isLast ? wizard.submit : wizard.next}
            disabled={!wizard.isCurrentStepValid || wizard.isSubmitting}
            className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {isLast ? (wizard.isSubmitting ? 'Sending…' : 'Send invitation') : `Continue to ${wizard.stepLabels[wizard.step + 1]?.toLowerCase()}`}
          </button>
        </div>
      }
    >
      <div className="mb-5 flex items-center gap-1.5">
        {wizard.stepLabels.map((label, i) => (
          <div key={label} className="flex flex-1 items-center gap-1.5 last:flex-none">
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-6 w-6 flex-none items-center justify-center rounded-full font-display text-xs font-bold ${
                  i < wizard.step ? 'bg-primary text-primary-foreground' : i === wizard.step ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                }`}
              >
                {i < wizard.step ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`text-[13px] font-semibold ${i <= wizard.step ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
            </div>
            {i < wizard.stepLabels.length - 1 && <span className={`h-0.5 flex-1 rounded-full ${i < wizard.step ? 'bg-primary' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      {wizard.emailInvalid && (
        <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          That email address doesn&apos;t look right. Fix it, or clear it to send by WhatsApp only.
        </p>
      )}

      {wizard.submitConflict ? (
        <div className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          <p className="mb-0.5 font-bold">{wizard.submitConflict.title}</p>
          <p className="font-medium">{wizard.submitConflict.body}</p>
        </div>
      ) : wizard.submitError ? (
        <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          {wizard.submitError}
        </p>
      ) : null}

      {wizard.step === 0 && (
        <TenantStep
          data={wizard.data}
          setD={wizard.setD}
          isCheckingEligibility={wizard.isCheckingEligibility}
          eligibilityConflict={wizard.eligibilityConflict}
          hasExistingAccount={wizard.hasExistingAccount}
        />
      )}
      {wizard.step === 1 && <StayStep data={wizard.data} setD={wizard.setD} hostels={session.hostels} />}
      {wizard.step === 2 && <MoneyStep data={wizard.data} setD={wizard.setD} />}
      {wizard.step === 3 && <VerifyStep data={wizard.data} agreed={wizard.agreed} setAgreed={wizard.setAgreed} hostels={session.hostels} />}
    </BottomSheet>
  );
}
