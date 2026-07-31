import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, LayoutGrid, ArrowRight, Check, Menu, X } from 'lucide-react';
import { LoginModal, type LoginModalUser } from '@shared/ui-patterns/LoginModal';
import { GoogleSignInModal } from '@shared/ui-patterns/GoogleSignInModal';
import { HeroShowcase } from './components/HeroShowcase';
import { HostelDiscoveryDemo } from './components/HostelDiscoveryDemo';
import { MarketingFooter } from './components/MarketingFooter';
import { TrishulMark } from '@shared/ui-patterns/TrishulMark';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { ThemeProvider } from '@/app/providers/ThemeProvider';

const STUDENT_STEPS = [
  { n: '1', t: 'Search', d: 'Filter by college, budget & sharing' },
  { n: '2', t: 'Enquire', d: 'Send a request — no instant booking' },
  { n: '3', t: 'Move In', d: 'Approved, KYC done digitally' },
  { n: '4', t: 'Stay', d: 'Support & updates on WhatsApp' },
  { n: '5', t: 'Move Out', d: 'Clean exit, deposit settled' },
];

const OWNER_STEPS = [
  { n: '1', t: 'Property', d: 'List & verify your hostel' },
  { n: '2', t: 'Rooms', d: 'Map beds, sharing & pricing' },
  { n: '3', t: 'Tenants', d: 'Approve enquiries & onboard' },
  { n: '4', t: 'Rent', d: 'Automated collection & reminders' },
  { n: '5', t: 'Reports', d: 'Occupancy, dues & insights' },
];

const FEATURES = [
  { tag: 'FOR TENANTS', dark: false, title: 'Verified Hostels', body: 'Every property is manually checked before it goes live — no surprises on move-in day.' },
  { tag: 'FOR OWNERS', dark: true, title: 'Automated Rent Collection', body: 'Auto-invoices, WhatsApp reminders and one-tap payments — dues chase themselves.' },
  { tag: 'FOR TENANTS', dark: false, title: 'Near Colleges', body: 'Filter by campus and walking distance to find the right home in the right spot.' },
  { tag: 'FOR OWNERS', dark: true, title: 'Occupancy & Revenue Insights', body: 'Live occupancy, dues and revenue trends — know exactly how your hostel is performing.' },
  { tag: 'FOR TENANTS', dark: false, title: 'Transparent Pricing', body: 'Clear rent, deposit and inclusions upfront. What you see is what you pay — no brokers.' },
  { tag: 'FOR OWNERS', dark: true, title: 'Digital Agreements & KYC', body: 'Onboard tenants online — paperless KYC and e-signed agreements stored securely.' },
];

const TRUST_ITEMS = [
  'Manually Verified Hostels',
  'Verified Owners',
  'Transparent Pricing',
  'Real Images',
  'Secure Documents',
  'Digital Agreements',
];

const STUDENT_TESTIMONIALS = [
  { text: 'I found a verified hostel 5 minutes from campus and enquired in a tap. The photos were exactly what I moved into.', name: 'Ananya Rao', role: 'Student · VIT Pune' },
  { text: 'No broker games, clear pricing, and the owner approved my request the same day.', name: 'Karan Mehta', role: 'Student · SRM Chennai' },
];

const OWNER_TESTIMONIALS = [
  { text: 'Rent collection used to eat my weekends. Now reminders go out automatically and I see every payment in one place.', name: 'Rahul Verma', role: 'Owner · Sunrise Hostels' },
  { text: 'Enquiries doubled after I got verified, and onboarding tenants digitally cut my paperwork to zero.', name: 'Priya Nair', role: 'Owner · Nest Co-Living' },
];

const NAV_LINKS = [
  { href: '#search', label: 'Hostels' },
  { href: '#journey', label: 'For Owners' },
  { href: '#why', label: 'Features' },
  // `#whatis`, not `#vision` — there is no `vision` section on this page, so
  // that anchor had never scrolled anywhere (fixed 2026-07-31).
  { href: '#whatis', label: 'About' },
  { href: '#footer', label: 'Contact' },
];

/**
 * StayO marketing landing page, per Stayo Homepage.dc.html — the entry point
 * of the owner acquisition journey (Landing → Get Started → Login → Lead
 * Submitted → Activation → Onboarding → Dashboard). Tenant-side CTAs
 * (Explore Hostels / Search) are static per the earlier decision to defer
 * the real Discover marketplace to V2; only the owner path is wired up this
 * phase.
 */
export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useOwnerSession();

  // `/login` renders this page with the login popup open (ADR-035), so every
  // redirect that needs a real URL — session expiry, the admin guard,
  // password reset, tenant activation — still has one to point at.
  const isLoginRoute = location.pathname === '/login';

  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [heroTab, setHeroTab] = useState<'tenant' | 'owner'>('tenant');
  const [searchTab, setSearchTab] = useState<'search' | 'list'>('search');
  const [tenantAuthOpen, setTenantAuthOpen] = useState(location.pathname === '/login');
  const [googleAuthOpen, setGoogleAuthOpen] = useState(false);
  const [tenantUser, setTenantUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // React Router doesn't scroll to `#anchor` on navigation, so arriving from
  // another route (e.g. /contact's nav, which links to `/#search`) would land
  // at the top of the page instead of the section asked for. In-page clicks
  // are unaffected — the browser already handles those natively.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    // One frame later, so the target section has rendered.
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Owner entry point (Get Started / Manage My Hostel / Book a demo — all one
  // flow now): real Google sign-in (Supabase, ADR-031), then — on the
  // dedicated `/lead-signup/callback` page it redirects to — a real popup
  // collects hostel/owner/phone + a phone OTP, ending in a "we'll be in
  // touch" message — a human reviews the lead before any real account
  // exists. The real onboarding wizard (real signup/OTP/hostel creation) is
  // reached separately, via an activation link sent after admin approval
  // (see ActivationLinkPage) — NOT directly from this landing-page CTA.
  // A returning owner who already has a real, fully-onboarded account (real
  // session + a real hostel) skips straight to the dashboard instead of
  // being shown the lead popup again.
  const openOwnerAuth = () => {
    if (session.isAuthenticated && session.hostels.length > 0) {
      navigate('/owner/home');
      return;
    }
    setGoogleAuthOpen(true);
  };

  const openTenantAuth = () => {
    if (tenantUser) return;
    setTenantAuthOpen(true);
  };

  /**
   * Role routing for the one login surface (ADR-035) — this is the logic the
   * deleted `/login` page used to own. The tenant branch is the new part: a
   * marketplace account has no `tenants` record, so `/tenant/home` (dues,
   * agreements, room) has nothing to show it — it stays here to browse.
   */
  const handleAuthSuccess = (authUser: LoginModalUser) => {
    setTenantAuthOpen(false);
    const role = (authUser.role || '').toLowerCase();

    if (role === 'admin') {
      navigate('/admin', { replace: true });
      return;
    }
    if (role === 'owner') {
      navigate('/owner/home', { replace: true });
      return;
    }
    if (authUser.tenantId) {
      navigate('/tenant/home', { replace: true });
      return;
    }

    setTenantUser({ name: authUser.name, email: authUser.email });
    if (isLoginRoute) navigate('/', { replace: true });
  };

  const ownerCtaLabel = session.isAuthenticated && session.hostels.length > 0 ? 'Go to Dashboard' : 'Manage My Hostel';

  return (
    <ThemeProvider theme="marketing">
    <div className="overflow-x-hidden bg-background text-foreground [background-image:linear-gradient(rgba(120,80,70,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(120,80,70,.07)_1px,transparent_1px)] [background-size:52px_52px]">
      <LoginModal
        open={tenantAuthOpen}
        mode="tenant"
        initialTab={new URLSearchParams(location.search).get('signup') === '1' ? 'signup' : 'login'}
        onClose={() => {
          setTenantAuthOpen(false);
          // Don't strand the visitor on a bare /login with no dialog.
          if (isLoginRoute) navigate('/', { replace: true });
        }}
        onSuccess={handleAuthSuccess}
      />
      <GoogleSignInModal open={googleAuthOpen} onClose={() => setGoogleAuthOpen(false)} />

      {/* ============ NAV ============ */}
      <nav
        className={`fixed inset-x-0 top-0 z-[100] border-b transition-all duration-300 ${
          scrolled ? 'border-border bg-background/85 shadow-[0_8px_30px_-18px_rgba(47,47,47,0.35)] backdrop-blur-lg' : 'border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3.5 sm:px-6">
          <a href="#top" className="flex flex-none items-center gap-2">
            <span className="font-display text-xl font-extrabold tracking-tight text-primary">Stayo</span>
          </a>
          <div className="flex-1" />
          <div className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="text-sm font-semibold text-foreground/80 hover:text-primary">
                {link.label}
              </a>
            ))}
            <Link to="/company" className="text-sm font-semibold text-foreground/80 hover:text-primary">
              Company
            </Link>
            <span className="h-5 w-px bg-border" />
            <button type="button" onClick={openTenantAuth} className="text-sm font-semibold text-foreground/80 hover:text-primary">
              {tenantUser ? `Hi, ${tenantUser.name.split(' ')[0]}` : 'Login'}
            </button>
            <a
              href="#search"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4.5 py-2.5 font-display text-sm font-bold text-primary-foreground shadow-[0_8px_18px_-8px_rgba(164,93,68,0.6)] transition-transform hover:scale-[1.02]"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={2.4} />
              Search Hostels
            </a>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            className="flex items-center justify-center rounded-[10px] border border-border bg-card p-2.5 md:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
        {menuOpen && (
          <div className="flex flex-col gap-1 border-y border-border bg-card px-4 py-3 md:hidden">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="border-b border-border/50 py-2.5 text-[15px] font-semibold text-foreground last:border-none"
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/company"
              onClick={() => setMenuOpen(false)}
              className="border-b border-border/50 py-2.5 text-[15px] font-semibold text-foreground"
            >
              Company
            </Link>
            {/* Login is the only way into the app from here — the popup is the
                single login surface (ADR-035), so leaving it out of the mobile
                menu made logging in impossible on a phone. */}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openTenantAuth();
              }}
              className="border-b border-border/50 py-2.5 text-left text-[15px] font-semibold text-foreground"
            >
              {tenantUser ? `Hi, ${tenantUser.name.split(' ')[0]}` : 'Login'}
            </button>
            <a
              href="#search"
              onClick={() => setMenuOpen(false)}
              className="mt-2 rounded-xl bg-primary py-3 text-center font-display text-[15px] font-bold text-primary-foreground"
            >
              Search Hostels
            </a>
          </div>
        )}
      </nav>

      <div id="top" />

      {/* ============ HERO ============ */}
      <header className="relative px-4 pb-16 pt-[132px] sm:px-6">
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 [grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr))]">
          <div className="max-w-[560px]">
            <div className="mb-5.5 inline-flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-2 pr-3.5 shadow-[0_4px_14px_-8px_rgba(47,47,47,0.15)]">
              <span className="rounded-full bg-secondary px-2.5 py-1 font-display text-[10px] font-bold tracking-wider text-primary">
                STAY OPERATIONS
              </span>
              <span className="text-[12.5px] font-semibold text-muted-foreground">Marketplace + Operations, together</span>
            </div>
            <h1 className="mb-5.5 font-display text-[clamp(38px,5.6vw,64px)] font-extrabold leading-[1.03] tracking-tight text-balance">
              Find Your Stay.
              <br />
              <span className="text-primary">Manage Every Stay.</span>
            </h1>

            <div role="tablist" className="relative mb-5.5 flex max-w-[440px] gap-0 rounded-[17px] border border-border bg-card p-1.5 shadow-[0_10px_30px_-20px_rgba(47,47,47,0.4)]">
              <div
                aria-hidden="true"
                className={`absolute inset-y-1.5 z-0 w-[calc(50%-6px)] rounded-[13px] transition-transform duration-300 ease-out ${
                  heroTab === 'owner'
                    ? 'translate-x-full bg-foreground shadow-[0_10px_24px_-10px_rgba(47,47,47,0.4)]'
                    : 'translate-x-0 bg-primary shadow-[0_10px_24px_-10px_rgba(164,93,68,0.55)]'
                }`}
              />
              <button
                role="tab"
                type="button"
                onClick={() => setHeroTab('tenant')}
                className={`relative z-10 flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[13px] px-3 py-3.5 font-display text-[15px] font-bold transition-colors ${
                  heroTab === 'tenant' ? 'text-primary-foreground' : 'text-muted-foreground'
                }`}
              >
                <Search className="h-4 w-4" strokeWidth={2.2} />
                Find Your Stay
              </button>
              <button
                role="tab"
                type="button"
                onClick={() => setHeroTab('owner')}
                className={`relative z-10 flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[13px] px-3 py-3.5 font-display text-[15px] font-bold transition-colors ${
                  heroTab === 'owner' ? 'text-background' : 'text-muted-foreground'
                }`}
              >
                <LayoutGrid className="h-4 w-4" strokeWidth={2.2} />
                Manage Your Stay
              </button>
            </div>

            <p className="mb-7 max-w-[500px] text-[clamp(15px,1.5vw,18px)] leading-relaxed text-muted-foreground">
              One platform for the entire stay lifecycle — a verified marketplace for students and a complete operations
              system for owners.
            </p>

            {heroTab === 'tenant' ? (
              <div key="tenant-cta" className="flex flex-wrap gap-3.5 animate-in fade-in slide-in-from-left-2 duration-300">
                <a
                  href="#search"
                  className="inline-flex items-center gap-2 rounded-[13px] bg-primary px-6.5 py-3.5 font-display text-base font-bold text-primary-foreground shadow-[0_14px_30px_-12px_rgba(164,93,68,0.65)] transition-transform hover:scale-[1.02]"
                >
                  Explore Hostels
                  <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
                </a>
                <a
                  href="#whatis"
                  className="inline-flex items-center gap-2 rounded-[13px] border border-border bg-card px-6.5 py-3.5 font-display text-base font-bold text-foreground transition-all hover:border-primary/40 hover:scale-[1.02]"
                >
                  See how it works
                </a>
              </div>
            ) : (
              <div key="owner-cta" className="flex flex-wrap gap-3.5 animate-in fade-in slide-in-from-left-2 duration-300">
                <button
                  type="button"
                  onClick={openOwnerAuth}
                  className="inline-flex items-center gap-2 rounded-[13px] bg-foreground px-6.5 py-3.5 font-display text-base font-bold text-background shadow-[0_14px_30px_-14px_rgba(47,47,47,0.5)] transition-transform hover:scale-[1.02]"
                >
                  {ownerCtaLabel}
                  <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  onClick={openOwnerAuth}
                  className="inline-flex items-center gap-2 rounded-[13px] border border-border bg-card px-6.5 py-3.5 font-display text-base font-bold text-foreground transition-all hover:border-foreground/30 hover:scale-[1.02]"
                >
                  Book a demo
                </button>
              </div>
            )}

            {/* Subtle company trust indicator — secondary to the Stayo hero */}
            <Link
              to="/company"
              className="mt-7 inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-primary"
            >
              <TrishulMark className="h-4 w-4 flex-none text-primary/70" />
              A product by Trishul Solutions
            </Link>
          </div>

          <div className="flex min-h-[420px] w-full items-center justify-self-center sm:min-h-[520px]">
            <HeroShowcase active={heroTab} />
          </div>
        </div>
      </header>

      {/* ============ SEARCH / LIST DUAL TAB ============ */}
      <section id="search" className="px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="relative mx-auto mb-4 flex max-w-[440px] gap-0 rounded-2xl border border-border bg-card p-1.5 shadow-[0_10px_30px_-22px_rgba(47,47,47,0.4)]">
            <div
              aria-hidden="true"
              className={`absolute inset-y-1.5 z-0 w-[calc(50%-6px)] rounded-[11px] transition-transform duration-300 ease-out ${
                searchTab === 'list'
                  ? 'translate-x-full bg-foreground shadow-[0_8px_20px_-10px_rgba(47,47,47,0.4)]'
                  : 'translate-x-0 bg-primary shadow-[0_8px_20px_-10px_rgba(164,93,68,0.5)]'
              }`}
            />
            <button
              type="button"
              onClick={() => setSearchTab('search')}
              className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[11px] px-3 py-2.5 font-display text-sm font-bold transition-colors ${
                searchTab === 'search' ? 'text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              <Search className="h-4 w-4" strokeWidth={2.2} />
              Search Hostels
            </button>
            <button
              type="button"
              onClick={() => setSearchTab('list')}
              className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[11px] px-3 py-2.5 font-display text-sm font-bold transition-colors ${
                searchTab === 'list' ? 'text-background' : 'text-muted-foreground'
              }`}
            >
              <LayoutGrid className="h-4 w-4" strokeWidth={2.2} />
              List Your Hostel
            </button>
          </div>

          {searchTab === 'search' ? (
            <HostelDiscoveryDemo />
          ) : (
            <div className="rounded-[22px] border border-white/10 bg-foreground p-3.5 shadow-[0_30px_70px_-42px_rgba(47,47,47,0.5)]">
              <div className="flex flex-wrap items-stretch gap-0.5">
                {[
                  ['PROPERTY NAME', 'Sunrise Boys Hostel'],
                  ['CITY', 'Pune'],
                  ['NO. OF BEDS', '48'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-[130px] flex-1 rounded-2xl px-4.5 py-3.5 hover:bg-white/5">
                    <div className="mb-1 font-display text-[11px] font-bold tracking-wide text-[#D2986C]">{label}</div>
                    <div className="text-[15px] font-semibold text-background">{value}</div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={openOwnerAuth}
                  className="m-1.5 flex flex-none items-center gap-2 rounded-2xl bg-background px-6 font-display text-[15px] font-bold text-foreground transition-transform hover:scale-[1.03] max-sm:w-full max-sm:justify-center max-sm:py-3.5"
                >
                  <Check className="h-4 w-4 text-primary" strokeWidth={2.6} />
                  Get Verified
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 px-2 pb-1 pt-3">
                <span className="text-sm font-semibold text-background/55">Popular:</span>
                {['PGs near VIT Pune', 'Co-living setups', 'Auto rent collection', 'Free verification'].map((p) => (
                  <a
                    key={p}
                    href="#search"
                    className="rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[13px] font-semibold text-background hover:border-[#D2986C] hover:text-[#EBD9C4]"
                  >
                    {p}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ============ TRUST STATS BAR ============ */}
      <section className="px-4 py-6 sm:px-6">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4 rounded-[20px] border border-border bg-card p-6 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.3)] sm:grid-cols-4">
          {[
            ['12,000+', 'Beds listed'],
            ['400+', 'Verified owners'],
            ['60+', 'Colleges nearby'],
          ].map(([n, label], i) => (
            <div key={label} className={`text-center ${i > 0 ? 'border-l border-border' : ''}`}>
              <div className="font-display text-[clamp(26px,3vw,36px)] font-extrabold tabular-nums text-foreground">{n}</div>
              <div className="mt-0.5 text-[13px] font-medium text-muted-foreground">{label}</div>
            </div>
          ))}
          <div className="border-l border-border text-center">
            <div className="font-display text-[clamp(26px,3vw,36px)] font-extrabold tabular-nums text-primary">
              4.8<span className="text-[0.5em] font-normal text-muted-foreground">/5</span>
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-muted-foreground">Tenant rating</div>
          </div>
        </div>
      </section>

      {/* ============ WHAT IS STAYO ============ */}
      <section id="whatis" className="px-4 py-16 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">WHAT IS STAYO</div>
          <h2 className="mb-4.5 text-balance font-display text-[clamp(30px,4vw,46px)] font-extrabold leading-[1.08] tracking-tight">
            One platform, two journeys — equally served
          </h2>
          <p className="text-[17px] leading-relaxed text-muted-foreground">
            Stayo means <b className="text-foreground">Stay Operations</b>. Students discover verified homes; owners run
            them effortlessly — on a single rail from move-in to move-out.
          </p>
        </div>
        <div className="mx-auto grid max-w-5xl gap-6 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <div className="rounded-[22px] border border-border bg-card p-7 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)]">
            <div className="mb-6 flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                <Search className="h-5 w-5 text-primary" strokeWidth={2} />
              </span>
              <div>
                <div className="font-display text-lg font-extrabold text-foreground">Tenant Journey</div>
                <div className="text-[12.5px] font-medium text-muted-foreground">Students &amp; residents</div>
              </div>
            </div>
            {STUDENT_STEPS.map((s, i) => (
              <div key={s.n} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">
                    {s.n}
                  </span>
                  {i < STUDENT_STEPS.length - 1 && (
                    <span className="min-h-3.5 w-px flex-1 bg-gradient-to-b from-secondary to-transparent" />
                  )}
                </div>
                <div className="pb-4">
                  <div className="font-display text-[15px] font-bold text-foreground">{s.t}</div>
                  <div className="text-[13px] leading-snug text-muted-foreground">{s.d}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-[22px] bg-foreground p-7 shadow-[0_24px_54px_-30px_rgba(47,47,47,0.5)]">
            <div className="mb-6 flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
                <LayoutGrid className="h-5 w-5 text-[#D2986C]" strokeWidth={2} />
              </span>
              <div>
                <div className="font-display text-lg font-extrabold text-background">Owner Journey</div>
                <div className="text-[12.5px] font-medium text-background/55">Hostel operators</div>
              </div>
            </div>
            {OWNER_STEPS.map((s, i) => (
              <div key={s.n} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-full bg-[#D2986C] font-display text-xs font-bold text-foreground">
                    {s.n}
                  </span>
                  {i < OWNER_STEPS.length - 1 && (
                    <span className="min-h-3.5 w-px flex-1 bg-gradient-to-b from-[#D2986C]/50 to-transparent" />
                  )}
                </div>
                <div className="pb-4">
                  <div className="font-display text-[15px] font-bold text-background">{s.t}</div>
                  <div className="text-[13px] leading-snug text-background/60">{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WHY CHOOSE STAYO ============ */}
      <section id="why" className="px-4 py-16 sm:px-6">
        <div className="mx-auto mb-11 max-w-2xl text-center">
          <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">WHY CHOOSE STAYO</div>
          <h2 className="mb-3 text-balance font-display text-[clamp(30px,4vw,46px)] font-extrabold leading-[1.08] tracking-tight">
            Value on both sides of the stay
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            Three reasons students trust us — three reasons owners grow with us.
          </p>
        </div>
        <div className="mx-auto grid max-w-5xl gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className={`rounded-[20px] p-6.5 transition-transform hover:-translate-y-1 ${
                f.dark ? 'bg-foreground shadow-[0_28px_54px_-28px_rgba(47,47,47,0.65)]' : 'border border-border bg-card shadow-[0_24px_48px_-28px_rgba(47,47,47,0.34)]'
              }`}
            >
              <div className="mb-4.5 flex items-center justify-between">
                <span className={`flex h-11.5 w-11.5 items-center justify-center rounded-[13px] ${f.dark ? 'bg-white/10' : 'bg-secondary'}`}>
                  <Check className={`h-5.5 w-5.5 ${f.dark ? 'text-[#D2986C]' : 'text-primary'}`} strokeWidth={2} />
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 font-display text-[10px] font-bold tracking-wide ${
                    f.dark ? 'bg-white/15 text-[#EBD9C4]' : 'bg-secondary text-primary'
                  }`}
                >
                  {f.tag}
                </span>
              </div>
              <h3 className={`mb-1.5 font-display text-lg font-bold ${f.dark ? 'text-background' : 'text-foreground'}`}>
                {f.title}
              </h3>
              <p className={`text-sm leading-relaxed ${f.dark ? 'text-background/62' : 'text-muted-foreground'}`}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ CHOOSE YOUR JOURNEY ============ */}
      <section id="journey" className="px-4 py-10 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-6.5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <div className="relative overflow-hidden rounded-[26px] border border-primary/15 bg-gradient-to-br from-[#FBF3EA] to-[#F3E4D5] p-9 transition-all hover:-translate-y-1 hover:shadow-[0_34px_64px_-30px_rgba(164,93,68,0.42)]">
            <span className="mb-5 inline-flex h-[50px] w-[50px] items-center justify-center rounded-[15px] bg-primary shadow-[0_12px_24px_-10px_rgba(164,93,68,0.6)]">
              <Search className="h-6 w-6 text-primary-foreground" strokeWidth={2} />
            </span>
            <h3 className="mb-2 font-display text-2xl font-extrabold text-foreground">Looking for a place to stay</h3>
            <p className="mb-5.5 text-[14.5px] leading-relaxed text-muted-foreground">
              Find safe, verified hostels near your college — real photos, transparent pricing.
            </p>
            <a
              href="#search"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_26px_-12px_rgba(164,93,68,0.6)] transition-all hover:gap-3"
            >
              Explore Hostels
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </a>
          </div>
          <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-gradient-to-br from-[#33302E] to-[#232120] p-9 transition-all hover:-translate-y-1 hover:shadow-[0_34px_64px_-30px_rgba(47,47,47,0.6)]">
            <span className="mb-5 inline-flex h-[50px] w-[50px] items-center justify-center rounded-[15px] bg-white/10">
              <LayoutGrid className="h-6 w-6 text-[#D2986C]" strokeWidth={2} />
            </span>
            <h3 className="mb-2 font-display text-2xl font-extrabold text-background">Want to grow your hostel?</h3>
            <p className="mb-5.5 text-[14.5px] leading-relaxed text-background/66">
              Turn manual chaos into automated operations — more enquiries, less busywork.
            </p>
            <button
              type="button"
              onClick={openOwnerAuth}
              className="inline-flex items-center gap-2 rounded-xl bg-background px-6 py-3.5 font-display text-[15px] font-bold text-foreground transition-all hover:gap-3"
            >
              {ownerCtaLabel}
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </section>

      {/* ============ TRUST BADGES ============ */}
      <section className="px-4 py-10 sm:px-6">
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[28px] bg-primary p-9 sm:p-14">
          <div className="relative mb-8.5 max-w-xl">
            <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-[#EBD9C4]">TRUST, BUILT IN</div>
            <h2 className="mb-3.5 text-balance font-display text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.1] tracking-tight text-primary-foreground">
              Trust is our biggest differentiator
            </h2>
            <p className="text-base leading-relaxed text-primary-foreground/82">
              No instant booking. Owners review every request and every listing is verified — so students move into
              exactly what they were promised.
            </p>
          </div>
          <div className="relative grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            {TRUST_ITEMS.map((label) => (
              <div key={label} className="flex items-center gap-3 rounded-2xl border border-white/16 bg-white/12 px-4.5 py-4">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white">
                  <Check className="h-4 w-4 text-primary" strokeWidth={2.8} />
                </span>
                <span className="font-display text-[14.5px] font-bold text-primary-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ TESTIMONIALS ============ */}
      <section className="px-4 py-14 sm:px-6">
        <div className="mx-auto mb-11 max-w-2xl text-center">
          <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">LOVED BY BOTH SIDES</div>
          <h2 className="text-balance font-display text-[clamp(28px,4vw,44px)] font-extrabold leading-[1.08] tracking-tight">
            Students settle in. Owners scale up.
          </h2>
        </div>
        <div className="mx-auto grid max-w-5xl gap-5.5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <div className="flex flex-col gap-4">
            <div className="font-display text-xs font-bold tracking-wide text-muted-foreground">STUDENTS</div>
            {STUDENT_TESTIMONIALS.map((q) => (
              <div key={q.name} className="rounded-[20px] border border-border bg-card p-6.5 hover:shadow-[0_24px_50px_-30px_rgba(47,47,47,0.36)]">
                <div className="mb-4.5 text-[15.5px] leading-relaxed text-foreground/90">&ldquo;{q.text}&rdquo;</div>
                <div className="flex items-center gap-2.5">
                  <span className="h-9.5 w-9.5 rounded-full [background:repeating-linear-gradient(135deg,#D2986C_0_5px,#c88a5c_5px_10px)]" />
                  <div>
                    <div className="font-display text-sm font-bold text-foreground">{q.name}</div>
                    <div className="text-[12.5px] font-medium text-muted-foreground">{q.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            <div className="font-display text-xs font-bold tracking-wide text-muted-foreground">HOSTEL OWNERS</div>
            {OWNER_TESTIMONIALS.map((q) => (
              <div key={q.name} className="rounded-[20px] bg-foreground p-6.5 hover:shadow-[0_26px_54px_-28px_rgba(47,47,47,0.6)]">
                <div className="mb-4.5 text-[15.5px] leading-relaxed text-background/92">&ldquo;{q.text}&rdquo;</div>
                <div className="flex items-center gap-2.5">
                  <span className="h-9.5 w-9.5 rounded-full [background:repeating-linear-gradient(135deg,#B46A55_0_5px,#a55f4b_5px_10px)]" />
                  <div>
                    <div className="font-display text-sm font-bold text-background">{q.name}</div>
                    <div className="text-[12.5px] font-medium text-background/55">{q.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="px-4 py-14 pb-[70px] sm:px-6">
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[30px] bg-foreground px-7 py-11 text-center sm:px-15 sm:py-[78px]">
          <h2 className="mb-4 text-balance font-display text-[clamp(30px,4.6vw,52px)] font-extrabold leading-[1.06] tracking-tight text-background">
            Ready to make every stay effortless?
          </h2>
          <p className="mx-auto mb-8 max-w-lg text-[clamp(15px,1.5vw,18px)] leading-relaxed text-background/66">
            Whether you&apos;re finding a home or filling one, Stayo runs the whole journey — move-in to move-out.
          </p>
          <div className="flex flex-wrap justify-center gap-3.5">
            <a
              href="#search"
              className="inline-flex items-center gap-2 rounded-[13px] bg-primary px-7 py-4 font-display text-base font-bold text-primary-foreground shadow-[0_16px_34px_-14px_rgba(164,93,68,0.7)] transition-transform hover:scale-[1.02]"
            >
              Explore Hostels
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </a>
            <button
              type="button"
              onClick={openOwnerAuth}
              className="inline-flex items-center gap-2 rounded-[13px] border border-white/20 bg-white/8 px-7 py-4 font-display text-base font-bold text-background transition-transform hover:scale-[1.02]"
            >
              {ownerCtaLabel}
            </button>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <MarketingFooter />
    </div>
    </ThemeProvider>
  );
}
