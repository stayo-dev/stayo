import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ClipboardList, Compass, Heart, User } from 'lucide-react';

import { C, FONT, GRID_GROUND } from '../discoverTheme';

const TABS = [
  { to: '/discover', label: 'Explore', Icon: Compass, end: true },
  { to: '/discover/saved', label: 'Saved', Icon: Heart, end: false },
  { to: '/discover/enquiries', label: 'Enquiries', Icon: ClipboardList, end: false },
  { to: '/discover/profile', label: 'Profile', Icon: User, end: false },
] as const;

/**
 * Routes that own the whole viewport — listing detail, the enquiry flow — and
 * therefore hide the tab bar. They are pushed *onto* a tab rather than being
 * tabs themselves, so leaving the bar visible would offer a lateral jump out
 * of a half-finished form.
 */
function hidesTabBar(pathname: string): boolean {
  return (
    /^\/discover\/(h|search)\b/.test(pathname) ||
    /^\/discover\/enquiries\/[^/]+$/.test(pathname) ||
    /^\/discover\/profile\/[^/]+$/.test(pathname)
  );
}

export function DiscoverShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const showTabs = !hidesTabBar(pathname);

  return (
    <div
      className="flex min-h-[100dvh] flex-col antialiased"
      // The graph-paper ground every Stayo surface stands on — the same
      // `#EBDCCF` 1px / 52px grid as `OwnerAppShell`, `TenantAppShell` and
      // `HostelDrilldownLayout`. `GRID_GROUND` had been defined in
      // `discoverTheme.ts` since Discover was built but never actually applied,
      // so this was the one product surface rendering on flat cream.
      style={{ ...GRID_GROUND, fontFamily: FONT.body }}
    >
      <div className="flex-1 pb-[env(safe-area-inset-bottom)]">{children}</div>

      {showTabs && (
        <nav
          aria-label="Discover"
          className="sticky bottom-0 z-40 grid flex-none grid-cols-4 border-t px-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5"
          style={{
            borderColor: C.line,
            background: C.cardWarm,
            boxShadow: '0 -4px 16px rgba(40,30,20,.03)',
          }}
        >
          {TABS.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="flex flex-col items-center gap-1.5 py-1">
              {({ isActive }) => (
                <>
                  <span
                    className="flex h-[26px] w-11 items-center justify-center rounded-[13px] transition-colors"
                    style={{ background: isActive ? 'rgba(180,106,85,.12)' : 'transparent' }}
                  >
                    <Icon
                      className="h-[19px] w-[19px]"
                      strokeWidth={1.8}
                      style={{ color: isActive ? C.clay : C.textMuted }}
                    />
                  </span>
                  <span
                    className="text-[10.5px]"
                    style={{
                      color: isActive ? C.clay : C.textMuted,
                      fontWeight: isActive ? 700 : 500,
                    }}
                  >
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

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

/** Card-shaped skeletons, so the page does not jump when results land. */
export function HostelCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-[20px] border bg-white"
          style={{ borderColor: C.line }}
        >
          <div className="h-[186px] animate-pulse" style={{ background: '#EDE4DA' }} />
          <div className="space-y-2.5 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded" style={{ background: '#EDE4DA' }} />
            <div className="h-3 w-1/2 animate-pulse rounded" style={{ background: '#F2ECE5' }} />
            <div className="h-5 w-1/3 animate-pulse rounded" style={{ background: '#F2ECE5' }} />
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
