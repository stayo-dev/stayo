import type { PropsWithChildren } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ScrollToTop } from '@/app/components/ScrollToTop';
import { ClerkAuthProvider } from '@/app/providers/ClerkAuthProvider';

export function RootProviders({ children }: PropsWithChildren) {
  return (
    <BrowserRouter>
      <ScrollToTop />
      {/* Inside the router: Clerk's <SignIn routing="path"> renders under a
          route, and a future navigation integration will need router context.
          No-ops entirely when VITE_CLERK_PUBLISHABLE_KEY is unset. */}
      <ClerkAuthProvider>{children}</ClerkAuthProvider>
    </BrowserRouter>
  );
}
