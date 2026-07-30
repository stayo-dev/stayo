import { useEffect } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useInviteWizard } from '../hooks/useInviteWizard';
import { TenantStep } from './steps/TenantStep';
import { StayStep } from './steps/StayStep';
import { MoneyStep } from './steps/MoneyStep';
import { VerifyStep } from './steps/VerifyStep';

interface InviteTenantWizardProps {
  open: boolean;
  onClose: () => void;
}

/** 4-step Invite Tenant wizard (Tenant → Stay → Money → Verify), per Stayo App.dc.html. Submits to the real invite endpoint. */
export function InviteTenantWizard({ open, onClose }: InviteTenantWizardProps) {
  const wizard = useInviteWizard();
  const session = useOwnerSession();

  useEffect(() => {
    if (open) wizard.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    onClose();
  };

  if (wizard.submitted) {
    return (
      <BottomSheet open={open} onOpenChange={(v) => !v && handleClose()} title="Invitation sent">
        <div className="flex flex-col items-center gap-3.5 py-6 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <Check className="h-7 w-7 text-success" strokeWidth={3} />
          </span>
          <p className="font-display text-lg font-extrabold text-foreground">Invitation sent!</p>
          <p className="text-[12.5px] text-muted-foreground">{wizard.data.tenantName || 'The tenant'} will get a text to complete KYC.</p>
          <button
            type="button"
            onClick={handleClose}
            className="mt-2 rounded-xl bg-primary px-6 py-3 font-display text-sm font-bold text-primary-foreground"
          >
            Done
          </button>
        </div>
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
            disabled={(isLast && (!wizard.agreed || !wizard.data.roomId)) || wizard.isSubmitting}
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

      {wizard.submitError && (
        <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          {wizard.submitError}
        </p>
      )}

      {wizard.step === 0 && <TenantStep data={wizard.data} setD={wizard.setD} />}
      {wizard.step === 1 && <StayStep data={wizard.data} setD={wizard.setD} hostels={session.hostels} />}
      {wizard.step === 2 && <MoneyStep data={wizard.data} setD={wizard.setD} />}
      {wizard.step === 3 && <VerifyStep data={wizard.data} agreed={wizard.agreed} setAgreed={wizard.setAgreed} hostels={session.hostels} />}
    </BottomSheet>
  );
}
