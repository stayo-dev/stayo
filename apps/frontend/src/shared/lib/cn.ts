import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Canonical `cn` helper for shared/ code. Deliberately a separate copy from
 * app/components/ui/utils.ts's `cn` (identical implementation) rather than
 * importing that one — shared/ is architecturally forbidden from depending
 * on app/ (enforced by scripts/check-architecture.mjs), and this is exactly
 * the "shared framework-agnostic libraries" use case shared/lib/ was
 * reserved for.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
