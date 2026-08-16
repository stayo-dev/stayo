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
 * The one app-wide bottom nav — Explore/Profile, or, once the signed-in
 * user has a live tenancy, the single-level six-item active-tenant nav
 * (Home/Payments/Food/Room/Profile/Explore — no separate Dashboard item,
 * no second nav layer, see `ACTIVE_TENANT_TABS`). Mounted by `AppShell`,
 * shared between the Discover/Explore route tree and the Tenant Dashboard
 * route tree so there is exactly one outer nav implementation instead of
 * the two independent ones (`DiscoverShell`/`TenantAppShell`) this replaced.
 * Styled with Discover's hard-coded palette (`discoverTheme.ts`) rather than
 * themed CSS tokens, since Explore/Profile render outside any
 * `[data-app-theme]` shell.
 *
 * Fixed-width items in a horizontally-scrollable row, not an equal-width
 * grid: six comfortable tabs don't squeeze onto a narrow phone width, so on
 * mobile the row scrolls instead. The inner row is `w-max` with `min-w-full`
 * — when all tabs fit the viewport (2 tabs always; 6 tabs on a wide-enough
 * desktop width) `min-w-full` wins and `justify-center` centers them with no
 * scrolling; when they don't fit, `w-max` wins, the row's own width becomes
 * exactly its content's width (no slack for `justify-center` to redistribute
 * into), and the browser scrolls the overflow — avoiding the classic
 * flex-center-plus-overflow bug where the start of the row gets clipped.
 */
export function AppBottomNav() {
  const { pathname } = useLocation();
  const { outerTabs } = useAppNav();
  if (hidesOuterNav(pathname)) return null;

  return (
    <nav
      aria-label="Stayo"
      className="sticky bottom-0 z-40 flex-none overflow-x-auto border-t pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        borderColor: C.line,
        background: C.cardWarm,
        boxShadow: '0 -4px 16px rgba(40,30,20,.03)',
        fontFamily: FONT.body,
      }}
    >
      <div className="flex w-max min-w-full justify-center gap-1 px-2">
        {outerTabs.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="flex w-[76px] flex-none flex-col items-center gap-1.5 py-1">
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
      </div>
    </nav>
  );
}

export { GRID_GROUND as APP_SHELL_GRID_GROUND };
