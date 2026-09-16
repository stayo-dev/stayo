import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { authApi } from '@lib/authApi';
import { AdminDrawer } from '../drawer/AdminDrawer';
import { useToast } from '../layout/toastContext';
import {
  type WizardStep,
  type DetailsForm,
  validateDetailsForm,
  validateOtpInput,
  resolveSendCodeOutcome,
  describeAddOwnerError,
  getErrorCode,
  sortPlanOptions,
} from './addOwnerFlow';

const inputClass =
  'w-full rounded-[10px] border border-[#E7DDD1] bg-white px-3 py-2.5 text-[13px] text-[#2A2521] outline-none focus:border-[#B46A55]';
const labelClass = 'mb-1.5 block text-[11.5px] font-semibold text-[#8A7F75]';
const primaryButtonClass =
  'w-full rounded-[10px] bg-[#221E1A] px-4 py-2.5 text-center font-admin text-[13px] font-bold text-white disabled:opacity-40';
const secondaryButtonClass =
  'w-full rounded-[10px] border border-[#E7DDD1] bg-white px-4 py-2.5 text-center text-[13px] font-semibold text-[#5A5147]';
const errorTextClass = 'mt-1.5 text-[12px] font-medium text-[#B3402F]';

/**
 * Admin -> Add Owner (field/direct marketing). 4-step wizard: Details ->
 * Verify phone (existing OTP mechanism) -> Plan (existing subscription
 * catalog) -> Review & Send (existing invitation link system). Every step
 * calls an existing/new-but-thin backend endpoint — no logic lives here
 * beyond sequencing, which is why the actual decisions (validation, error
 * copy, plan sort) live in the tested addOwnerFlow.ts module instead.
 */
export function AddOwnerDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fireToast = useToast();

  const [step, setStep] = useState<WizardStep>('details');
  const [form, setForm] = useState<DetailsForm>({ name: '', email: '', phone: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);

  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpAwaited, setOtpAwaited] = useState(true);

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const [activationLink, setActivationLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const plans = useQuery({
    queryKey: ['admin', 'subscription-plans'],
    queryFn: () => platformAdminService.getSubscriptionPlans(),
    enabled: step === 'plan',
    staleTime: 5 * 60_000,
  });
  const planOptions = sortPlanOptions((plans.data?.plans ?? []).filter((p: any) => p.is_active !== false));

  const sendOtp = useMutation({
    mutationFn: () => authApi.sendPhoneOtp(form.phone),
    onSuccess: (result) => {
      const outcome = resolveSendCodeOutcome(result);
      setOtpAwaited(outcome.kind === 'await_otp');
      setStep('otp');
    },
    onError: () => setFormError('Could not send the verification code. Please try again.'),
  });

  const verifyOtp = useMutation({
    mutationFn: () => authApi.verifyPhoneOtp(form.phone, otp),
    onSuccess: (result) => {
      if (!result.success) {
        setOtpError('Incorrect code. Please try again.');
        return;
      }
      createOwner.mutate();
    },
    onError: () => setOtpError('Incorrect or expired code. Please try again.'),
  });

  const createOwner = useMutation({
    mutationFn: () => platformAdminService.createOwnerLead(form),
    onSuccess: (result) => {
      setLeadId(result.id);
      setStep('plan');
    },
    onError: (err) => setOtpError(describeAddOwnerError(getErrorCode(err))),
  });

  const savePlan = useMutation({
    mutationFn: (planCode: string) => platformAdminService.setOnboardingPlan(leadId as string, planCode),
    onSuccess: () => setStep('review'),
    onError: (err) => setPlanError(describeAddOwnerError(getErrorCode(err))),
  });

  const sendInvitation = useMutation({
    mutationFn: () => platformAdminService.approveLead(leadId as string),
    onSuccess: (result) => {
      setActivationLink(result.activationLink ?? null);
      setStep('sent');
      queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });
      fireToast('Onboarding link sent', 'ok');
    },
    onError: (err) => fireToast(describeAddOwnerError(getErrorCode(err)), 'no'),
  });

  function handleDetailsSubmit() {
    const result = validateDetailsForm(form);
    // `strict: false` in this project's tsconfig means discriminated-union
    // narrowing on `.valid` isn't picked up by the compiler (a pre-existing
    // repo-wide gap — see enquiryPhoneVerification.ts's FieldValidation
    // consumer in EnquiryPage.tsx, which hits the same thing); asserting the
    // narrowed shape here keeps this file's own typecheck clean.
    if (!result.valid) {
      setFormError((result as { valid: false; error: string }).error);
      return;
    }
    setFormError(null);
    sendOtp.mutate();
  }

  function handleOtpSubmit() {
    const result = validateOtpInput(otp);
    if (!result.valid) {
      setOtpError((result as { valid: false; error: string }).error);
      return;
    }
    setOtpError(null);
    verifyOtp.mutate();
  }

  function handlePlanSubmit() {
    if (!selectedPlan) {
      setPlanError('Choose a plan to continue.');
      return;
    }
    setPlanError(null);
    savePlan.mutate(selectedPlan);
  }

  const title = step === 'sent' ? 'Onboarding link sent' : 'Add owner';

  return (
    <AdminDrawer title={title} initials="+" tint="#B46A55" onClose={onClose}>
      {step === 'details' && (
        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass}>Name</label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Owner's full name"
            />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input
              className={inputClass}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="owner@example.com"
            />
          </div>
          <div>
            <label className={labelClass}>Phone number</label>
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="98765 43210"
            />
          </div>
          {formError && <p className={errorTextClass}>{formError}</p>}
          <button
            type="button"
            className={primaryButtonClass}
            disabled={sendOtp.isPending}
            onClick={handleDetailsSubmit}
          >
            {sendOtp.isPending ? 'Sending code…' : 'Verify phone'}
          </button>
        </div>
      )}

      {step === 'otp' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-[#EFE6DA] bg-white px-[18px] py-4">
            <p className="text-[12.5px] text-[#8A7F75]">
              {otpAwaited ? 'OTP sent to' : 'Could not reach this number over WhatsApp — continuing without a code'}
            </p>
            <p className="text-[13px] font-semibold text-[#2A2521]">{form.phone}</p>
          </div>
          {otpAwaited && (
            <div>
              <label className={labelClass}>Enter code</label>
              <input
                className={`${inputClass} tracking-[0.3em]`}
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="······"
              />
            </div>
          )}
          {otpError && <p className={errorTextClass}>{otpError}</p>}
          <button
            type="button"
            className={primaryButtonClass}
            disabled={verifyOtp.isPending || createOwner.isPending}
            onClick={otpAwaited ? handleOtpSubmit : () => createOwner.mutate()}
          >
            {verifyOtp.isPending || createOwner.isPending ? 'Verifying…' : otpAwaited ? 'Verify' : 'Continue'}
          </button>
          <button type="button" className={secondaryButtonClass} disabled={sendOtp.isPending} onClick={() => sendOtp.mutate()}>
            Resend code
          </button>
        </div>
      )}

      {step === 'plan' && (
        <div className="flex flex-col gap-4">
          {plans.isLoading ? (
            <p className="py-8 text-center text-[13px] text-[#8A7F75]">Loading plans…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {planOptions.map((plan: any) => (
                <button
                  key={plan.code}
                  type="button"
                  onClick={() => setSelectedPlan(plan.code)}
                  className={`flex items-center justify-between rounded-[10px] border px-4 py-3 text-left ${
                    selectedPlan === plan.code
                      ? 'border-[#221E1A] bg-[#F5EFE7]'
                      : 'border-[#E7DDD1] bg-white'
                  }`}
                >
                  <span className="text-[13px] font-semibold text-[#2A2521]">{plan.name}</span>
                  {plan.code === 'FOUNDING' && (
                    <span className="rounded-md bg-[#F5E9E3] px-2 py-[2px] text-[10.5px] font-bold text-[#B46A55]">
                      Admin-assigned
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {planError && <p className={errorTextClass}>{planError}</p>}
          <button type="button" className={primaryButtonClass} disabled={savePlan.isPending} onClick={handlePlanSubmit}>
            {savePlan.isPending ? 'Saving…' : 'Continue'}
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-[#EFE6DA] bg-white px-[18px] py-4">
            <p className="text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">Owner ready</p>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex justify-between text-[12.5px]">
                <span className="text-[#8A7F75]">Name</span>
                <span className="font-semibold text-[#2A2521]">{form.name}</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-[#8A7F75]">Email</span>
                <span className="font-semibold text-[#2A2521]">{form.email}</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-[#8A7F75]">Phone</span>
                <span className="font-semibold text-[#2A2521]">{form.phone}</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-[#8A7F75]">Plan</span>
                <span className="font-semibold text-[#2A2521]">{selectedPlan ?? '—'}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={sendInvitation.isPending}
            onClick={() => sendInvitation.mutate()}
          >
            {sendInvitation.isPending ? 'Sending…' : 'Send onboarding link'}
          </button>
        </div>
      )}

      {step === 'sent' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#CDE6D8] bg-[#EAF3EE] px-[18px] py-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1F7A52]">
              <Check className="h-5 w-5 text-white" strokeWidth={3} />
            </span>
            <p className="text-[13px] font-semibold text-[#1F7A52]">Onboarding link sent</p>
            <p className="text-[12px] text-[#5A5147]">Sent to {form.email}</p>
          </div>
          {activationLink && (
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => {
                navigator.clipboard?.writeText(activationLink).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied' : 'Copy link'}
              </span>
            </button>
          )}
          <button type="button" className={primaryButtonClass} onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </AdminDrawer>
  );
}
