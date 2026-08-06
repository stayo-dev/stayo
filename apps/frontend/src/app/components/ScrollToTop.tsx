import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { scrollToTopSmooth } from '@/lib/scrollToTop';

/**
 * React Router doesn't reset scroll position on navigation (unlike a real
 * page load) — clicking a footer link (Contact, Privacy, etc.) while
 * scrolled to the bottom landed on the new page still scrolled to the
 * bottom. Skips when the URL carries a #hash, so intentional in-page
 * anchor links (e.g. /#footer) still scroll to that section instead.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    scrollToTopSmooth();
  }, [pathname, hash]);

  return null;
}
