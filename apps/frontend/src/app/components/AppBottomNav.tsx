import { NavLink, useLocation } from 'react-router-dom';
import { C, FONT, GRID_GROUND } from '@/app/pages/discover/discoverTheme';
import { useAppNav } from '@/app/nav/useAppNav';

/**
 * Routes that own the whole viewport — listing detail, search, the enquiry
 * flow, an enquiry's detail view, and Profile's sub-pages (editor, stay
 * history) — and therefore hide the outer bar. They are pushed *onto* a tab
 * rather than being tabs themselves, so leaving the bar visible would offer
 * a lateral jump out of a half-finished form. Saved/Enquiries themselves are
 * list pages reached *from* the Profile tab and keep the bar. Carried over
 * from the old `DiscoverShell`'s `hidesTabBar`, updated for the `/profile/*`
 * route tree Saved/Enquiries/Profile moved into.
 */
function hidesOuterNav(pathname: string): boolean {
  return (
    /^\/discover\/(h|search)\b/.test(pathname) ||
    /^\/profile\/enquiries\/[^/]+$/.test(pathname) ||
    /^\/profile\/(details|history|documents)$/.test(pathname)
  );
}

/**
 * The one app-wide bottom nav — Explore/Profile, or Explore/Dashboard/Profile
 * once the signed-in user has a live tenancy (`useAppNav`). Mounted by
 * `AppShell`, shared between the Discover/Explore route tree and the Tenant
 * Dashboard route tree so there is exactly one outer nav implementation
 * instead of the two independent ones (`DiscoverShell`/`TenantAppShell`) this
 * replaced. Styled with Discover's hard-coded palette (`discoverTheme.ts`)
 * rather than themed CSS tokens, since Explore/Profile render outside any
 * `[data-app-theme]` shell.
 */
export function AppBottomNav() {
  const { pathname } = useLocation();
  const { outerTabs } = useAppNav();
  if (hidesOuterNav(pathname)) return null;

  return (
    <nav
      aria-label="Stayo"
      className="sticky bottom-0 z-40 grid flex-none border-t px-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5"
      style={{
        gridTemplateColumns: `repeat(${outerTabs.length}, minmax(0, 1fr))`,
        borderColor: C.line,
        background: C.cardWarm,
        boxShadow: '0 -4px 16px rgba(40,30,20,.03)',
        fontFamily: FONT.body,
      }}
    >
      {outerTabs.map(({ to, label, Icon, end }) => (
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
                style={{ color: isActive ? C.clay : C.textMuted, fontWeight: isActive ? 700 : 500 }}
              >
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export { GRID_GROUND as APP_SHELL_GRID_GROUND };
