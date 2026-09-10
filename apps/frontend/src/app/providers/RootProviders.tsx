import type { PropsWithChildren } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ScrollToTop } from '@/app/components/ScrollToTop';

export function RootProviders({ children }: PropsWithChildren) {
  return (
    <BrowserRouter>
      <ScrollToTop />
      {/* Clerk is deliberately NOT mounted here. It is mounted per-route —
          in ClerkAuthScreen (/sign-in, /sign-up) and ProtectedAppProviders
          (every authenticated tree) — so the public marketing page at `/`
          never loads the SDK. See ADR-176 Phase 2.6. */}
      {children}
    </BrowserRouter>
  );
}
