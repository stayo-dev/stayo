import { useEffect, useState, type ReactNode } from 'react';

interface IdleRenderProps {
  children: ReactNode;
  fallback?: ReactNode;
  timeout?: number;
}

export function IdleRender({ children, fallback = null, timeout = 800 }: IdleRenderProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => setReady(true), { timeout });
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(() => setReady(true), Math.min(timeout, 250));
    return () => window.clearTimeout(id);
  }, [ready, timeout]);

  return ready ? <>{children}</> : <>{fallback}</>;
}
