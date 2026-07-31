import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { legalSections } from '../../content/legal';
import { COMPANY } from '@/content/company';
import { MarketingLayout } from './public/components/MarketingLayout';
import { ArrowLeft, ArrowRight, FileText, Shield, RotateCcw, Truck, PhoneCall, Trash2 } from 'lucide-react';

export function LegalPage() {
  const { pathname } = useLocation();

  // Determine current policy view
  let activeSectionId = '';
  let isHub = false;

  if (pathname === '/legal/terms' || pathname === '/terms') {
    activeSectionId = 'terms';
  } else if (pathname === '/legal/privacy' || pathname === '/privacy') {
    activeSectionId = 'privacy';
  } else if (pathname === '/legal/refund-policy' || pathname === '/refund-policy') {
    activeSectionId = 'refund';
  } else if (pathname === '/legal/shipping-policy' || pathname === '/shipping-policy') {
    activeSectionId = 'shipping';
  } else if (pathname === '/legal/contact') {
    activeSectionId = 'contact';
  } else if (pathname === '/legal/data-deletion') {
    activeSectionId = 'data-deletion';
  } else {
    isHub = true;
  }

  useEffect(() => {
    // Dynamic SEO titles, meta descriptions, and canonical links
    let pageTitle = "Legal & Policies | Stayo";
    let metaDescription = "Legal policies, terms and conditions, privacy policy, and refund rules for Stayo.";
    let canonicalUrl = "https://yourstayo.com/legal";

    if (activeSectionId === 'terms') {
      pageTitle = "Terms & Conditions | Stayo";
      metaDescription = "Read the Terms & Conditions for utilizing Stayo platform and accommodation services.";
      canonicalUrl = "https://yourstayo.com/legal/terms";
    } else if (activeSectionId === 'privacy') {
      pageTitle = "Privacy Policy | Stayo";
      metaDescription = "Privacy Policy for Stayo. Learn how we collect, process, and protect tenant and payment data.";
      canonicalUrl = "https://yourstayo.com/legal/privacy";
    } else if (activeSectionId === 'refund') {
      pageTitle = "Refund & Cancellation Policy | Stayo";
      metaDescription = "Official Refund and Cancellation Policy for Stayo bookings and rent payments.";
      canonicalUrl = "https://yourstayo.com/legal/refund-policy";
    } else if (activeSectionId === 'shipping') {
      pageTitle = "Shipping & Delivery Policy | Stayo";
      metaDescription = "Shipping and Delivery Policy for Stayo digital receipts and online accommodation services.";
      canonicalUrl = "https://yourstayo.com/legal/shipping-policy";
    } else if (activeSectionId === 'contact') {
      pageTitle = "Contact Us | Stayo";
      metaDescription = "Get in touch with Stayo for customer support, payment inquiries, and grievance redressal.";
      canonicalUrl = "https://yourstayo.com/legal/contact";
    } else if (activeSectionId === 'data-deletion') {
      pageTitle = "Data Deletion Instructions | Stayo";
      metaDescription = "Instructions on requesting account deletion and personal data removal from Stayo.";
      canonicalUrl = "https://yourstayo.com/legal/data-deletion";
    }

    document.title = pageTitle;

    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.setAttribute('content', metaDescription);

    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalUrl);

    // Set OpenGraph tags
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', pageTitle);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', metaDescription);
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);

    // Dynamic WebPage Schema (JSON-LD)
    let ldJsonScript = document.getElementById('legal-webpage-jsonld');
    if (ldJsonScript) ldJsonScript.remove();

    ldJsonScript = document.createElement('script');
    ldJsonScript.setAttribute('id', 'legal-webpage-jsonld');
    ldJsonScript.setAttribute('type', 'application/ld+json');
    ldJsonScript.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": pageTitle,
      "description": metaDescription,
      "url": canonicalUrl,
      "publisher": {
        "@type": "Organization",
        "name": "Trishul Solutions",
        "url": "https://yourstayo.com"
      }
    });
    document.head.appendChild(ldJsonScript);

    // Scroll to top when view changes
    window.scrollTo(0, 0);

    return () => {
      const script = document.getElementById('legal-webpage-jsonld');
      if (script) script.remove();
    };
  }, [activeSectionId]);

  // Card definitions for the hub page
  const hubCards = [
    {
      title: "Terms & Conditions",
      description: "Rules governing platform usage, tenant responsibilities, payment obligations, and governing law.",
      to: "/legal/terms",
      lastUpdated: "June 2026",
      icon: <FileText className="w-6 h-6" />,
    },
    {
      title: "Privacy Policy",
      description: "Details regarding personal data collection, Razorpay payment processing, cookies, security, and user rights.",
      to: "/legal/privacy",
      lastUpdated: "June 2026",
      icon: <Shield className="w-6 h-6" />,
    },
    {
      title: "Refund & Cancellation Policy",
      description: "Policies on fee payments, rent, security deposits, duplicate transactions, and processing windows.",
      to: "/legal/refund-policy",
      lastUpdated: "June 2026",
      icon: <RotateCcw className="w-6 h-6" />,
    },
    {
      title: "Shipping & Delivery Policy",
      description: "Details on digital delivery of confirmations, fee receipts, and onboarding verification services.",
      to: "/legal/shipping-policy",
      lastUpdated: "June 2026",
      icon: <Truck className="w-6 h-6" />,
    },
    {
      title: "Contact Us",
      description: "Official support and grievance officer contacts, business address, and helpline details for payment queries.",
      to: "/legal/contact",
      lastUpdated: "June 2026",
      icon: <PhoneCall className="w-6 h-6" />,
    },
    {
      title: "Data Deletion instructions",
      description: "Steps for self-service or assisted account deletion, data retention limits, and exceptions under local law.",
      to: "/legal/data-deletion",
      lastUpdated: "June 2026",
      icon: <Trash2 className="w-6 h-6" />,
    },
  ];

  if (isHub) {
    return (
      <MarketingLayout
        eyebrow="LEGAL"
        title="Legal & Policies"
        subtitle="How Stayo handles your money, your data and your stay — in plain terms."
      >
        <section className="px-4 pb-16 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-5 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {hubCards.map((card) => (
              <Link
                key={card.to}
                to={card.to}
                className="group flex flex-col rounded-[22px] border border-border bg-card p-7 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)] transition-transform hover:-translate-y-1"
              >
                <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-primary">
                  {card.icon}
                </span>
                <h2 className="mb-2 font-display text-[19px] font-bold text-foreground">{card.title}</h2>
                <p className="mb-6 text-[13.5px] leading-relaxed text-muted-foreground">{card.description}</p>
                <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
                  <span className="text-[11.5px] font-semibold text-muted-foreground">
                    Updated {card.lastUpdated}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-display text-[13px] font-bold text-primary">
                    Read
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <p className="mx-auto mt-10 max-w-2xl text-center text-[12.5px] leading-relaxed text-muted-foreground">
            Stayo is operated by {COMPANY.name}. Questions about any policy? Reach us at{' '}
            <a href={`mailto:${COMPANY.emails.legal}`} className="font-semibold text-primary hover:underline">
              {COMPANY.emails.legal}
            </a>
            .
          </p>
        </section>
      </MarketingLayout>
    );
  }

  const section = legalSections.find((s) => s.id === activeSectionId);

  if (!section) {
    return (
      <MarketingLayout eyebrow="LEGAL" title="Policy not found" subtitle="That policy section doesn't exist.">
        <div className="px-4 pb-20 text-center sm:px-6">
          <Link
            to="/legal"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-display text-sm font-bold text-primary-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.4} />
            Back to Legal & Policies
          </Link>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout eyebrow="LEGAL" title={section.title} subtitle={section.subtitle}>
      <article className="px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <Link
              to="/legal"
              className="inline-flex items-center gap-1.5 font-display text-[13px] font-bold text-primary hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
              All policies
            </Link>
            <span className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Updated {section.lastUpdated}
            </span>
          </div>

          <div className="rounded-[22px] border border-border bg-card p-6 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)] sm:p-9">
            <div className="flex flex-col gap-5">
              {section.content.map((block: any, idx: number) => {
                switch (block.type) {
                  case 'subheading':
                    return (
                      <h2
                        key={idx}
                        className="mt-3 border-b border-border pb-2 font-display text-[19px] font-bold text-foreground first:mt-0"
                      >
                        {block.text}
                      </h2>
                    );
                  case 'notice':
                    return (
                      <div key={idx} role="note" className="rounded-xl border border-primary/20 bg-secondary/50 px-5 py-4">
                        <p className="m-0 text-[14px] font-semibold leading-relaxed text-foreground">{block.text}</p>
                      </div>
                    );
                  case 'contact_list':
                    return (
                      <div key={idx} className="overflow-hidden rounded-xl border border-border">
                        {block.items.map((item: any, i: number) => (
                          <div
                            key={i}
                            className={`flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-6 ${
                              i % 2 === 0 ? 'bg-muted/40' : ''
                            }`}
                          >
                            <span className="w-40 shrink-0 font-display text-[10.5px] font-bold uppercase tracking-wider text-primary">
                              {item.label}
                            </span>
                            <span className="break-words text-[14px] font-semibold text-foreground">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  default:
                    return (
                      <p key={idx} className="m-0 text-[15px] leading-[1.75] text-foreground/80">
                        {block.text}
                      </p>
                    );
                }
              })}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-border bg-muted/40 px-5 py-4">
            <p className="m-0 text-[13px] text-muted-foreground">
              Questions about this policy? We usually reply within 24 hours.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`mailto:${COMPANY.emails.legal}`}
                className="rounded-xl border border-border bg-card px-4 py-2 font-display text-[13px] font-bold text-foreground hover:border-primary"
              >
                {COMPANY.emails.legal}
              </a>
              <a
                href={`tel:${COMPANY.phone.replace(/\s/g, '')}`}
                className="rounded-xl bg-primary px-4 py-2 font-display text-[13px] font-bold text-primary-foreground"
              >
                Call {COMPANY.phone}
              </a>
            </div>
          </div>
        </div>
      </article>
    </MarketingLayout>
  );
}
