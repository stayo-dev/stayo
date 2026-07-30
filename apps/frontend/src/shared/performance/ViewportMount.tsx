import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ViewportMountProps {
  children: ReactNode;
  fallback?: ReactNode;
  rootMargin?: string;
}

export function ViewportMount({
  children,
  fallback = null,
  rootMargin = '160px 0px',
}: ViewportMountProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, visible]);

  return <div ref={ref}>{visible ? children : fallback}</div>;
}
