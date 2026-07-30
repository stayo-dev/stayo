import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@shared/lib/cn';

export type LoginModalMode = 'owner' | 'tenant';

interface LoginModalForm {
  name: string;
  email: string;
  password: string;
}

interface LoginModalProps {
  open: boolean;
  mode: LoginModalMode;
  onClose: () => void;
  onSuccess: (data: { mode: LoginModalMode; name: string; email: string }) => void;
}

const EMPTY_FORM: LoginModalForm = { name: '', email: '', password: '' };

/**
 * Login/signup modal, per AuthModal.dc.html. Owner mode is login-only (no
 * signup tab — the design's own copy is "Owner accounts are created during
 * onboarding"); tenant mode has a login/signup pill toggle. Mock auth only:
 * a fake 650ms delay stands in for the network call, matching the source
 * exactly. Built directly on `@radix-ui/react-dialog` rather than
 * `app/components/ui/dialog.tsx` — same reasoning as BottomSheet using
 * `vaul` directly: `shared/` can't import `app/` (scripts/check-architecture.mjs).
 */
export function LoginModal({ open, mode, onClose, onSuccess }: LoginModalProps) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState<LoginModalForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isOwner = mode === 'owner';
  const isLogin = isOwner || tab === 'login';
  const showName = !isOwner && !isLogin;

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const submit = () => {
    if (!form.email.trim() || !form.password.trim() || (showName && !form.name.trim())) {
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      const name = form.name || form.email.split('@')[0];
      const email = form.email;
      setForm(EMPTY_FORM);
      setTab('login');
      onSuccess({ mode, name, email });
    }, 650);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[500] bg-[rgba(47,40,35,0.5)] backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-200" />
        <Dialog.Content
          className={cn(
            'fixed z-[500] flex flex-col bg-card p-6 pb-6 shadow-[0_40px_90px_-30px_rgba(47,47,47,0.5)]',
            'inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]',
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

          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="font-display text-lg font-extrabold tracking-tight text-primary">Stayo</span>
          </div>

          {isOwner ? (
            <>
              <Dialog.Title className="mb-1 mt-3.5 font-display text-[22px] font-extrabold text-foreground">
                Owner Login
              </Dialog.Title>
              <Dialog.Description className="mb-5 text-sm leading-normal text-muted-foreground">
                Log in with your existing Stayo owner credentials.
              </Dialog.Description>
            </>
          ) : (
            <>
              <Dialog.Title className="mb-1 mt-3.5 font-display text-[22px] font-extrabold text-foreground">
                {isLogin ? 'Welcome back' : 'Create your account'}
              </Dialog.Title>
              <Dialog.Description className="mb-4.5 text-sm leading-normal text-muted-foreground">
                {isLogin ? 'Log in to continue.' : 'Sign up to book, save and message owners.'}
              </Dialog.Description>

              <div className="relative mb-5 flex gap-0 rounded-[13px] border border-border bg-muted p-1.5">
                <div
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-1.5 z-0 w-[calc(50%-6px)] rounded-[9px] bg-primary shadow-[0_6px_16px_-8px_rgba(164,93,68,0.55)] transition-transform duration-300 ease-out',
                    isLogin ? 'translate-x-0' : 'translate-x-full',
                  )}
                />
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setError('');
                  }}
                  className={cn(
                    'relative z-10 flex-1 rounded-[9px] px-2.5 py-2 font-display text-[13.5px] font-bold transition-colors',
                    isLogin ? 'text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('signup');
                    setError('');
                  }}
                  className={cn(
                    'relative z-10 flex-1 rounded-[9px] px-2.5 py-2 font-display text-[13.5px] font-bold transition-colors',
                    !isLogin ? 'text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  Sign Up
                </button>
              </div>
            </>
          )}

          <div className="flex flex-col gap-3.5">
            {showName && (
              <label className="block">
                <span className="mb-1.5 block font-display text-[10.5px] font-bold tracking-wider text-primary">
                  FULL NAME
                </span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Your name"
                  className="w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors focus:border-primary focus:outline-none"
                />
              </label>
            )}
            <label className="block">
              <span className="mb-1.5 block font-display text-[10.5px] font-bold tracking-wider text-primary">
                EMAIL
              </span>
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="you@example.com"
                inputMode="email"
                className="w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors focus:border-primary focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-display text-[10.5px] font-bold tracking-wider text-primary">
                PASSWORD
              </span>
              <input
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                type="password"
                placeholder="••••••••"
                className="w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors focus:border-primary focus:outline-none"
              />
            </label>

            {error && (
              <div className="rounded-[9px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-1 flex w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-4 py-3.5 font-display text-[15px] font-bold text-primary-foreground shadow-[0_14px_28px_-14px_rgba(164,93,68,0.6)] disabled:opacity-75"
            >
              {submitting && (
                <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {submitting ? 'Please wait…' : isOwner ? 'Log In' : isLogin ? 'Log In' : 'Create Account'}
            </button>
          </div>

          {isOwner && (
            <p className="mt-4 text-center text-[12.5px] leading-normal text-muted-foreground">
              Owner accounts are created during onboarding — contact Stayo support if you need help accessing yours.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
