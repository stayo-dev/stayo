import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { COMPANY } from '@/content/company';
import { TrishulMark } from '@shared/ui-patterns/TrishulMark';
import { MarketingFooter } from './components/MarketingFooter';

/**
 * /company — introduces Trishul Solutions (the operating company) and frames
 * Stayo as its flagship product. Built in the marketing theme so it matches
 * the premium Stayo landing exactly (same tokens, font-display, card/shadow
 * language) — this is the company-identity layer, not a redesign.
 *
 * Content is driven by src/content/company.ts, so adding a future product is
 * a data change here, not a layout change.
 */
export function CompanyPage() {
  useEffect(() => {
    document.title = 'Trishul Solutions | The company behind Stayo';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        'Trishul Solutions is an AI software company. Stayo, an AI-powered hostel management platform, is its flagship product.',
      );
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `${COMPANY.website}/company`);
  }, []);

  return (
    <ThemeProvider theme="marketing">
      <div className="min-h-screen overflow-x-hidden bg-background text-foreground [background-image:linear-gradient(rgba(120,80,70,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(120,80,70,.07)_1px,transparent_1px)] [background-size:52px_52px]">

        {/* ============ NAV ============ */}
        <nav className="sticky top-0 z-[100] border-b border-border bg-background/85 backdrop-blur-lg">
          <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3.5 sm:px-6">
            <Link to="/" className="flex flex-none items-center gap-2">
              <span className="font-display text-xl font-extrabold tracking-tight text-primary">Stayo</span>
              <span className="hidden text-[12px] font-semibold text-muted-foreground sm:inline">
                by {COMPANY.name}
              </span>
            </Link>
            <div className="flex-1" />
            <div className="flex items-center gap-5">
              <Link to="/contact" className="hidden text-sm font-semibold text-foreground/80 hover:text-primary sm:block">
                Contact
              </Link>
              <Link
                to="/owners"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4.5 py-2.5 font-display text-sm font-bold text-primary-foreground shadow-[0_8px_18px_-8px_rgba(164,93,68,0.6)] transition-transform hover:scale-[1.02]"
              >
                Explore Stayo
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
              </Link>
            </div>
          </div>
        </nav>

        {/* ============ HERO ============ */}
        <header className="px-4 pb-14 pt-20 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-7 inline-flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-3.5 shadow-[0_10px_30px_-20px_rgba(47,47,47,0.4)]">
              <TrishulMark className="h-9 w-9 flex-none text-primary" />
              <div className="text-left leading-tight">
                <div className="font-display text-lg font-extrabold tracking-tight text-foreground">{COMPANY.name}</div>
                <div className="text-[12px] font-semibold tracking-wide text-muted-foreground">{COMPANY.descriptor}</div>
              </div>
            </div>
            <h1 className="mb-5 text-balance font-display text-[clamp(34px,5vw,56px)] font-extrabold leading-[1.05] tracking-tight">
              We build software that makes operations effortless.
            </h1>
            <p className="mx-auto mb-2 max-w-xl text-[clamp(15px,1.5vw,18px)] leading-relaxed text-muted-foreground">
              {COMPANY.name} is an AI software company. <b className="text-foreground">Stayo</b> — our hostel management
              platform — is our flagship product.
            </p>
            <p className="font-display text-sm font-bold tracking-[0.14em] text-primary">{COMPANY.tagline}</p>
          </div>
        </header>

        {/* ============ MISSION + VISION ============ */}
        <section className="px-4 py-8 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-6 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
            <div className="rounded-[22px] border border-border bg-card p-8 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)]">
              <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">MISSION</div>
              <p className="text-[17px] leading-relaxed text-foreground/90">{COMPANY.mission}</p>
            </div>
            <div className="rounded-[22px] bg-foreground p-8 shadow-[0_24px_54px_-30px_rgba(47,47,47,0.5)]">
              <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-[#D2986C]">VISION</div>
              <p className="text-[17px] leading-relaxed text-background/90">{COMPANY.vision}</p>
            </div>
          </div>
        </section>

        {/* ============ CORE PRINCIPLES ============ */}
        <section className="px-4 py-14 sm:px-6">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">CORE PRINCIPLES</div>
            <h2 className="text-balance font-display text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.1] tracking-tight">
              Three strokes, one point
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Our mark is three strokes rising from a single origin — the principles every product we ship is held to.
            </p>
          </div>
          <div className="mx-auto grid max-w-5xl gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            {COMPANY.principles.map((p) => (
              <div
                key={p.title}
                className="rounded-[20px] border border-border bg-card p-7 shadow-[0_24px_48px_-28px_rgba(47,47,47,0.34)]"
              >
                <TrishulMark className="mb-5 h-8 w-8 text-primary" />
                <h3 className="mb-2 font-display text-xl font-bold text-foreground">{p.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ============ PRODUCTS ============ */}
        <section className="px-4 py-8 sm:px-6">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <div className="mb-3.5 font-display text-xs font-bold tracking-[0.14em] text-primary">PRODUCTS</div>
            <h2 className="text-balance font-display text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.1] tracking-tight">
              One company, a growing family of products
            </h2>
          </div>
          <div className="mx-auto grid max-w-5xl gap-6 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
            {COMPANY.products.map((product) => {
              const isFlagship = product.status === 'flagship';
              const card = (
                <div
                  className={`flex h-full flex-col rounded-[24px] p-8 transition-transform ${
                    isFlagship
                      ? 'border border-primary/15 bg-gradient-to-br from-[#FBF3EA] to-[#F3E4D5] hover:-translate-y-1 hover:shadow-[0_34px_64px_-30px_rgba(164,93,68,0.42)]'
                      : 'border border-dashed border-border bg-card/60'
                  }`}
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span
                      className={`font-display text-2xl font-extrabold tracking-tight ${
                        isFlagship ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {product.name}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 font-display text-[10px] font-bold tracking-wide ${
                        isFlagship ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'
                      }`}
                    >
                      {product.statusLabel}
                    </span>
                  </div>
                  <div className="mb-3 text-[13px] font-bold uppercase tracking-wide text-primary">{product.tagline}</div>
                  <p className={`mb-6 text-[14.5px] leading-relaxed ${isFlagship ? 'text-foreground/75' : 'text-muted-foreground'}`}>
                    {product.description}
                  </p>
                  {isFlagship && product.href && (
                    <span className="mt-auto inline-flex items-center gap-1.5 font-display text-[15px] font-bold text-primary">
                      Visit Stayo
                      <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
                    </span>
                  )}
                </div>
              );
              return isFlagship && product.href ? (
                <Link key={product.name} to={product.href} className="no-underline">
                  {card}
                </Link>
              ) : (
                <div key={product.name}>{card}</div>
              );
            })}
          </div>
        </section>

        {/* ============ ATTRIBUTION BAND ============ */}
        <section className="px-4 py-14 sm:px-6">
          <div className="mx-auto max-w-4xl rounded-[26px] bg-primary px-8 py-12 text-center sm:px-14">
            <TrishulMark className="mx-auto mb-5 h-10 w-10 text-primary-foreground" />
            <p className="mx-auto max-w-2xl text-balance font-display text-[clamp(20px,2.6vw,30px)] font-extrabold leading-[1.2] text-primary-foreground">
              {COMPANY.attribution}
            </p>
          </div>
        </section>

        <MarketingFooter />
      </div>
    </ThemeProvider>
  );
}
