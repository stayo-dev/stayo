import { NavLink, useLocation } from 'react-router-dom';
import { C, FONT, GRID_GROUND } from '@/app/pages/discover/discoverTheme';
import { useAppNav } from '@/app/nav/useAppNav';
import { useDiscoverAuthOptional } from '@/app/pages/discover/DiscoverAuthContext';
import { useNavAnchor } from '@/app/nav/NavAnchorContext';
import type { AppNavTab } from '@/app/nav/appNavConfig';

type AppNavIcon = AppNavTab['Icon'];

/** The four `/tenant/*` paths that are actual primary-nav tab pages. */
const TENANT_TAB_PATHS = new Set(['/tenant/home', '/tenant/money', '/tenant/room', '/tenant/food']);

/**
 * Routes that own the whole viewport — listing detail, search, the enquiry
 * flow, an enquiry's detail view, Profile's sub-pages (editor, stay history),
 * and every `/tenant/*` full-screen takeover that isn't one of the four tab
 * pages (Complaints, move-out, personal details, help, renewal) plus the
 * payment-return redirect page — and therefore hide the outer bar. They are
 * pushed *onto* a tab rather than being tabs themselves, so leaving the bar
 * visible would offer a lateral jump out of a half-finished form or a
 * transient redirect. Saved/Enquiries themselves are list pages reached
 * *from* the Profile tab and keep the bar. Carried over from the old
 * `DiscoverShell`'s `hidesTabBar`, updated for the `/profile/*` route tree
 * Saved/Enquiries/Profile moved into, and again when the Tenant Dashboard's
 * sub-pages joined this same shared shell (see `SeekerAppShell`) — the
 * `/tenant/*` clause is a blocklist-by-exception (anything not a tab path)
 * rather than an enumerated list, since these sub-pages already relied on
 * simply not being inside any `AppShell` at all before that change.
 */
function hidesOuterNav(pathname: string): boolean {
  return (
    /^\/discover\/(h|search)\b/.test(pathname) ||
    /^\/profile\/enquiries\/[^/]+$/.test(pathname) ||
    /^\/profile\/(details|history|documents)$/.test(pathname) ||
    pathname === '/payment-return' ||
    (pathname.startsWith('/tenant/') && !TENANT_TAB_PATHS.has(pathname))
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
 * **Tabs share the width on mobile; they do not scroll.** Items used to be a
 * fixed `w-[76px]` in a horizontally-scrollable row, which meant six tabs
 * needed roughly 470px against a 360-414px phone — so Explore, the last tab,
 * sat permanently off the right edge of every handset. Nothing indicated the
 * bar continued, so an entire primary destination was reachable only by
 * swiping a nav bar, a gesture almost no mobile app asks for. Items are now
 * `flex-1 basis-0` capped at `max-w-[76px]`: six tabs divide the width and fit
 * down to 320px, while two tabs still cap at 76px and `justify-center` centres
 * them exactly as before. Labels `truncate` rather than wrap. `overflow-x-auto`
 * stays as a harmless net for a viewport narrower than anything shipping.
 *
 * From `lg` up it stops being a full-bleed bar and becomes a **centred
 * floating dock** — and items there return to a fixed `w-[76px]`
 * (`lg:flex-none`), since a shrink-to-fit dock has no width to divide. A
 * laptop-width edge-to-edge bar carrying two items reads as unfinished
 * chrome, and the border-top drew a line across the whole screen for no
 * reason. Same markup, same tabs — `lg:w-fit lg:self-center`
 * shrinks it to its content (it is a flex child of `AppShell`'s column) and
 * the pill styling replaces the top border.
 */
export function AppBottomNav() {
  const { pathname } = useLocation();
  const { outerTabs } = useAppNav();
  const auth = useDiscoverAuthOptional();
  const navAnchor = useNavAnchor();
  if (hidesOuterNav(pathname)) return null;

  /** The visual body of a tab — identical whether it links or acts. */
  const tabInner = (Icon: AppNavIcon, label: string, isActive: boolean) => (
    <>
      <span
        className="flex h-[26px] w-11 items-center justify-center rounded-[13px] transition-colors"
        style={{ background: isActive ? 'rgba(180,106,85,.12)' : 'transparent' }}
      >
        <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} style={{ color: isActive ? C.clay : C.textMuted }} />
      </span>
      <span
        className="max-w-full truncate text-[10.5px]"
        style={{ color: isActive ? C.clay : C.textMuted, fontWeight: isActive ? 700 : 500 }}
      >
        {label}
      </span>
    </>
  );

  return (
    <nav
      ref={navAnchor ?? undefined}
      aria-label="Stayo"
      className="sticky bottom-0 z-40 flex-none overflow-x-auto border-t pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 [scrollbar-width:none] lg:mb-6 lg:w-fit lg:self-center lg:rounded-full lg:border lg:px-3 lg:pb-2.5 lg:backdrop-blur shadow-[0_-4px_16px_rgba(40,30,20,.03)] lg:shadow-[0_12px_32px_rgba(40,30,20,.14)] [&::-webkit-scrollbar]:hidden"
      style={{
        borderColor: C.line,
        background: C.cardWarm,
        fontFamily: FONT.body,
      }}
    >
      <div className="flex w-full justify-center gap-1 px-2 lg:w-auto lg:min-w-0">
        {outerTabs.map(({ to, label, Icon, end, action }) =>
          // "Log in" opens the sheet where it stands. Routing to /profile
          // first showed a page whose only content was another sign-in
          // button — two taps and a page load for one intent.
          action === 'SIGN_IN' && auth ? (
            <button
              key={to}
              type="button"
              onClick={() => auth.openSignIn()}
              className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 py-1 max-w-[76px] lg:w-[76px] lg:flex-none lg:basis-auto"
            >
              {tabInner(Icon, label, false)}
            </button>
          ) : (
            <NavLink key={to} to={to} end={end} className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 py-1 max-w-[76px] lg:w-[76px] lg:flex-none lg:basis-auto">
              {({ isActive }) => tabInner(Icon, label, isActive)}
            </NavLink>
          ),
        )}
      </div>
    </nav>
  );
}

export { GRID_GROUND as APP_SHELL_GRID_GROUND };
