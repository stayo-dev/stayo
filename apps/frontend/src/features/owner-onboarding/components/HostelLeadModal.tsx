import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@shared/lib/cn';
import { hostelLeadsApi } from '@features/hostel-leads/api';
import { supabase } from '@lib/supabaseClient';
import {
  LEAD_QUESTIONS,
  EMPTY_ANSWERS,
  validateAnswer,
  isLastQuestion,
  conversationProgress,
  buildLeadPayload,
  type LeadAnswers,
} from '../leadConversation';

interface HostelLeadModalProps {
  open: boolean;
  onClose: () => void;
  prefillName?: string;
  googleEmail?: string;
}

const inputStyle =
  'w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors focus:border-primary focus:outline-none';

/** Survives the Google OAuth full-page redirect. */
export const PENDING_LEAD_TOKEN_KEY = 'stayo.pendingLeadToken';

type Stage = 'questions' | 'otp' | 'done' | 'duplicate';

/**
 * Lead capture — three questions, then Google last and optional.
 *
 * The ordering is the point. We ask the easy question first, take the phone
 * number last, and **save the lead at the phone step** — so someone who
 * abandons at the optional Google step is still a lead an admin can call.
 * Google only ever enriches a row that already exists (`linkLeadEmail`); it
 * never gates creation, which is what it used to do.
 *
 * All step/validation logic lives in the pure, tested `leadConversation`
 * module; this component is the renderer.
 */
export function HostelLeadModal({ open, onClose, prefillName, googleEmail }: HostelLeadModalProps) {
  const [stage, setStage] = useState<Stage>('questions');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<LeadAnswers>(EMPTY_ANSWERS);
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [trackingToken, setTrackingToken] = useState('');
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage('questions');
    setIndex(0);
    setAnswers({ ...EMPTY_ANSWERS, name: prefillName ?? '' });
    setOtp(Array(6).fill(''));
    setError('');
    setTouched(false);
    setTrackingToken('');
    setLinkingGoogle(false);
  }, [open, prefillName]);

  // Focus the field on every question change, so the whole flow is keyboard-only.
  useEffect(() => {
    if (stage === 'questions') inputRef.current?.focus();
  }, [stage, index]);

  const question = LEAD_QUESTIONS[index];
  const validationError = validateAnswer(index, answers);

  const saveLead = async () => {
    const result = await hostelLeadsApi.submitLead(buildLeadPayload(answers, googleEmail));
    setTrackingToken(result.tracking_token);
    setStage(result.duplicate ? 'duplicate' : 'done');
  };

  const goNext = async () => {
    if (validationError) {
      setTouched(true);
      return;
    }
    setError('');

    if (!isLastQuestion(index)) {
      setIndex((i) => i + 1);
      setTouched(false);
      return;
    }

    // Last question is the phone number: send the code, then save.
    setBusy(true);
    try {
      const result = await hostelLeadsApi.sendLeadOtp(answers.phone.trim());

      // WhatsApp could not deliver a code (not configured, or the provider is
      // failing). The backend has already recorded the number as unverified —
      // save the lead rather than stranding it behind a code that will never
      // arrive.
      if (result.verification_required === false) {
        await saveLead();
        return;
      }

      setOtp(Array(6).fill(''));
      setStage('otp');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setError('');
    setTouched(false);
    if (stage === 'otp') {
      setStage('questions');
      return;
    }
    if (index > 0) setIndex((i) => i - 1);
  };

  const setOtpDigit = (i: number, value: string) => {
    const digit = value.replace(/[^0-9]/g, '').slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });
    if (digit && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const otpComplete = otp.every((d) => d !== '');

  const verifyOtp = async () => {
    if (!otpComplete) return;
    setBusy(true);
    setError('');
    try {
      await hostelLeadsApi.verifyLeadOtp(answers.phone.trim(), otp.join(''));
      await saveLead();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'That code did not work. Check it and try again.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Optional enrichment. The lead is already saved, so this is allowed to fail
   * or be abandoned without costing us anything — hence the token is parked in
   * sessionStorage for the callback page to pick up after the redirect.
   */
  const connectGoogle = async () => {
    setLinkingGoogle(true);
    setError('');
    try {
      if (trackingToken) window.sessionStorage.setItem(PENDING_LEAD_TOKEN_KEY, trackingToken);
    } catch {
      // Storage blocked — the OAuth round-trip simply won't link the email.
    }
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/lead-signup/callback` },
    });
    if (oauthError) {
      setLinkingGoogle(false);
      setError('Could not open Google sign-in. Your enquiry is saved either way.');
    }
  };

  const progress = conversationProgress(stage === 'questions' ? index : LEAD_QUESTIONS.length);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[500] bg-[rgba(47,40,35,0.5)] backdrop-blur-[3px]" />
        <Dialog.Content
          className={cn(
            'fixed z-[500] flex flex-col bg-card p-7 shadow-[0_40px_90px_-30px_rgba(47,47,47,0.5)]',
            'inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))]',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px]',
          )}
        >
          <Dialog.Close
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[10px] border border-border bg-card"
          >
            <X className="h-4 w-4 text-foreground" />
          </Dialog.Close>

          {stage !== 'done' && stage !== 'duplicate' && (
            <div className="mb-5 mt-1 flex items-center gap-3 pr-10">
              {(index > 0 || stage === 'otp') && (
                <button
                  type="button"
                  onClick={goBack}
                  aria-label="Back"
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {stage === 'questions' && (
            <>
              <Dialog.Title className="mb-1 font-display text-[21px] font-extrabold leading-tight text-foreground">
                {question.prompt}
              </Dialog.Title>
              <Dialog.Description className="mb-5 text-sm leading-normal text-muted-foreground">
                {question.hint ?? `Question ${index + 1} of ${LEAD_QUESTIONS.length} — that's all we'll ask.`}
              </Dialog.Description>

              <input
                ref={inputRef}
                value={answers[question.key]}
                onChange={(e) => {
                  setAnswers((prev) => ({ ...prev, [question.key]: e.target.value }));
                  setTouched(false);
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && goNext()}
                placeholder={question.placeholder}
                inputMode={question.kind === 'phone' ? 'tel' : 'text'}
                className={inputStyle}
              />

              {touched && validationError && (
                <div className="mt-3 rounded-[9px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">
                  {validationError}
                </div>
              )}
              {error && (
                <div className="mt-3 rounded-[9px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={goNext}
                disabled={busy}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)] disabled:opacity-60"
              >
                {busy ? 'Just a moment…' : isLastQuestion(index) ? 'Send me a code' : 'Continue'}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
            </>
          )}

          {stage === 'otp' && (
            <>
              <Dialog.Title className="mb-1 font-display text-[21px] font-extrabold text-foreground">
                Enter the code
              </Dialog.Title>
              <Dialog.Description className="mb-5 text-sm leading-normal text-muted-foreground">
                We sent a 6-digit code to {answers.phone.trim()} on WhatsApp.
              </Dialog.Description>
              <div className="flex justify-between gap-2">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    value={digit}
                    onChange={(e) => setOtpDigit(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
                      if (e.key === 'Enter') verifyOtp();
                    }}
                    inputMode="numeric"
                    maxLength={1}
                    aria-label={`Digit ${i + 1}`}
                    className="h-12 w-full rounded-[11px] border-[1.5px] border-border bg-muted text-center text-lg font-bold text-foreground focus:border-primary focus:outline-none"
                  />
                ))}
              </div>
              {error && (
                <div className="mt-3 rounded-[9px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={verifyOtp}
                disabled={!otpComplete || busy}
                className="mt-5 rounded-xl bg-primary py-3 font-display text-[15px] font-bold text-primary-foreground disabled:opacity-60"
              >
                {busy ? 'Checking…' : 'Confirm'}
              </button>
            </>
          )}

          {stage === 'done' && (
            <div className="py-2 text-center">
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                <Check className="h-6 w-6 text-success" strokeWidth={2.8} />
              </div>
              <Dialog.Title className="mb-2 font-display text-xl font-extrabold text-foreground">
                You&apos;re on the list
              </Dialog.Title>
              <Dialog.Description className="mb-6 text-sm leading-relaxed text-muted-foreground">
                Our team will reach out on WhatsApp shortly. Add your email too and we&apos;ll keep you posted there
                as well — entirely optional.
              </Dialog.Description>

              {error && (
                <div className="mb-4 rounded-[9px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2.5">
                {!googleEmail && (
                  <button
                    type="button"
                    onClick={connectGoogle}
                    disabled={linkingGoogle}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border-[1.5px] border-border bg-card px-5 py-3 font-display text-[15px] font-bold text-foreground transition-colors hover:border-primary disabled:opacity-60"
                  >
                    {linkingGoogle ? 'Opening Google…' : 'Add my email with Google'}
                  </button>
                )}
                {trackingToken && (
                  <a href={`/enquiry/${trackingToken}`} className="text-[13px] font-bold text-primary underline">
                    Track your enquiry
                  </a>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-5 py-2.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  {googleEmail ? 'Done' : "No thanks, I'm done"}
                </button>
              </div>
            </div>
          )}

          {stage === 'duplicate' && (
            <div className="py-2 text-center">
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Check className="h-6 w-6 text-muted-foreground" strokeWidth={2.8} />
              </div>
              <Dialog.Title className="mb-2 font-display text-xl font-extrabold text-foreground">
                You&apos;ve already applied
              </Dialog.Title>
              <Dialog.Description className="mb-6 text-sm leading-relaxed text-muted-foreground">
                You&apos;ve already submitted your application. Please don&apos;t apply again. We&apos;ll contact you
                shortly.
              </Dialog.Description>

              <div className="flex flex-col gap-2.5">
                {trackingToken && (
                  <a
                    href={`/enquiry/${trackingToken}`}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)]"
                  >
                    View my application status
                  </a>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-5 py-2.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
