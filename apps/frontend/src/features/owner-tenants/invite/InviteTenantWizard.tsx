import { useEffect } from 'react';
import { AlertTriangle, Check, ChevronLeft } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
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

  // WhatsApp is the only channel that reaches a tenant with no login, and it
  // defaults to off per hostel (ADR — see `reminder_whatsapp` in hostel-policy-service).
  // Mirrors AdoptTenantSheet's gating so this wizard doesn't promise a delivery
  // that most hostels haven't turned on.
  const hostelPolicyQuery = useHostelPolicy(wizard.data.hostelId || null);
  const whatsappRemindersOn = Boolean(hostelPolicyQuery.data?.policy?.reminders?.channels?.whatsapp);

  useEffect(() => {
    if (open) wizard.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    onClose();
  };

  // "Just add to my records" has nothing to report on delivery — nothing was
  // sent — so it gets its own short landing rather than routing through
  // InviteDeliveryResult, which would otherwise show a meaningless
  // whatsapp/email/none outcome for a tenant nobody tried to notify.
  if (wizard.ownerManagedSuccess) {
    return (
      <BottomSheet open={open} onOpenChange={(v) => !v && handleClose()} title="Tenant added">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <Check className="h-6 w-6" strokeWidth={3} />
          </span>
          <p className="text-sm font-bold text-foreground">{wizard.data.tenantName || 'The tenant'} is now active.</p>
          <p className="text-[12.5px] text-muted-foreground">
            No invite was sent. You keep the records
            {whatsappRemindersOn ? ', and rent reminders still go to their WhatsApp.' : '.'}
          </p>
          {!whatsappRemindersOn && (
            <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-left text-[12px] font-semibold text-warning">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.2} />
              <span>WhatsApp reminders are off for this hostel — they won&apos;t receive anything until you turn them on.</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground"
        >
          Done
        </button>
      </BottomSheet>
    );
  }

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
        <div className="flex flex-col gap-2">
          <div className="flex gap-2.5">
            {wizard.step > 0 && (
              <button type="button" onClick={wizard.back} className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground">
                Back
              </button>
            )}
            <button
              type="button"
              onClick={isLast ? wizard.submit : wizard.next}
              disabled={!wizard.isCurrentStepValid || wizard.isSubmitting || wizard.isSubmittingOwnerManaged}
              className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {isLast ? (wizard.isSubmitting ? 'Sending…' : 'Send invite') : `Continue to ${wizard.stepLabels[wizard.step + 1]?.toLowerCase()}`}
            </button>
          </div>
          {isLast && (
            <div className="flex flex-col items-center gap-1 pt-0.5">
              <button
                type="button"
                onClick={wizard.submitAsOwnerManaged}
                disabled={!wizard.isOwnerManagedValid || wizard.isSubmitting || wizard.isSubmittingOwnerManaged}
                className="font-display text-[13px] font-bold text-muted-foreground underline decoration-dotted underline-offset-4 disabled:opacity-50"
              >
                {wizard.isSubmittingOwnerManaged ? 'Adding…' : 'Just add to my records'}
              </button>
              <p className="text-center text-[11.5px] leading-snug text-muted-foreground">
                {whatsappRemindersOn
                  ? 'No invite sent. You keep the records; reminders still go to their WhatsApp.'
                  : "No invite sent. You keep the records. WhatsApp reminders are off for this hostel — they won't receive anything until you turn them on."}
              </p>
            </div>
          )}
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

      {(wizard.submitError || wizard.ownerManagedError) && (
        <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          {wizard.submitError || wizard.ownerManagedError}
        </p>
      )}

      {wizard.step === 0 && <TenantStep data={wizard.data} setD={wizard.setD} />}
      {wizard.step === 1 && <StayStep data={wizard.data} setD={wizard.setD} hostels={session.hostels} />}
      {wizard.step === 2 && <MoneyStep data={wizard.data} setD={wizard.setD} />}
      {wizard.step === 3 && <VerifyStep data={wizard.data} agreed={wizard.agreed} setAgreed={wizard.setAgreed} hostels={session.hostels} />}
    </BottomSheet>
  );
}
