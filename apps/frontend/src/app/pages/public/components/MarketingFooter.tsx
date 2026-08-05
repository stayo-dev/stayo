import { Link } from 'react-router-dom';
import { COMPANY } from '@/content/company';
import { TrishulMark } from '@shared/ui-patterns/TrishulMark';

/**
 * The premium (marketing-theme) site footer, shared by the landing page and
 * the /company page. This is the primary place the company → product
 * relationship is stated in human-readable form: Stayo stays the visible
 * brand at the top, with a subtle Trishul Solutions lockup + the explicit
 * "developed and operated by" attribution reinforcing trust beneath it.
 *
 * Structure is driven by src/content/company.ts so a future product is a
 * one-line data change, not a layout edit.
 */

const PRODUCT_LINKS = COMPANY.products
  .filter((p) => p.status === 'flagship' && p.href)
  .map((p) => ({ label: p.name, to: p.href as string }));

const COMPANY_LINKS = [
  { label: 'About', to: '/company' },
  { label: 'Contact', to: '/contact' },
];

const LEGAL_LINKS = [
  { label: 'Privacy Policy', to: '/legal/privacy' },
  { label: 'Terms of Service', to: '/legal/terms' },
  { label: 'Cookie Policy', to: '/legal/privacy' },
];

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer id="footer" className="bg-foreground px-4 pb-8.5 pt-14 text-background sm:px-6">
      <div className="mx-auto grid max-w-5xl gap-10 [grid-template-columns:1.6fr_repeat(auto-fit,minmax(120px,1fr))]">
        {/* ── Brand block: Stayo first, Trishul lockup beneath ── */}
        <div className="min-w-[240px]">
          <div className="mb-3 font-display text-xl font-extrabold text-background">Stayo</div>
          <p className="mb-2 text-sm font-semibold text-[#D2986C]">Manage. Automate. Grow.</p>
          <p className="mb-6 max-w-[300px] text-[13.5px] leading-relaxed text-background/50">
            The Stay Operations Platform — complete hostel management, from onboarding to rent collection.
          </p>

          {/* Subtle company lockup */}
          <div className="flex items-center gap-2.5">
            <TrishulMark className="h-6 w-6 flex-none text-[#D2986C]" />
            <div className="leading-tight">
              <div className="font-display text-[13px] font-bold text-background">{COMPANY.name}</div>
              <div className="text-[11px] font-medium text-background/45">{COMPANY.descriptor}</div>
            </div>
          </div>
        </div>

        {/* ── Products ── */}
        <div>
          <div className="mb-3.5 font-display text-[13px] font-bold text-background">Products</div>
          <div className="flex flex-col gap-2.5">
            {PRODUCT_LINKS.map((l) => (
              <Link key={l.label} to={l.to} className="text-[13.5px] text-background/58 hover:text-background">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Company ── */}
        <div>
          <div className="mb-3.5 font-display text-[13px] font-bold text-background">Company</div>
          <div className="flex flex-col gap-2.5">
            {COMPANY_LINKS.map((l) => (
              <Link key={l.label} to={l.to} className="text-[13.5px] text-background/58 hover:text-background">
                {l.label}
              </Link>
            ))}
            <a
              href={`mailto:${COMPANY.emails.contact}?subject=Careers%20at%20Trishul%20Solutions`}
              className="text-[13.5px] text-background/58 hover:text-background"
            >
              Careers
            </a>
          </div>
        </div>

        {/* ── Legal ── */}
        <div>
          <div className="mb-3.5 font-display text-[13px] font-bold text-background">Legal</div>
          <div className="flex flex-col gap-2.5">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.label} to={l.to} className="text-[13.5px] text-background/58 hover:text-background">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Support ── */}
        <div>
          <div className="mb-3.5 font-display text-[13px] font-bold text-background">Support</div>
          <div className="flex flex-col gap-2.5">
            <a href={`mailto:${COMPANY.emails.contact}`} className="text-[13.5px] text-background/58 hover:text-background">
              {COMPANY.emails.contact}
            </a>
            <a href={`mailto:${COMPANY.emails.support}`} className="text-[13.5px] text-background/58 hover:text-background">
              {COMPANY.emails.support}
            </a>
          </div>
        </div>
      </div>

      {/* ── Bottom strip: attribution + copyright ── */}
      <div className="mx-auto mt-11 flex max-w-5xl flex-col gap-3 border-t border-white/10 pt-5.5 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[13px] text-background/55">{COMPANY.attribution}</span>
        <span className="text-[13px] text-background/45">© {year} {COMPANY.name}. All rights reserved.</span>
      </div>
    </footer>
  );
}
