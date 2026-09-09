import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { readClerkConfig } from '@lib/auth/clerkConfig';

/**
 * The shared frame for `/sign-in` and `/sign-up` (ADR-176, Phase 2).
 *
 * Wrapped in `<ThemeProvider theme="marketing">` for the same reason
 * `ForgotPasswordPage` is: without it these routes resolve `theme.css`'s
 * unscoped `:root` tokens — the legacy palette — and look like a different
 * product than the login popup they sit beside.
 *
 * The unconfigured branch is not a placeholder. Clerk is additive in this
 * phase, so `VITE_CLERK_PUBLISHABLE_KEY` being unset is a supported state, and
 * these routes are public: anyone can reach them by typing the URL. Rendering
 * Clerk's `<SignIn>` without a provider throws, so the guard has to live here.
 * It points people back at the login that actually works today rather than
 * leaving them on a dead screen.
 */
export function ClerkAuthScreen({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const config = readClerkConfig();

  return (
    <ThemeProvider theme="marketing">
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 py-12 bg-background text-foreground">
        {config.configured ? (
          children
        ) : (
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-2xl font-semibold">{title} is not available yet</h1>
            <p className="text-sm text-muted-foreground">
              Clerk sign-in has not been switched on for this environment. Your existing
              Stayo account still works as normal.
            </p>
            <Link
              to="/login"
              className="inline-block rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground"
            >
              Go to sign in
            </Link>
          </div>
        )}
      </div>
    </ThemeProvider>
  );
}
