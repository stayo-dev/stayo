/*
 * WelcomePage — the front door at `/`, ported from Stayo Welcome.dc.html.
 *
 * Stayo serves two audiences with almost nothing in common: students looking
 * for a bed, and owners looking for software. Before this screen, `/` was the
 * owner marketing page and a student arriving from a search or a shared link
 * landed in a pitch about occupancy dashboards. This screen asks the question
 * once, in one gesture: a diagonal seam between the two, hover or tap a side
 * and the seam yields to it.
 *
 * "Start free" commits to the owner journey and hands off to `/owners` — the
 * marketing page that used to live at `/`. "Browse hostels" commits to the
 * tenant journey and hands off to `/discover`, Stayo Discover (ADR-073). Until
 * that page existed the tenant side was deliberately inert, reading its pitch
 * behind a "Coming soon" label rather than routing into a dead end; both
 * halves of the fork now lead somewhere real.
 *
 * **Picking a side is not permanent.** The Stayo logo on `/owners` links back
 * here, and this screen renders for everyone including signed-in owners —
 * both deliberate, because an owner has to be able to browse the tenant side.
 * Discover's own way back is its Profile tab, which links into the tenant
 * portal for anyone who already lives somewhere.
 *
 * The palette is hard-coded rather than themed — this renders before any
 * [data-app-theme] shell exists, so there is no token scope to inherit. Same
 * reasoning as StayoLoadingScreen. Manrope/Inter are already loaded by
 * index.html, so naming them here costs no extra font request.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, MapPin, Search, ShieldCheck, Wallet } from 'lucide-react';

import { StayoLoader, StayoMark, StayoWordmark } from '@shared/ui/brand';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { FootprintTrail } from './FootprintTrail';
import { playWelcomeChime } from './welcomeChime';

import './welcome.css';

/** Where "Start free" goes — the owner marketing page (ADR-071). */
const OWNER_LANDING = '/owners';

/** …and where a returning owner goes instead, skipping the pitch. */
const OWNER_DASHBOARD = '/owner/home';

/** Where "Browse hostels" goes — Stayo Discover, the public marketplace. */
const TENANT_DISCOVER = '/discover';

/**
 * The splash is a greeting, not a loading screen — it plays once per browser
 * session and then gets out of the way. Shorter than the design's 2.65s,
 * which is fine on a canvas and far too long as a front door.
 */
const SPLASH_MS = 1600;
const SPLASH_SEEN_KEY = 'stayo.welcome.splashSeen';

/** How long the commit overlay holds before the route actually changes. */
const COMMIT_MS = 650;

/** Half-spread of the diagonal seam, in % of viewport height. */
const SEAM_SPREAD = 3.2;

type Side = 'tenant' | 'owner';

/** A panel's pitch collapses when the *other* panel is the one being read. */
const PANEL_BODY = {
  open: 'max-h-[400px] overflow-hidden opacity-100 [transition:max-height_.5s_ease,opacity_.4s_ease_.1s]',
  shut: 'max-h-0 overflow-hidden opacity-0 [transition:max-height_.45s_ease,opacity_.25s_ease]',
} as const;

const PANEL_BASE =
  'stayo-welcome-panel absolute inset-0 cursor-pointer overflow-hidden [transition:clip-path_.55s_cubic-bezier(.4,0,.2,1)]';

/**
 * The seam as a clip-path. `pct` is where the diagonal's midpoint sits; the
 * two panels are given complementary polygons so they meet exactly along it
 * with no gap and no overlap at any width.
 */
function seam(pct: number, half: 'top' | 'bottom'): string {
  const near = `calc(${pct}% - ${SEAM_SPREAD}%)`;
  const far = `calc(${pct}% + ${SEAM_SPREAD}%)`;
  return half === 'top'
    ? `polygon(0 0, 100% 0, 100% ${far}, 0 ${near})`
    : `polygon(0 ${near}, 100% ${far}, 100% 100%, 0 100%)`;
}

function readSplashSeen(): boolean {
  try {
    return window.sessionStorage.getItem(SPLASH_SEEN_KEY) === '1';
  } catch {
    // Private mode / storage disabled — showing the splash again is a much
    // smaller failure than crashing the front door.
    return false;
  }
}

function markSplashSeen(): void {
  try {
    window.sessionStorage.setItem(SPLASH_SEEN_KEY, '1');
  } catch {
    /* nothing to do — see readSplashSeen */
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function WelcomePage() {
  const navigate = useNavigate();
  const session = useOwnerSession();

  // A signed-in owner used to be redirected straight to `/owners` from here.
  // That made this screen unreachable for the very person who most needs it:
  // an owner can't browse the tenant side — soon, real hostel listings — if
  // the front door bounces them out of it. The session now changes the owner
  // CTA's wording and destination instead of removing the choice.
  const returningOwner = session.isAuthenticated && session.hostels.length > 0;

  const [splashDone, setSplashDone] = useState(() => readSplashSeen() || prefersReducedMotion());
  const [hover, setHover] = useState<Side | null>(null);
  const [picked, setPicked] = useState<Side | null>(null);
  const [committing, setCommitting] = useState<Side | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (splashDone) return;
    const timer = setTimeout(() => {
      setSplashDone(true);
      markSplashSeen();
    }, SPLASH_MS);
    return () => clearTimeout(timer);
  }, [splashDone]);

  /**
   * The chime plays when the splash does — the same "first time this session"
   * condition, read once at mount.
   *
   * Deliberately its own mount-scoped effect rather than living in the splash
   * effect above: that one re-runs when `splashDone` flips, so its cleanup
   * would cut the chime off at SPLASH_MS. The audio is ~4s and the splash is
   * 1.6s, so it is meant to carry on past the mark landing and finish on its
   * own. The only thing that stops it early is leaving the page.
   */
  useEffect(() => {
    if (splashDone) return;
    return playWelcomeChime();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by
    // design; `splashDone` is read from the first render and must not re-trigger.
  }, []);

  useEffect(() => () => clearTimeout(commitTimer.current), []);

  useEffect(() => {
    document.title = 'Stayo — hostel living, sorted';
  }, []);

  // The session lookup usually resolves behind the splash, but on a slow
  // connection it can land after. Holding the panels inert until both are
  // settled stops a signed-in owner from seeing the chooser flash past.
  const ready = splashDone && !session.isLoading && !committing;
  const active = hover ?? picked;
  const pct = active === 'tenant' ? 66 : active === 'owner' ? 34 : 50;

  const commit = (side: Side, to: string | null) => {
    if (!ready || committing) return;
    setPicked(side);
    setCommitting(side);
    if (!to) return;
    // Choosing "owner" here *is* an answer to `/owners`' "Are you a hostel
    // owner?" prompt, so the landing page is told rather than asking again —
    // it opens the lead conversation on arrival and suppresses the prompt.
    // Router state (not a query param) matches how `OwnerLeadInvitePage`
    // already hands prefill data to `/onboarding`.
    const state = to === OWNER_LANDING ? { declaredOwnerIntent: true } : undefined;
    commitTimer.current = setTimeout(() => navigate(to, { state }), COMMIT_MS);
  };

  const select = (side: Side) => {
    if (!ready) return;
    setPicked(side);
    setHover(null);
  };

  return (
    <div className="stayo-welcome fixed inset-0 overflow-hidden bg-[#221E1A] font-['Inter',system-ui,sans-serif] antialiased">
      {/* ══════════ TENANT — top half ══════════ */}
      <section
        aria-label="Looking for a stay"
        onClick={() => select('tenant')}
        onMouseEnter={() => ready && setHover('tenant')}
        onMouseLeave={() => setHover(null)}
        className={PANEL_BASE}
        style={{ background: '#F5EEE6', zIndex: active === 'tenant' ? 2 : 1, clipPath: seam(pct, 'top') }}
      >
        {/* graph-paper ground, matching the owner marketing page's texture */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundColor: '#F5EEE6',
            backgroundImage: 'linear-gradient(#E7D8C9 1px,transparent 1px),linear-gradient(90deg,#E7D8C9 1px,transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div
          className="absolute -right-10 -top-8 h-50 w-50 rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(217,144,111,.30),transparent 70%)' }}
        />

        <div
          className={`stayo-welcome-content relative mx-auto w-full max-w-2xl px-8 pt-[clamp(3.5rem,9vh,7rem)] sm:px-10 lg:max-w-4xl lg:px-12 ${
            active === 'tenant' ? 'stayo-welcome-content--near' : ''
          }`}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EBDFD3] bg-white px-3 py-1.5 shadow-[0_2px_8px_rgba(40,30,20,.05)]">
            <MapPin className="h-3.5 w-3.5 text-[#B46A55]" strokeWidth={1.9} />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#8A5A47]">Looking for a stay</span>
          </span>

          {/* The upper bound is set by the *collapsed* state, not the neutral
              one: when the owner side is hovered the seam climbs to 34%, and
              the badge + both heading lines still have to clear it. 4.5rem is
              what fits at 1920×970 with margin to spare. */}
          <h1 className="mt-4 font-['Manrope',sans-serif] text-[clamp(2rem,5.2vw,4.5rem)] font-extrabold leading-[1.04] tracking-[-0.03em] text-[#221E1A]">
            Find your
            <br />
            stay.
          </h1>

          <div className={active === 'owner' ? PANEL_BODY.shut : PANEL_BODY.open}>
            <p className="mt-3 max-w-[19rem] text-sm font-medium leading-[1.5] text-[#6E645B] lg:max-w-[26rem] lg:text-base">
              Verified hostels near your campus — real photos, real reviews, no broker games.
            </p>

            <div className="mt-4 flex gap-4">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-[15px] w-[15px] text-[#8A5A47]" strokeWidth={1.8} />
                <span className="text-[11.5px] font-semibold text-[#5A5148]">Verified</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Search className="h-[15px] w-[15px] text-[#8A5A47]" strokeWidth={1.8} />
                <span className="text-[11.5px] font-semibold text-[#5A5148]">Search by college</span>
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={(event) => {
                  // The panel itself handles clicks to *choose* the tenant
                  // side; this button commits to it, so it must not also
                  // re-trigger the panel's selection behind the overlay.
                  event.stopPropagation();
                  commit('tenant', TENANT_DISCOVER);
                }}
                className="inline-flex items-center gap-2.5 rounded-2xl bg-[#221E1A] px-5 py-3.5 transition-transform active:scale-[0.98]"
              >
                <span className="font-['Manrope',sans-serif] text-sm font-bold tracking-[-0.01em] text-white">Browse hostels</span>
                <ArrowRight className="h-[17px] w-[17px] text-[#D9906F]" strokeWidth={2} />
              </button>
              <span className="text-[11.5px] font-semibold text-[#8A7C72]">Verified hostels only</span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ OWNER — bottom half ══════════ */}
      <section
        aria-label="For hostel owners"
        onClick={() => select('owner')}
        onMouseEnter={() => ready && setHover('owner')}
        onMouseLeave={() => setHover(null)}
        className={PANEL_BASE}
        style={{ background: '#221E1A', zIndex: active === 'owner' ? 2 : 1, clipPath: seam(pct, 'bottom') }}
      >
        <div
          className="absolute -bottom-10 -left-12 h-60 w-60 rounded-full [animation:stayo-welcome-glow_5s_ease-in-out_infinite]"
          style={{ background: 'radial-gradient(circle,rgba(217,144,111,.22),transparent 70%)' }}
        />

        <div
          className={`stayo-welcome-content relative mx-auto flex h-full w-full max-w-2xl flex-col justify-end px-8 pb-[clamp(3rem,10vh,8rem)] sm:px-10 lg:max-w-4xl lg:px-12 ${
            active === 'owner' ? 'stayo-welcome-content--near' : ''
          }`}
        >
          <span className="inline-flex items-center gap-2 self-start rounded-full border border-[#D9906F]/30 bg-[#D9906F]/[0.14] px-3.5 py-1.5">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-[#D9906F]" />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#E7A986]">For hostel owners</span>
          </span>

          {/* Slightly under the tenant heading's cap: this one is bottom-anchored
              and carries a longer first line, so matching sizes made it the
              heavier of the two rather than the equal it should read as. */}
          <h2 className="mt-4 font-['Manrope',sans-serif] text-[clamp(1.9rem,4.9vw,4.25rem)] font-extrabold leading-[1.06] tracking-[-0.03em] text-white">
            Run your hostel,
            <br />
            effortlessly.
          </h2>

          <div className={active === 'tenant' ? PANEL_BODY.shut : PANEL_BODY.open}>
            <p className="mt-3 max-w-[20rem] text-sm font-medium leading-[1.5] text-[#B6ABA0] lg:max-w-[28rem] lg:text-base">
              Fill empty beds faster, collect rent on autopilot, and resolve complaints before they pile up.
            </p>

            <div className="mt-4 flex gap-[18px]">
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-[15px] w-[15px] text-[#E7A986]" strokeWidth={1.8} />
                <span className="text-[11.5px] font-semibold text-[#C9BEB2]">Live occupancy</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Wallet className="h-[15px] w-[15px] text-[#E7A986]" strokeWidth={1.8} />
                <span className="text-[11.5px] font-semibold text-[#C9BEB2]">Auto rent</span>
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  commit('owner', returningOwner ? OWNER_DASHBOARD : OWNER_LANDING);
                }}
                className="inline-flex items-center gap-2.5 rounded-2xl bg-[#D9906F] px-5 py-3.5 shadow-[0_12px_28px_rgba(217,144,111,.35)] transition-transform active:scale-95"
              >
                <span className="font-['Manrope',sans-serif] text-sm font-extrabold tracking-[-0.01em] text-[#221E1A]">
                  {returningOwner ? 'Go to dashboard' : 'Start free'}
                </span>
                <ArrowRight className="h-[17px] w-[17px] text-[#221E1A]" strokeWidth={2.2} />
              </button>
              {!returningOwner && <span className="text-[11.5px] font-semibold text-[#8C8177]">No card needed</span>}
            </div>
          </div>
        </div>
      </section>

      {/* Footprints — trailing the cursor on desktop, a dragged finger plus an
          ambient stroll on touch. Sits above both panels so a print can cross
          the seam, below the roundel so nothing occludes the mark. */}
      <FootprintTrail pct={pct} enabled={splashDone} />

      {/* ══════════ the mark rides the seam ══════════ */}
      <div
        className="absolute left-1/2 z-[12] [transition:top_.55s_cubic-bezier(.4,0,.2,1)]"
        style={
          splashDone
            ? { top: `calc(${pct}% - 26px)`, animation: 'stayo-welcome-pop .55s cubic-bezier(.34,1.4,.5,1) both' }
            : { top: `calc(${pct}% - 26px)`, opacity: 0, transform: 'translateX(-50%)' }
        }
      >
        <div className="flex h-13 w-13 items-center justify-center rounded-full bg-white shadow-[0_8px_22px_rgba(34,30,26,.30),0_0_0_5px_rgba(245,238,230,.9)]">
          <StayoMark className="h-7 w-auto text-[#B46A55]" />
        </div>
      </div>

      {/* ══════════ brand greeting ══════════ */}
      <div
        className="stayo-welcome-splash absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#F5EEE6] [transition:opacity_.55s_ease,transform_.55s_ease]"
        style={splashDone ? { opacity: 0, transform: 'scale(1.05)', pointerEvents: 'none' } : undefined}
        aria-hidden={splashDone}
      >
        <div className="flex items-center gap-3 [animation:stayo-welcome-logo-in_1s_cubic-bezier(.34,1.2,.5,1)_both]">
          <StayoMark className="h-14 w-auto text-[#B46A55]" />
          <StayoWordmark className="h-9 w-auto text-[#B46A55]" />
        </div>

        <div className="mt-5 flex items-center gap-2.5">
          {['Manage', 'Automate', 'Grow'].map((word, index) => (
            <span key={word} className="flex items-center gap-2.5">
              {index > 0 && (
                <span
                  className="h-1 w-1 rounded-full bg-[#D9AE96]"
                  style={{ animation: `stayo-welcome-fade .5s ease ${0.78 + (index - 1) * 0.31}s both` }}
                />
              )}
              <span
                className="font-['Manrope',sans-serif] text-[12.5px] font-bold tracking-[0.02em] text-[#B46A55]"
                style={{ animation: `stayo-welcome-word-in .7s ease ${0.35 + index * 0.19}s both` }}
              >
                {word}
              </span>
            </span>
          ))}
        </div>

        <div className="mt-7 h-[3px] w-33 overflow-hidden rounded-full bg-[#B46A55]/[0.16]">
          <div
            className="h-full origin-left rounded-full bg-[#D9906F]"
            style={{ animation: `stayo-welcome-bar ${SPLASH_MS}ms cubic-bezier(.45,0,.2,1) both` }}
          />
        </div>
      </div>

      {/* ══════════ commit overlay ══════════
          The design canvas drew a rotating ring here. The app doesn't own one:
          every wait in Stayo is the mark's four windows lighting clockwise
          (see shared/ui/brand/index.ts), so this uses StayoLoader instead. */}
      {committing && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[#221E1A]/55 backdrop-blur-[3px] [animation:stayo-welcome-fade_.25s_ease]">
          <StayoLoader size="lg" label={null} className="text-[#D9906F]" />
          <p className="text-[13px] font-bold text-white">Opening your owner dashboard…</p>
        </div>
      )}
    </div>
  );
}
