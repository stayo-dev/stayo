import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Check, ArrowRight } from 'lucide-react';
import { cn } from '@shared/lib/cn';
import { hostelLeadsApi } from '@features/hostel-leads/api';

interface HostelLeadModalProps {
  open: boolean;
  onClose: () => void;
  prefillName?: string;
  googleEmail?: string;
}

const inputStyle =
  'w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors focus:border-primary focus:outline-none';
const labelStyle = 'mb-1.5 block font-display text-[10.5px] font-bold tracking-wider text-primary';

type Step = 'details' | 'otp' | 'done';

/**
 * Real lead-capture popup — Hostel Details → Phone OTP → "we'll be in
 * touch" confirmation — rendered on LeadSignupCallbackPage after a real
 * Google sign-in (ADR-031's Supabase Auth, `signInWithOAuth`). Ends with a
 * human-follow-up promise ("StayO will reach out"), not instant self-serve
 * activation: submitting a verified lead here creates a `platform_leads`
 * row (`POST /leads/self-serve`) for an admin to review and accept — it
 * never creates a real StayO account. The already-built Onboarding
 * wizard/Dashboard preview are reached separately, via an activation link
 * sent after admin approval, not auto-chained from here.
 */
export function HostelLeadModal({ open, onClose, prefillName, googleEmail }: HostelLeadModalProps) {
  const [step, setStep] = useState<Step>('details');
  const [hostelName, setHostelName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''));
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [trackingToken, setTrackingToken] = useState('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (open) {
      setStep('details');
      setOwnerName(prefillName ?? '');
      setHostelName('');
      setPhone('');
      setOtp(Array(6).fill(''));
      setError('');
      setTrackingToken('');
    }
  }, [open, prefillName]);

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const submitLead = async () => {
    const result = await hostelLeadsApi.submitLead({
      name: ownerName.trim(),
      hostel_name: hostelName.trim(),
      phone: phone.trim(),
      google_email: googleEmail,
    });
    setTrackingToken(result.tracking_token);
    return result;
  };

  const submitDetails = async () => {
    if (!hostelName.trim() || !ownerName.trim() || !phone.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    setSendingOtp(true);
    try {
      const result = await hostelLeadsApi.sendLeadOtp(phone.trim());

      // WhatsApp could not deliver a code (not configured yet, or the
      // provider is failing). The backend has already recorded the number as
      // unverified — go straight to the confirmation rather than showing an
      // OTP screen for a code that will never arrive.
      if (result.verification_required === false) {
        await submitLead();
        setStep('done');
        return;
      }

      setOtp(Array(6).fill(''));
      setStep('otp');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not submit your details. Please try again.');
    } finally {
      setSendingOtp(false);
    }
  };

  const setOtpDigit = (index: number, value: string) => {
    const digit = value.replace(/[^0-9]/g, '').slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const onOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  };

  const otpComplete = otp.every((d) => d !== '');

  const verifyOtp = async () => {
    if (!otpComplete) return;
    setVerifying(true);
    setError('');
    try {
      await hostelLeadsApi.verifyLeadOtp(phone.trim(), otp.join(''));
      await submitLead();
      setStep('done');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Verification failed. Check the code and try again.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[500] bg-[rgba(47,40,35,0.5)] backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-200" />
        <Dialog.Content
          className={cn(
            'fixed z-[500] flex flex-col bg-card p-7 shadow-[0_40px_90px_-30px_rgba(47,47,47,0.5)]',
            'inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))]',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-300',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px]',
          )}
        >
          <Dialog.Close
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[10px] border border-border bg-card"
          >
            <X className="h-4 w-4 text-foreground" />
          </Dialog.Close>

          {step === 'details' && (
            <>
              <Dialog.Title className="mb-1 mt-1 font-display text-[22px] font-extrabold text-foreground">
                Tell us about your hostel
              </Dialog.Title>
              <Dialog.Description className="mb-6 text-sm leading-normal text-muted-foreground">
                A few details so our team can reach out to you.
              </Dialog.Description>
              <div className="flex flex-col gap-4">
                <label className="block">
                  <span className={labelStyle}>HOSTEL OWNER NAME</span>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Your name" className={inputStyle} />
                </label>
                <label className="block">
                  <span className={labelStyle}>HOSTEL NAME</span>
                  <input
                    value={hostelName}
                    onChange={(e) => setHostelName(e.target.value)}
                    placeholder="e.g. Green Nest Hostel"
                    className={inputStyle}
                  />
                </label>
                <label className="block">
                  <span className={labelStyle}>HOSTEL OWNER&apos;S PHONE NUMBER</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 90000 00000"
                    inputMode="tel"
                    className={inputStyle}
                  />
                </label>
                {error && (
                  <div className="rounded-[9px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">{error}</div>
                )}
                <button
                  type="button"
                  onClick={submitDetails}
                  disabled={sendingOtp}
                  className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)] disabled:opacity-60"
                >
                  {sendingOtp ? (
                    <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 'otp' && (
            <>
              <Dialog.Title className="mb-1 mt-1 text-center font-display text-[22px] font-extrabold text-foreground">
                Enter verification code
              </Dialog.Title>
              <Dialog.Description className="mb-6 text-center text-sm leading-normal text-muted-foreground">
                Sent to {phone}
              </Dialog.Description>
              <div className="mb-5 flex justify-center gap-2.5">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    value={digit}
                    onChange={(e) => setOtpDigit(i, e.target.value)}
                    onKeyDown={(e) => onOtpKeyDown(i, e)}
                    inputMode="numeric"
                    maxLength={1}
                    className={cn(
                      'h-13 w-11 rounded-xl border-[1.5px] text-center font-display text-xl font-bold text-primary focus:outline-none',
                      digit ? 'border-primary bg-primary/5' : 'border-border bg-card',
                    )}
                  />
                ))}
              </div>
              <div className="mb-5 text-center text-[13px] font-medium text-muted-foreground">
                Didn&apos;t receive? <span className="font-bold text-primary">Resend in 28s</span>
              </div>
              {error && (
                <div className="mb-5 rounded-[9px] bg-destructive/10 px-3 py-2.5 text-center text-[12.5px] font-semibold text-destructive">
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={verifyOtp}
                disabled={!otpComplete || verifying}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)] disabled:opacity-60"
              >
                {verifying && <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {verifying ? 'Verifying…' : 'Verify & Continue'}
              </button>
            </>
          )}

          {step === 'done' && (
            <div className="py-2 text-center">
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                <Check className="h-6 w-6 text-success" strokeWidth={2.8} />
              </div>
              <h2 className="mb-2 font-display text-xl font-extrabold text-foreground">Thanks — we&apos;ve got your details</h2>
              <p className="mb-7 text-sm leading-relaxed text-muted-foreground">
                The Stayo team will get back to you soon on WhatsApp or a call to help you get set up.
              </p>
              {trackingToken && (
                <a
                  href={`/enquiry/${trackingToken}`}
                  className="mb-4 block text-sm font-bold text-primary underline"
                >
                  Track your enquiry
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-display text-sm font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)]"
              >
                Got it
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
