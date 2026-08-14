import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Minimal full-viewport chrome shared by the Lead Submitted and Activation
 * Link screens — a logo-only sticky bar over the same cream marketing
 * background as Owner Onboarding.dc.html, centering a single content card.
 * Neither screen exists in the design source (see the phase-2 plan), so this
 * composes the established visual language rather than copying a screen.
 * The onboarding wizard itself has a richer top bar (save draft, progress)
 * and doesn't use this.
 */
export function JourneyShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-background/72 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-3.5 sm:px-6">
          <Link to="/owners" className="font-display text-xl font-extrabold tracking-tight text-primary">
            Stayo
          </Link>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[480px]">{children}</div>
      </div>
    </div>
  );
}
