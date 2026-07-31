import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Search, X } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { MarketingFooter } from './MarketingFooter';

/**
 * Shared shell for the Stayo-themed public pages (/contact, /legal/*), so the
 * nav and footer live in one place instead of being copied per page.
 *
 * The landing page keeps its own inline nav deliberately — it needs
 * scroll-state styling and in-page hash links this shell has no business
 * knowing about.
 */

/** Landing-page nav targets, route-qualified so they work from any page. */
const NAV_LINKS = [
  { to: '/#search', label: 'Hostels' },
  { to: '/#journey', label: 'For Owners' },
  { to: '/#why', label: 'Features' },
  { to: '/#whatis', label: 'About' },
];

interface MarketingLayoutProps {
  children: React.ReactNode;
  /** Small caps label above the title. */
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  /** Marks the matching nav item as current. */
  activeNav?: 'contact' | 'company' | null;
}

export function MarketingLayout({ children, eyebrow, title, subtitle, activeNav = null }: MarketingLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const navItem = (active: boolean) =>
    active
      ? 'text-sm font-semibold text-primary'
      : 'text-sm font-semibold text-foreground/80 hover:text-primary';

  return (
    <ThemeProvider theme="marketing">
      <div className="min-h-screen overflow-x-hidden bg-background text-foreground [background-image:linear-gradient(rgba(120,80,70,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(120,80,70,.07)_1px,transparent_1px)] [background-size:52px_52px]">

        {/* ============ NAV ============ */}
        <nav className="sticky top-0 z-[100] border-b border-border bg-background/85 backdrop-blur-lg">
          <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3.5 sm:px-6">
            <Link to="/" className="flex flex-none items-center gap-2">
              <span className="font-display text-xl font-extrabold tracking-tight text-primary">Stayo</span>
            </Link>
            <div className="flex-1" />
            <div className="hidden items-center gap-6 md:flex">
              {NAV_LINKS.map((link) => (
                <Link key={link.to} to={link.to} className={navItem(false)}>
                  {link.label}
                </Link>
              ))}
              <Link to="/contact" className={navItem(activeNav === 'contact')}>
                Contact
              </Link>
              <Link to="/company" className={navItem(activeNav === 'company')}>
                Company
              </Link>
              <span className="h-5 w-px bg-border" />
              <Link to="/login" className={navItem(false)}>
                Login
              </Link>
              <Link
                to="/#search"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4.5 py-2.5 font-display text-sm font-bold text-primary-foreground shadow-[0_8px_18px_-8px_rgba(164,93,68,0.6)] transition-transform hover:scale-[1.02]"
              >
                <Search className="h-3.5 w-3.5" strokeWidth={2.4} />
                Search Hostels
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={menuOpen}
              className="flex items-center justify-center rounded-[10px] border border-border bg-card p-2.5 md:hidden"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
          {menuOpen && (
            <div className="flex flex-col gap-1 border-y border-border bg-card px-4 py-3 md:hidden">
              {[...NAV_LINKS, { to: '/contact', label: 'Contact' }, { to: '/company', label: 'Company' }, { to: '/login', label: 'Login' }].map(
                (link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMenuOpen(false)}
                    className="border-b border-border/50 py-2.5 text-[15px] font-semibold text-foreground"
                  >
                    {link.label}
                  </Link>
                ),
              )}
              <Link
                to="/#search"
                onClick={() => setMenuOpen(false)}
                className="mt-2 rounded-xl bg-primary py-3 text-center font-display text-[15px] font-bold text-primary-foreground"
              >
                Search Hostels
              </Link>
            </div>
          )}
        </nav>

        {/* ============ HERO ============ */}
        {(title || eyebrow) && (
          <header className="px-4 pb-10 pt-16 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              {eyebrow && (
                <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">{eyebrow}</div>
              )}
              {title && (
                <h1 className="mb-5 text-balance font-display text-[clamp(32px,5vw,52px)] font-extrabold leading-[1.05] tracking-tight">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="mx-auto max-w-xl text-[clamp(15px,1.5vw,18px)] leading-relaxed text-muted-foreground">
                  {subtitle}
                </p>
              )}
            </div>
          </header>
        )}

        <main>{children}</main>

        <MarketingFooter />
      </div>
    </ThemeProvider>
  );
}
