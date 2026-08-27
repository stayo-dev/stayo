import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import { admissionsService } from '@features/admissions/api';
import { ownerManagedService } from '../api/ownerManaged';
import { parseTenancyConflict } from '@features/tenants/tenancyConflict';
import { queryKeys } from '@lib/queryKeys';
import {
  resolveInviteDelivery,
  resolveResendDelivery,
  type InviteDeliveryOutcome,
} from '../invite/inviteDelivery';
import { conflictFromPreview, type EligibilityPreview } from '../invite/eligibilityCheck';
import {
  sanitizeIndianPhone,
  isValidIndianPhone,
  isValidTenantEmail,
  isValidTenantName,
  EMAIL_REGEX,
} from '../invite/validation';
import { EMPTY_INVITE_WIZARD_DATA, type InviteWizardData } from '../types';

const ELIGIBILITY_DEBOUNCE_MS = 400;

export interface UseInviteWizardOptions {
  /** Pre-fills the form — e.g. from an accepted lead — instead of starting blank. */
  initialData?: Partial<InviteWizardData>;
  /**
   * When set, submit calls the lead-aware `POST /leads/:id/convert-to-invitation`
   * instead of the plain invite endpoint, so the created tenant is linked back
   * to the lead it came from (`visitor_leads.converted_tenant_id`).
   */
  leadId?: string;
}

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

/**
 * Step index + form data + navigation for the 4-step Invite Tenant wizard.
 *
 * Submits to the real `POST /owners/invitations` and — new — actually reads
 * what came back. The invitation always gets created; whether it was
 * *delivered* is a separate question the backend answers with `whatsapp_sent`
 * / `email_sent` / `needs_email` / `activation_link`, all of which this hook
 * used to discard while the UI claimed success regardless.
 */
export function useInviteWizard(options: UseInviteWizardOptions = {}) {
  const { initialData, leadId } = options;
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<InviteWizardData>({ ...EMPTY_INVITE_WIZARD_DATA, ...initialData });
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [delivery, setDelivery] = useState<InviteDeliveryOutcome | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [fallbackEmail, setFallbackEmail] = useState('');

  const setD = (patch: Partial<InviteWizardData>) => setData((d) => ({ ...d, ...patch }));

  // Pre-submit tenancy-eligibility check — debounced on the phone field, so
  // the owner learns about a blocked/existing number before filling out the
  // rest of the wizard rather than only on a 409 at final Submit.
  const cleanedPhone = sanitizeIndianPhone(data.tenantPhone);
  const [debouncedPhone, setDebouncedPhone] = useState(cleanedPhone);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPhone(cleanedPhone), ELIGIBILITY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [cleanedPhone]);

  // Phone only, deliberately — the invite's `email` field is optional and
  // belongs to whoever the owner is inviting; combining it into the same OR
  // lookup could attribute an unrelated profile's conflict to this phone
  // number if the two happened to mismatch.
  const eligibilityEnabled = isValidIndianPhone(debouncedPhone);
  const eligibilityQuery = useQuery({
    queryKey: queryKeys.owner.invitationEligibility(debouncedPhone, ''),
    queryFn: () => tenantService.checkEligibility(debouncedPhone) as Promise<EligibilityPreview>,
    enabled: eligibilityEnabled,
    staleTime: 30_000,
  });

  const eligibilityConflict = eligibilityQuery.data ? conflictFromPreview(eligibilityQuery.data) : null;
  const isCheckingEligibility =
    isValidIndianPhone(cleanedPhone) &&
    (debouncedPhone !== cleanedPhone || (eligibilityQuery.isFetching && !eligibilityQuery.data));
  const hasExistingAccount = Boolean(eligibilityQuery.data?.has_account) && !eligibilityConflict;

  const isStep0Valid =
    isValidTenantName(data.tenantName) &&
    isValidIndianPhone(data.tenantPhone) &&
    isValidTenantEmail(data.tenantEmail) &&
    !eligibilityConflict;
  const isStep1Valid = Boolean(data.hostelId && data.roomId && data.joiningDate && Number(data.agreementMonths) > 0);
  const isStep2Valid = Boolean(data.monthlyRent && Number(data.monthlyRent) >= 0);
  const isStep3Valid = Boolean(agreed && data.roomId && isStep0Valid && isStep1Valid && isStep2Valid);
  // Owner-managed tenants never receive anything, so an email — valid,
  // invalid, or blank — is irrelevant to this path. Name and phone still are.
  // `!eligibilityConflict` is not optional here: "Just add to my records"
  // creates the exact same ACTIVE tenancy an accepted invite eventually does
  // (see `ownerManagedMutation` below), so it is bound by the same one-live-
  // tenancy-per-person rule the "Send invite" path enforces via `isStep0Valid`
  // — without this, a person already active at another hostel could be
  // blocked from Send but waved through this second exit instead.
  const isOwnerManagedValid = Boolean(
    agreed &&
      data.roomId &&
      isValidTenantName(data.tenantName) &&
      isValidIndianPhone(data.tenantPhone) &&
      !eligibilityConflict &&
      isStep1Valid &&
      isStep2Valid,
  );

  const isCurrentStepValid = (() => {
    switch (step) {
      case 0:
        return isStep0Valid;
      case 1:
        return isStep1Valid;
      case 2:
        return isStep2Valid;
      case 3:
        return isStep3Valid;
      default:
        return false;
    }
  })();

  const next = () => {
    if (!isCurrentStepValid) return;
    setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const email = data.tenantEmail.trim();
  const emailInvalid = !isValidTenantEmail(email);

  // Same "who am I creating this tenancy for" payload, and the same
  // create-invitation call (lead-aware endpoint when converting from a lead,
  // plain invite endpoint otherwise), regardless of whether the owner ends up
  // sending it (`submit`) or immediately adopting it (`submitAsOwnerManaged`).
  // The tenancy row, reservation and terms are created identically either way.
  const buildInvitePayload = (options: { suppressNotification?: boolean } = {}) => ({
    name: data.tenantName.trim(),
    phone: sanitizeIndianPhone(data.tenantPhone),
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
    // Omitted (not `false`) for the ordinary "Send invite" path, so that
    // request is byte-identical to before this flag existed. Only
    // `submitAsOwnerManaged` ("Just add to my records") sets this — the
    // invitation record still gets created, but the WhatsApp/email send that
    // path's caption promises never happens is suppressed.
    ...(options.suppressNotification ? { suppressInvitationNotification: true } : {}),
  });

  const createInvitation = async (options: { suppressNotification?: boolean } = {}) => {
    const payload = buildInvitePayload(options);
    if (leadId) {
      // Response is { invitation, lead } — unwrap so the rest of this hook
      // (resolveInviteDelivery, tenant_id) sees the same flat shape either way.
      const result = (await admissionsService.convertToInvitation(leadId, payload)) as { invitation?: unknown } | null;
      return result?.invitation ?? result;
    }
    return tenantService.invite(payload);
  };

  const inviteMutation = useMutation({
    mutationFn: createInvitation,
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
      if (leadId) queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all() });
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

  /**
   * "Just add to my records" — the tenant never has to open a link. Creates
   * the exact same tenancy the invite path would, then immediately adopts it
   * (Task 8's `ownerManagedService.adopt`), so it lands `ACTIVE` /
   * `OWNER_MANAGED` rather than sitting `INVITED` waiting on someone who was
   * never going to click through.
   */
  const ownerManagedMutation = useMutation({
    mutationFn: async () => {
      const created = (await createInvitation({ suppressNotification: true })) as { tenant_id?: string } | null;
      const newTenantId = created?.tenant_id;
      if (!newTenantId) throw new Error('Tenant was created but no tenant_id came back.');
      return ownerManagedService.adopt({ tenantId: newTenantId, hostelId: data.hostelId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenants', 'list-merged'] });
      if (leadId) queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all() });
    },
  });

  const submit = () => {
    if (!isStep3Valid) return;
    inviteMutation.mutate();
  };

  const submitAsOwnerManaged = () => {
    if (!isOwnerManagedValid) return;
    ownerManagedMutation.mutate();
  };

  const sendFallbackEmail = () => {
    const address = fallbackEmail.trim();
    if (!EMAIL_REGEX.test(address) || !tenantId) return;
    resendMutation.mutate(address);
  };

  const reset = () => {
    setStep(0);
    setData({ ...EMPTY_INVITE_WIZARD_DATA, ...initialData });
    setAgreed(false);
    setSubmitted(false);
    setDelivery(null);
    setTenantId(null);
    setFallbackEmail('');
    inviteMutation.reset();
    resendMutation.reset();
    ownerManagedMutation.reset();
  };

  return {
    step,
    stepLabels: STEP_LABELS,
    data,
    setD,
    agreed,
    setAgreed,
    emailInvalid,
    isCurrentStepValid,
    submitted,
    delivery,
    next,
    back,
    submit,
    reset,
    isSubmitting: inviteMutation.isPending,
    submitError: inviteMutation.isError ? getErrorMessage(inviteMutation.error, 'Could not send the invitation. Please try again.') : null,
    // 409 safety net for the check→submit race (e.g. the number gets invited
    // elsewhere between the debounced check and Submit) — same OWN/OTHER
    // scoped card the pre-submit check already renders, built from the error.
    submitConflict: inviteMutation.isError ? parseTenancyConflict(inviteMutation.error) : null,
    eligibilityConflict,
    isCheckingEligibility,
    hasExistingAccount,
    // "Just add to my records" — parallel state to the invite path above, kept
    // separate because success here means something different: no delivery
    // result to show, just "this tenant now exists and is active." Bound by
    // the same tenancy-conflict rule as the invite path (see
    // `isOwnerManagedValid` above for the pre-submit gate); this is the same
    // 409 safety net for the same check→submit race.
    submitAsOwnerManaged,
    isOwnerManagedValid,
    isSubmittingOwnerManaged: ownerManagedMutation.isPending,
    ownerManagedSuccess: ownerManagedMutation.isSuccess,
    ownerManagedConflict: ownerManagedMutation.isError ? parseTenancyConflict(ownerManagedMutation.error) : null,
    ownerManagedError: ownerManagedMutation.isError
      ? getErrorMessage(ownerManagedMutation.error, 'Could not add this tenant. Please try again.')
      : null,
    // Fallback-email prompt
    fallbackEmail,
    setFallbackEmail,
    sendFallbackEmail,
    isSendingFallback: resendMutation.isPending,
    fallbackError: resendMutation.isError
      ? getErrorMessage(resendMutation.error, 'Could not send the email invitation.')
      : null,
    canSendFallback: EMAIL_REGEX.test(fallbackEmail.trim()) && Boolean(tenantId),
  };
}

export type InviteWizardApi = ReturnType<typeof useInviteWizard>;
