import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import {
  resolveInviteDelivery,
  resolveResendDelivery,
  type InviteDeliveryOutcome,
} from '../invite/inviteDelivery';
import { EMPTY_INVITE_WIZARD_DATA, type InviteWizardData } from '../types';

const STEP_LABELS = ['Tenant', 'Stay', 'Money', 'Verify'] as const;

const BILLING_TO_FREQUENCY: Record<string, string> = {
  Monthly: 'MONTHLY',
  Quarterly: 'QUARTERLY',
  'Half-Yearly': 'HALF_YEARLY',
  Yearly: 'ACADEMIC_YEARLY',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * Step index + form data + navigation for the 4-step Invite Tenant wizard.
 *
 * Submits to the real `POST /owners/invitations` and — new — actually reads
 * what came back. The invitation always gets created; whether it was
 * *delivered* is a separate question the backend answers with `whatsapp_sent`
 * / `email_sent` / `needs_email` / `activation_link`, all of which this hook
 * used to discard while the UI claimed success regardless.
 */
export function useInviteWizard() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<InviteWizardData>(EMPTY_INVITE_WIZARD_DATA);
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [delivery, setDelivery] = useState<InviteDeliveryOutcome | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [fallbackEmail, setFallbackEmail] = useState('');

  const setD = (patch: Partial<InviteWizardData>) => setData((d) => ({ ...d, ...patch }));

  const next = () => setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const email = data.tenantEmail.trim();
  const emailInvalid = email.length > 0 && !EMAIL_RE.test(email);

  const inviteMutation = useMutation({
    mutationFn: () =>
      tenantService.invite({
        name: data.tenantName.trim(),
        phone: data.tenantPhone.trim(),
        // Omitted rather than sent blank: the backend's InvitationSchema
        // accepts a missing email but validates a present one.
        ...(email ? { email } : {}),
        room_id: data.roomId,
        monthly_rent: Number(data.monthlyRent) || undefined,
        advance_amount: Number(data.deposit) || undefined,
        maintenance_amount: Number(data.maintenance) || undefined,
        joining_date: data.joiningDate || undefined,
        agreement_duration_months: Number(data.agreementMonths) || undefined,
        payment_frequency: BILLING_TO_FREQUENCY[data.billing] ?? 'MONTHLY',
      }),
    onSuccess: (response: unknown) => {
      const outcome = resolveInviteDelivery(response);
      setDelivery(outcome);
      setTenantId(
        (response as { tenant_id?: string } | null)?.tenant_id ?? null,
      );
      // Pre-fills the fallback prompt with whatever the owner already typed, so
      // a typo'd address is corrected rather than retyped from scratch.
      setFallbackEmail(email);
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenants', 'list-merged'] });
    },
  });

  /**
   * Adds an email to an invitation that was created but never delivered, and
   * re-dispatches it — the "don't make me start over" path for `needs_email`.
   * Reuses the existing `POST /tenants/resend-invitation`, whose `overrides`
   * already honour an `email`; no new backend surface.
   */
  const resendMutation = useMutation({
    mutationFn: async (address: string) => {
      const response = await tenantService.resendInvitation(tenantId, { email: address });
      return resolveResendDelivery(response, delivery?.activationLink ?? null);
    },
    onSuccess: (outcome: InviteDeliveryOutcome) => {
      setDelivery(outcome);
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenants', 'list-merged'] });
    },
  });

  const submit = () => {
    if (!agreed || !data.roomId || emailInvalid) return;
    inviteMutation.mutate();
  };

  const sendFallbackEmail = () => {
    const address = fallbackEmail.trim();
    if (!EMAIL_RE.test(address) || !tenantId) return;
    resendMutation.mutate(address);
  };

  const reset = () => {
    setStep(0);
    setData(EMPTY_INVITE_WIZARD_DATA);
    setAgreed(false);
    setSubmitted(false);
    setDelivery(null);
    setTenantId(null);
    setFallbackEmail('');
    inviteMutation.reset();
    resendMutation.reset();
  };

  return {
    step,
    stepLabels: STEP_LABELS,
    data,
    setD,
    agreed,
    setAgreed,
    emailInvalid,
    submitted,
    delivery,
    next,
    back,
    submit,
    reset,
    isSubmitting: inviteMutation.isPending,
    submitError: inviteMutation.isError ? getErrorMessage(inviteMutation.error, 'Could not send the invitation. Please try again.') : null,
    // Fallback-email prompt
    fallbackEmail,
    setFallbackEmail,
    sendFallbackEmail,
    isSendingFallback: resendMutation.isPending,
    fallbackError: resendMutation.isError
      ? getErrorMessage(resendMutation.error, 'Could not send the email invitation.')
      : null,
    canSendFallback: EMAIL_RE.test(fallbackEmail.trim()) && Boolean(tenantId),
  };
}

export type InviteWizardApi = ReturnType<typeof useInviteWizard>;
