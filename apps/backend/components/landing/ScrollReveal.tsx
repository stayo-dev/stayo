'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface ScrollRevealProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
}

const REVEAL_OPTIONS: IntersectionObserverInit = {
  rootMargin: '0px 0px -8% 0px',
  threshold: 0.12,
};

function shouldReduceMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ScrollReveal({ children, delay = 0, duration = 0.8, className }: ScrollRevealProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(true);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    if (shouldReduceMotion() || typeof IntersectionObserver === 'undefined') {
      setShouldAnimate(false);
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setIsVisible(true);
      observer.unobserve(entry.target);
    }, REVEAL_OPTIONS);

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const isHidden = shouldAnimate && !isVisible;
  const revealStyle: CSSProperties = {
    opacity: isHidden ? 0 : 1,
    transform: isHidden ? 'translate3d(0, 18px, 0)' : 'translate3d(0, 0, 0)',
    filter: isHidden ? 'blur(8px)' : 'blur(0px)',
    transitionDelay: isHidden ? '0s' : `${delay}s`,
    transitionDuration: `${duration}s`,
    transitionProperty: 'opacity, transform, filter',
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: isHidden ? 'opacity, transform, filter' : 'auto',
  };

  return (
    <div ref={elementRef} className={className} style={revealStyle}>
      {children}
    </div>
  );
}

interface StaggerRevealProps {
  children: ReactNode;
  staggerDelay?: number;
  className?: string;
}

export function StaggerReveal({ children, staggerDelay = 0.1, className }: StaggerRevealProps) {
  void staggerDelay;
  return <div className={className}>{children}</div>;
}

export function StaggerItem({ children }: { children: ReactNode }) {
  return <ScrollReveal delay={0.08}>{children}</ScrollReveal>;
}
