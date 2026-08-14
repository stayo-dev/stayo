import { useState, useCallback } from 'react';

/**
 * Client-side push/pop navigation for the Room + Profile drill-in system —
 * matches Stayo Tenant.dc.html's own `roomView`/`roomStack` state machine
 * (a local view stack, not URL routes) rather than adding ~20 new routes.
 * `'home'` is the tab's own landing content; any other string is a
 * DetailScreen/FormPanel destination key.
 */
export function useOverlayStack() {
  const [view, setView] = useState('home');
  const [stack, setStack] = useState<string[]>([]);

  const push = useCallback((next: string) => {
    setStack((s) => [...s, view]);
    setView(next);
  }, [view]);

  const back = useCallback(() => {
    setStack((s) => {
      if (s.length === 0) {
        setView('home');
        return s;
      }
      const copy = [...s];
      const prev = copy.pop()!;
      setView(prev);
      return copy;
    });
  }, []);

  const close = useCallback(() => {
    setStack([]);
    setView('home');
  }, []);

  return { view, isHome: view === 'home', push, back, close };
}
