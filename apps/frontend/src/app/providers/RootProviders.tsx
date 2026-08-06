import type { PropsWithChildren } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ScrollToTop } from '@/app/components/ScrollToTop';

export function RootProviders({ children }: PropsWithChildren) {
  return (
    <BrowserRouter>
      <ScrollToTop />
      {children}
    </BrowserRouter>
  );
}
