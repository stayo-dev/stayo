import { Home, Phone, MessageCircle, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

const NAV_LINKS = [
  { to: '/about', label: 'About' },
  { to: '/facilities', label: 'Facilities' },
  { to: '/rooms', label: 'Rooms' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/contact', label: 'Contact' },
  { to: '/company', label: 'Company' },
];

interface PublicLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

/** Shared header/footer layout for all public hostel sub-pages. */
export function PublicLayout({ children, title, subtitle }: PublicLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: 'var(--font-body)', background: '#FFFDF5' }}>

      {/* ── Top contact bar ────────────────────────────────────────────── */}
      <div className="bg-[#1B2D5B] text-white py-2 px-4 text-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center md:justify-between gap-4">
          <div className="flex items-center gap-6">
            <a href="tel:+917675080090" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Phone className="w-4 h-4" />
              <span>+91 76750 80090</span>
            </a>
          </div>
          <a
            href="https://wa.me/917675080090"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <MessageCircle className="w-4 h-4" />
            <span>WhatsApp Us</span>
          </a>
        </div>
      </div>

      {/* ── Sticky Nav ─────────────────────────────────────────────────── */}
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 no-underline">
            <div className="w-10 h-10 bg-[#F07B1D] rounded-full flex items-center justify-center">
              <Home className="w-5 h-5 text-white" />
            </div>
            <span
              className="text-lg font-semibold text-[#1B2D5B]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Stayo
            </span>
          </Link>

          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map(l => (
              <Link
                key={l.to}
                to={l.to}
                className="text-[#2C2C2A] hover:text-[#F07B1D] no-underline text-sm font-medium transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <Link
            to="/login?signin=1"
            className="no-underline font-semibold text-sm px-5 py-2 rounded-lg transition-colors hover:bg-[#d96e18]"
            style={{ background: '#F07B1D', color: '#fff' }}
          >
            Tenant Login
          </Link>
        </div>
      </header>

      {/* ── Page Hero ──────────────────────────────────────────────────── */}
      {(title || subtitle) && (
        <div
          className="text-white text-center py-14 px-6"
          style={{ background: 'linear-gradient(135deg, #1B2D5B 0%, #2d5a96 100%)' }}
        >
          <div className="max-w-2xl mx-auto">
            {title && (
              <h1
                className="font-bold tracking-tight mb-3"
                style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontFamily: 'var(--font-display)' }}
              >
                {title}
              </h1>
            )}
            {subtitle && <p className="text-white/80 text-lg m-0">{subtitle}</p>}
          </div>
        </div>
      )}

      {/* ── Page Content ───────────────────────────────────────────────── */}
      <main className="flex-1">{children}</main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="bg-[#1B2D5B] text-white py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-[#F07B1D] rounded-full flex items-center justify-center">
                  <Home className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                  Stayo
                </span>
              </div>
              <p className="text-white/80 text-sm">
                The Stay Operations Platform — a verified hostel marketplace and complete
                management system in one.
              </p>
              <p className="text-white/50 text-xs mt-4">
                Stayo is developed and operated by{' '}
                <Link to="/company" className="text-white/70 hover:text-white no-underline font-semibold">
                  Trishul Solutions
                </Link>
                .
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Quick Links</h4>
              <nav aria-label="Footer navigation" className="space-y-2">
                {NAV_LINKS.map(l => (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="block text-white/80 hover:text-white no-underline transition-colors text-sm"
                  >
                    {l.label}
                  </Link>
                ))}
                <Link to="/legal" className="block text-white/80 hover:text-white no-underline transition-colors text-sm font-semibold">
                  Legal Hub
                </Link>
                <Link to="/legal/terms" className="block text-white/60 hover:text-white no-underline transition-colors text-sm pl-2">
                  &bull; Terms &amp; Conditions
                </Link>
                <Link to="/legal/privacy" className="block text-white/60 hover:text-white no-underline transition-colors text-sm pl-2">
                  &bull; Privacy Policy
                </Link>
                <Link to="/legal/refund-policy" className="block text-white/60 hover:text-white no-underline transition-colors text-sm pl-2">
                  &bull; Refund &amp; Cancellation
                </Link>
                <Link to="/legal/shipping-policy" className="block text-white/60 hover:text-white no-underline transition-colors text-sm pl-2">
                  &bull; Shipping &amp; Delivery
                </Link>
              </nav>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Contact Us</h4>
              <div className="space-y-3 text-sm">
                <a href="tel:+917675080090" className="flex items-center gap-2 text-white/80 hover:text-white transition-colors">
                  <Phone className="w-4 h-4" />
                  <span>+91 76750 80090</span>
                </a>
                <a
                  href="https://wa.me/917675080090"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>WhatsApp</span>
                </a>
                <a href="mailto:contact@yourstayo.com" className="flex items-center gap-2 text-white/80 hover:text-white transition-colors">
                  <Mail className="w-4 h-4" />
                  <span>contact@yourstayo.com</span>
                </a>
              </div>
            </div>
          </div>

          <div className="border-t border-white/20 pt-8 flex flex-wrap items-center justify-between gap-4 text-sm text-white/60">
            <p className="m-0">&copy; {new Date().getFullYear()} Trishul Solutions. All rights reserved.</p>
            <Link to="/login?signin=1" className="text-white/60 hover:text-white no-underline transition-colors">
              Tenant Login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
