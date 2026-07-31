import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Check,
  Clock,
  Mail,
  Menu,
  MessageCircle,
  Phone,
  Search,
  X,
} from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { COMPANY } from '@/content/company';
import { MarketingFooter } from './components/MarketingFooter';

/**
 * /contact — rebuilt in the marketing theme (2026-07-31) so it matches the
 * Stayo landing page instead of the legacy navy `PublicLayout` shell it used
 * to share with the single-hostel sub-pages (About/Facilities/Rooms/Gallery).
 * Same tokens, nav and footer as LandingPage/CompanyPage.
 *
 * The enquiry form deliberately has no backend: there is no contact-enquiry
 * endpoint, and the previous version silently discarded every submission
 * while telling the visitor "we'll contact you within 24 hours". It now
 * composes the enquiry into a real WhatsApp message (with an email fallback),
 * so what the page promises is what actually happens.
 *
 * All contact details come from src/content/company.ts — never hardcoded.
 */

/** Landing-page nav targets. Hash links are route-qualified so they work from here. */
const NAV_LINKS = [
  { to: '/#search', label: 'Hostels' },
  { to: '/#journey', label: 'For Owners' },
  { to: '/#why', label: 'Features' },
  { to: '/#whatis', label: 'About' },
];

const INTENTS = [
  { value: 'list', label: 'List my hostel on Stayo' },
  { value: 'stay', label: 'Find a place to stay' },
  { value: 'support', label: 'Help with my account' },
  { value: 'other', label: 'Something else' },
] as const;

const WHATSAPP_NUMBER = COMPANY.phone.replace(/\D/g, '');

const OFFICE_HOURS = [
  { days: 'Monday – Saturday', hours: '9:00 AM – 7:00 PM' },
  { days: 'Sunday', hours: '10:00 AM – 2:00 PM' },
];

export function ContactPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    intent: 'list' as (typeof INTENTS)[number]['value'],
    message: '',
  });

  useEffect(() => {
    document.title = 'Contact Us | Stayo';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        'Talk to the Stayo team — list your hostel, find a place to stay, or get help with your account. Reach us on WhatsApp, phone or email.',
      );
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `${COMPANY.website}/contact`);
  }, []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const intentLabel = INTENTS.find((i) => i.value === form.intent)?.label ?? '';

  /** The enquiry as a plain-text body, shared by the WhatsApp and email paths. */
  const composeBody = () =>
    [
      `Name: ${form.name.trim()}`,
      `Phone: ${form.phone.trim()}`,
      form.email.trim() ? `Email: ${form.email.trim()}` : null,
      `I'm here to: ${intentLabel}`,
      form.message.trim() ? `\n${form.message.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');

  const mailtoHref = () =>
    `mailto:${COMPANY.emails.contact}?subject=${encodeURIComponent(
      `Stayo enquiry — ${intentLabel}`,
    )}&body=${encodeURIComponent(composeBody())}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Opened straight from the click so the browser treats it as a user
    // gesture rather than a blocked popup.
    window.open(
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hi Stayo 👋\n\n${composeBody()}`)}`,
      '_blank',
      'noopener,noreferrer',
    );
    setSent(true);
  };

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
                <Link key={link.to} to={link.to} className="text-sm font-semibold text-foreground/80 hover:text-primary">
                  {link.label}
                </Link>
              ))}
              <span className="text-sm font-semibold text-primary">Contact</span>
              <Link to="/company" className="text-sm font-semibold text-foreground/80 hover:text-primary">
                Company
              </Link>
              <span className="h-5 w-px bg-border" />
              <Link to="/login?signin=1" className="text-sm font-semibold text-foreground/80 hover:text-primary">
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
              className="flex items-center justify-center rounded-[10px] border border-border bg-card p-2.5 md:hidden"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
          {menuOpen && (
            <div className="flex flex-col gap-1 border-y border-border bg-card px-4 py-3 md:hidden">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMenuOpen(false)}
                  className="border-b border-border/50 py-2.5 text-[15px] font-semibold text-foreground"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                to="/company"
                onClick={() => setMenuOpen(false)}
                className="border-b border-border/50 py-2.5 text-[15px] font-semibold text-foreground"
              >
                Company
              </Link>
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
        <header className="px-4 pb-10 pt-16 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">CONTACT</div>
            <h1 className="mb-5 text-balance font-display text-[clamp(32px,5vw,52px)] font-extrabold leading-[1.05] tracking-tight">
              Talk to the Stayo team
            </h1>
            <p className="mx-auto max-w-xl text-[clamp(15px,1.5vw,18px)] leading-relaxed text-muted-foreground">
              Listing a hostel, looking for a stay, or stuck on something? Reach us on WhatsApp for the fastest
              reply — we typically get back within 24 hours.
            </p>
          </div>
        </header>

        {/* ============ CHANNELS + ENQUIRY ============ */}
        <section className="px-4 pb-16 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-6 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">

            {/* ── Direct channels ── */}
            <div className="flex flex-col gap-4">
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 rounded-[22px] bg-primary p-6 text-primary-foreground shadow-[0_20px_44px_-26px_rgba(164,93,68,0.75)] transition-transform hover:-translate-y-0.5"
              >
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-primary-foreground/15">
                  <MessageCircle className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[17px] font-bold">WhatsApp us</span>
                  <span className="block text-[13.5px] text-primary-foreground/75">Fastest reply · {COMPANY.phone}</span>
                </span>
                <ArrowRight className="h-4 w-4 flex-none transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
              </a>

              <a
                href={`tel:${COMPANY.phone.replace(/\s/g, '')}`}
                className="group flex items-center gap-4 rounded-[22px] border border-border bg-card p-6 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)] transition-transform hover:-translate-y-0.5"
              >
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-secondary text-primary">
                  <Phone className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[17px] font-bold text-foreground">Call us</span>
                  <span className="block text-[13.5px] text-muted-foreground">{COMPANY.phone}</span>
                </span>
                <ArrowRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
              </a>

              <a
                href={`mailto:${COMPANY.emails.contact}`}
                className="group flex items-center gap-4 rounded-[22px] border border-border bg-card p-6 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)] transition-transform hover:-translate-y-0.5"
              >
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-secondary text-primary">
                  <Mail className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[17px] font-bold text-foreground">Email us</span>
                  <span className="block truncate text-[13.5px] text-muted-foreground">{COMPANY.emails.contact}</span>
                  <span className="block truncate text-[13.5px] text-muted-foreground">
                    {COMPANY.emails.support} · account help
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
              </a>

              {/* ── Hours + company ── */}
              <div className="rounded-[22px] border border-border bg-card p-7 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)]">
                <div className="mb-4 flex items-center gap-2 font-display text-xs font-bold tracking-[0.14em] text-primary">
                  <Clock className="h-3.5 w-3.5" strokeWidth={2.6} />
                  OFFICE HOURS
                </div>
                <div className="mb-6 space-y-1.5">
                  {OFFICE_HOURS.map((row) => (
                    <div key={row.days} className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">{row.days}</span>
                      <span className="font-semibold text-foreground">{row.hours}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-start gap-2.5 border-t border-border pt-5">
                  <Building2 className="mt-0.5 h-4 w-4 flex-none text-primary" strokeWidth={2.2} />
                  <p className="text-[13.5px] leading-relaxed text-muted-foreground">
                    <Link to="/company" className="font-semibold text-foreground hover:text-primary">
                      {COMPANY.name}
                    </Link>{' '}
                    — {COMPANY.descriptor}, operator of Stayo. Operating online across India.
                  </p>
                </div>
              </div>
            </div>

            {/* ── Enquiry form ── */}
            <div className="rounded-[22px] border border-border bg-card p-7 shadow-[0_24px_54px_-32px_rgba(47,47,47,0.32)] sm:p-8">
              {sent ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                  <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-primary">
                    <Check className="h-7 w-7" strokeWidth={2.6} />
                  </span>
                  <h2 className="mb-2 font-display text-xl font-extrabold text-foreground">WhatsApp is open</h2>
                  <p className="mb-7 max-w-[300px] text-sm leading-relaxed text-muted-foreground">
                    Your enquiry is ready in a new tab — hit send there and we'll pick it up from our side.
                  </p>
                  <div className="flex flex-col items-center gap-3">
                    <a
                      href={mailtoHref()}
                      className="inline-flex items-center gap-1.5 font-display text-sm font-bold text-primary hover:underline"
                    >
                      Didn't open? Email it instead
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
                    </a>
                    <button
                      type="button"
                      onClick={() => setSent(false)}
                      className="text-[13px] font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Back to the form
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="mb-1.5 font-display text-xl font-extrabold text-foreground">Send an enquiry</h2>
                  <p className="mb-6 text-[13.5px] leading-relaxed text-muted-foreground">
                    Fill this in and we'll open it as a WhatsApp message, ready to send.
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <Field label="Full name" htmlFor="contact-name" required>
                      <input
                        id="contact-name"
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => set('name', e.target.value)}
                        placeholder="Your full name"
                        className={inputClass}
                      />
                    </Field>

                    <Field label="Phone number" htmlFor="contact-phone" required>
                      <input
                        id="contact-phone"
                        type="tel"
                        required
                        value={form.phone}
                        onChange={(e) => set('phone', e.target.value)}
                        placeholder="+91 XXXXX XXXXX"
                        className={inputClass}
                      />
                    </Field>

                    <Field label="Email" htmlFor="contact-email" hint="optional">
                      <input
                        id="contact-email"
                        type="email"
                        value={form.email}
                        onChange={(e) => set('email', e.target.value)}
                        placeholder="your@email.com"
                        className={inputClass}
                      />
                    </Field>

                    <Field label="I'm here to" htmlFor="contact-intent">
                      <select
                        id="contact-intent"
                        value={form.intent}
                        onChange={(e) => set('intent', e.target.value as typeof form.intent)}
                        className={`${inputClass} cursor-pointer`}
                      >
                        {INTENTS.map((i) => (
                          <option key={i.value} value={i.value}>
                            {i.label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Message" htmlFor="contact-message" hint="optional">
                      <textarea
                        id="contact-message"
                        rows={4}
                        value={form.message}
                        onChange={(e) => set('message', e.target.value)}
                        placeholder="Anything you'd like us to know…"
                        className={`${inputClass} resize-y`}
                      />
                    </Field>

                    <button
                      type="submit"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-primary py-3.5 font-display text-[15px] font-bold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(164,93,68,0.65)] transition-transform hover:-translate-y-0.5 active:scale-[0.99]"
                    >
                      <MessageCircle className="h-4 w-4" strokeWidth={2.4} />
                      Send on WhatsApp
                    </button>

                    <p className="text-center text-[12.5px] text-muted-foreground">
                      Prefer email?{' '}
                      <a href={mailtoHref()} className="font-semibold text-primary hover:underline">
                        Send it to {COMPANY.emails.contact}
                      </a>
                    </p>
                  </form>
                </>
              )}
            </div>
          </div>
        </section>

        <MarketingFooter />
      </div>
    </ThemeProvider>
  );
}

const inputClass =
  'w-full rounded-[11px] border-[1.5px] border-border bg-muted px-3.5 py-2.5 text-[14.5px] font-medium text-foreground transition-colors placeholder:font-normal placeholder:text-muted-foreground focus:border-primary focus:outline-none';

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1.5 block font-display text-[10.5px] font-bold uppercase tracking-wider text-primary">
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {hint && <span className="ml-1 font-semibold normal-case tracking-normal text-muted-foreground">({hint})</span>}
      </span>
      {children}
    </label>
  );
}
