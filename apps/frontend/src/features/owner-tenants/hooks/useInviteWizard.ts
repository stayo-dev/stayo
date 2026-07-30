import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import { EMPTY_INVITE_WIZARD_DATA, type InviteWizardData } from '../types';

const STEP_LABELS = ['Tenant', 'Stay', 'Money', 'Verify'] as const;

const BILLING_TO_FREQUENCY: Record<string, string> = {
  Monthly: 'MONTHLY',
  Quarterly: 'QUARTERLY',
  'Half-Yearly': 'HALF_YEARLY',
  Yearly: 'ACADEMIC_YEARLY',
};

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/** Step index + form data + navigation for the 4-step Invite Tenant wizard. Submits to the real `POST /owners/invitations` (`tenantService.invite`). */
export function useInviteWizard() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<InviteWizardData>(EMPTY_INVITE_WIZARD_DATA);
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const setD = (patch: Partial<InviteWizardData>) => setData((d) => ({ ...d, ...patch }));

  const next = () => setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const inviteMutation = useMutation({
    mutationFn: () =>
      tenantService.invite({
        name: data.tenantName.trim(),
        phone: data.tenantPhone.trim(),
        room_id: data.roomId,
        monthly_rent: Number(data.monthlyRent) || undefined,
        advance_amount: Number(data.deposit) || undefined,
        maintenance_amount: Number(data.maintenance) || undefined,
        joining_date: data.joiningDate || undefined,
        agreement_duration_months: Number(data.agreementMonths) || undefined,
        payment_frequency: BILLING_TO_FREQUENCY[data.billing] ?? 'MONTHLY',
      }),
    onSuccess: () => {
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenants', 'list-merged'] });
    },
  });

  const submit = () => {
    if (!agreed || !data.roomId) return;
    inviteMutation.mutate();
  };

  const reset = () => {
    setStep(0);
    setData(EMPTY_INVITE_WIZARD_DATA);
    setAgreed(false);
    setSubmitted(false);
    inviteMutation.reset();
  };

  return {
    step,
    stepLabels: STEP_LABELS,
    data,
    setD,
    agreed,
    setAgreed,
    submitted,
    next,
    back,
    submit,
    reset,
    isSubmitting: inviteMutation.isPending,
    submitError: inviteMutation.isError ? getErrorMessage(inviteMutation.error, 'Could not send the invitation. Please try again.') : null,
  };
}

export type InviteWizardApi = ReturnType<typeof useInviteWizard>;
