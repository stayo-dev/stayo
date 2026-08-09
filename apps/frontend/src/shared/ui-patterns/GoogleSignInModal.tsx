import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@shared/lib/cn';
import { supabase } from '@lib/supabaseClient';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { StayoLoader } from '@shared/ui/brand';

interface GoogleSignInModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Real "Continue with Google" step for the owner entry point (Manage My
 * Hostel / Book a demo). Uses Supabase Auth (ADR-031)'s
 * `signInWithOAuth` — a full-page redirect, not a popup, so there is no
 * in-page `onSuccess` callback: the browser navigates to Google and back
 * to `/lead-signup/callback`, which reads the resulting identity and
 * continues the lead-capture flow. This is a different product flow from
 * the real `/login` Google sign-in (lead capture, not authentication) —
 * see LeadSignupCallbackPage for why it deliberately never calls
 * /api/auth/me or resolves a StayO session.
 */
export function GoogleSignInModal({ open, onClose }: GoogleSignInModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/lead-signup/callback` },
      });
      if (error) throw error;
      // Browser navigates away on success; nothing further runs here.
    } catch (err) {
      setSubmitting(false);
      stayoToast.error('Could not start Google sign-in. Please try again.');
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
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[400px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px]',
          )}
        >
          <Dialog.Close
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[10px] border border-border bg-card"
          >
            <X className="h-4 w-4 text-foreground" />
          </Dialog.Close>

          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="font-display text-lg font-extrabold tracking-tight text-primary">Stayo</span>
          </div>
          <Dialog.Title className="mb-1 mt-3.5 font-display text-[22px] font-extrabold text-foreground">
            Continue as a hostel owner
          </Dialog.Title>
          <Dialog.Description className="mb-7 text-sm leading-normal text-muted-foreground">
            Sign in with Google to get started — takes a few seconds.
          </Dialog.Description>

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 font-display text-[15px] font-bold text-foreground shadow-[0_1px_2px_rgba(40,30,20,0.06)] transition-colors hover:bg-muted disabled:opacity-70"
          >
            {submitting ? (
              <StayoLoader size="sm" label={null} />
            ) : (
              <GoogleMark />
            )}
            {submitting ? 'Signing in…' : 'Continue with Google'}
          </button>

          <p className="mt-5 text-center text-[12.5px] leading-normal text-muted-foreground">
            By continuing you agree to Stayo&apos;s Terms and Privacy Policy.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.95 10.7a5.4 5.4 0 0 1 0-3.4V4.97H.95a9 9 0 0 0 0 8.06l3-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}
