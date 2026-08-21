import type { ReactNode } from 'react';
import { Heart } from 'lucide-react';

import { C, FONT } from '../discoverTheme';

/**
 * `DiscoverShell` (the nav-owning wrapper) was retired when the app-wide
 * `AppShell`/`AppBottomNav` (see `app/layouts/AppShell.tsx`) took over its
 * job — Explore/Saved/Enquiries/Profile collapsed into the shared
 * Explore/Dashboard/Profile outer nav, so a Discover-only shell no longer
 * makes sense. These presentational helpers stay: they're used throughout
 * `app/pages/discover/*` independent of which shell renders around them.
 */

/** Consistent empty state across Saved, Enquiries and a fruitless search. */
export function DiscoverEmpty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Heart;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-8 pt-16 text-center">
      <span
        className="mb-[18px] flex h-[72px] w-[72px] items-center justify-center rounded-full"
        style={{ background: '#F4EEE7' }}
      >
        <Icon className="h-8 w-8" strokeWidth={1.6} style={{ color: '#C9A98F' }} />
      </span>
      <h2 className="text-[18px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
        {title}
      </h2>
      <p className="mt-2 max-w-[16rem] text-[12.5px] leading-[1.6]" style={{ color: C.textMuted }}>
        {body}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/**
 * Card-shaped skeletons, so the page does not jump when results land.
 *
 * `className` overrides the wrapper layout: Explore lays its results out as a
 * responsive grid, and a skeleton that stacks in one column while the real
 * results arrive in four is the jump this component exists to prevent.
 */
export function HostelCardSkeleton({
  count = 3,
  className = 'flex flex-col gap-4',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex aspect-square flex-col overflow-hidden rounded-[20px] border bg-white"
          style={{ borderColor: C.line }}
        >
          {/* Square, and split exactly where the real card splits — photo takes
              what the text block leaves — so nothing shifts vertically or
              horizontally when the results land. */}
          <div className="min-h-0 flex-1 animate-pulse" style={{ background: '#EDE4DA' }} />
          <div className="flex-none px-4 pb-4 pt-3.5">
            <div className="h-4 w-2/3 animate-pulse rounded" style={{ background: '#EDE4DA' }} />
            <div className="mt-2 h-3 w-5/6 animate-pulse rounded" style={{ background: '#F2ECE5' }} />
            <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: '#F4EEE7' }}>
              <div className="h-5 w-24 animate-pulse rounded" style={{ background: '#EDE4DA' }} />
              <div className="h-3 w-20 animate-pulse rounded" style={{ background: '#F2ECE5' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The one primary button shape used across Discover. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  full?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[13px] px-6 py-3.5 text-[14px] font-bold text-white transition-opacity active:opacity-90 disabled:cursor-not-allowed ${full ? 'w-full' : ''}`}
      style={{
        fontFamily: FONT.display,
        background: disabled ? '#C9B8AC' : C.clayDeep,
        boxShadow: disabled ? 'none' : '0 6px 16px rgba(164,93,68,.28)',
      }}
    >
      {children}
    </button>
  );
}
