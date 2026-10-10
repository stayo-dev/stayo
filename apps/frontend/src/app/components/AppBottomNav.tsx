import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { C, FONT, GRID_GROUND } from '@/app/pages/discover/discoverTheme';
import { useAppNav } from '@/app/nav/useAppNav';
import { useDiscoverAuthOptional } from '@/app/pages/discover/DiscoverAuthContext';
import { useNavAnchor } from '@/app/nav/NavAnchorContext';
import type { AppNavTab } from '@/app/nav/appNavConfig';
import { bottomNavScrolls, hasHiddenTabsToTheRight, scrollLeftToReveal } from '@/app/nav/bottomNavLayout';

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
 * **On mobile, at most five tabs show; a sixth is a swipe away**
 * (`bottomNavLayout.ts`). With five or fewer, items are `flex-1 basis-0`
 * capped at `max-w-[76px]` and centred, as before. With six (the live-tenant
 * nav), each item is exactly a fifth of the bar and Explore sits past the
 * right edge. Six tabs squeezed into one row made every label cramped; an
 * earlier version hid a tab off-screen with no sign the bar continued, so this
 * one adds a right-edge fade while tabs remain hidden, scroll-snap so the bar
 * rests on whole tabs, and scrolls the active tab into view on navigation.
 * Labels `truncate` rather than wrap.
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [moreToTheRight, setMoreToTheRight] = useState(false);
  const scrolls = bottomNavScrolls(outerTabs.length);
  const hidden = hidesOuterNav(pathname);

  // Keep the active tab in view, and the fade in step with what is hidden.
  useEffect(() => {
    const nav = scrollRef.current;
    if (!nav || !scrolls || hidden) {
      setMoreToTheRight(false);
      return;
    }
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const target = scrollLeftToReveal(active, nav);
      if (target !== null) nav.scrollLeft = target;
    }
    const update = () => setMoreToTheRight(hasHiddenTabsToTheRight(nav));
    update();
    nav.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      nav.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pathname, scrolls, hidden]);

  if (hidden) return null;

  // Five-or-fewer: share the width, centred. Six: a fifth each, swipe for more.
  const itemClass = scrolls
    ? 'flex min-w-0 flex-none basis-1/5 snap-start flex-col items-center gap-1.5 py-1 lg:w-[76px] lg:basis-auto'
    : 'flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 py-1 max-w-[76px] lg:w-[76px] lg:flex-none lg:basis-auto';

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
      className="sticky bottom-0 z-40 flex-none border-t pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 lg:mb-6 lg:w-fit lg:self-center lg:rounded-full lg:border lg:px-3 lg:pb-2.5 lg:backdrop-blur shadow-[0_-4px_16px_rgba(40,30,20,.03)] lg:shadow-[0_12px_32px_rgba(40,30,20,.14)]"
      style={{
        borderColor: C.line,
        background: C.cardWarm,
        fontFamily: FONT.body,
      }}
    >
      {/* The row scrolls; the nav itself stays put, so the fade below can sit
          on its right edge without scrolling away. `relative` makes this the
          offset parent the active-tab reveal measures against. */}
      <div
        ref={scrollRef}
        className={`relative overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${scrolls ? 'snap-x snap-mandatory lg:snap-none' : ''}`}
      >
        <div className={`flex w-full ${scrolls ? 'justify-start lg:justify-center lg:gap-1 lg:px-2' : 'justify-center gap-1 px-2'} lg:w-auto lg:min-w-0`}>
          {outerTabs.map(({ to, label, Icon, end, action }) =>
            // "Log in" opens the sheet where it stands. Routing to /profile
            // first showed a page whose only content was another sign-in
            // button — two taps and a page load for one intent.
            action === 'SIGN_IN' && auth ? (
              <button key={to} type="button" onClick={() => auth.openSignIn()} className={itemClass}>
                {tabInner(Icon, label, false)}
              </button>
            ) : (
              <NavLink key={to} to={to} end={end} className={itemClass}>
                {({ isActive }) => tabInner(Icon, label, isActive)}
              </NavLink>
            ),
          )}
        </div>
      </div>
      {/* Tabs remain past the right edge: fade into the bar to say so. */}
      {moreToTheRight && (
        <span
          aria-hidden
          data-testid="bottom-nav-more-hint"
          className="pointer-events-none absolute inset-y-0 right-0 w-12 lg:hidden"
          style={{ background: `linear-gradient(to right, transparent, ${C.cardWarm})` }}
        />
      )}
    </nav>
  );
}

export { GRID_GROUND as APP_SHELL_GRID_GROUND };
