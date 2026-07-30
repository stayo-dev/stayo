import type { ReactNode } from 'react';
import { cn } from '@shared/lib/cn';

interface DarkHeroCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * The "one dark ink card per screen for the thing that matters most" pattern
 * — Collect Rent, Today's Focus, Business Health, Config's completion ring.
 * Confirmed recurring across every product-app screen in the design source.
 * Deliberately just a themed container; content is fully composed by the caller.
 */
export function DarkHeroCard({ children, className }: DarkHeroCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-foreground p-4 text-background shadow-[0_12px_30px_rgba(34,30,26,0.24)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
