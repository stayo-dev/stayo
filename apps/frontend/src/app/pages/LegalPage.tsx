import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { legalSections } from '../../content/legal';
import { PublicLayout } from './public/PublicLayout';
import { FileText, Shield, RotateCcw, Truck, PhoneCall, Trash2 } from 'lucide-react';

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
      <PublicLayout title="Legal & Policies" subtitle="Our commitment to transparency, privacy, and security.">
        <section className="max-w-4xl mx-auto px-6 py-16">
          <div className="grid gap-6 sm:grid-cols-2">
            {hubCards.map((card) => (
              <Link
                key={card.to}
                to={card.to}
                className="block p-7 bg-white rounded-2xl border border-slate-100 hover:border-slate-200 shadow-sm hover:shadow transition no-underline text-slate-700 hover:translate-y-[-2px] duration-200"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-[#1B2D5B]/10 text-[#1B2D5B] rounded-xl">
                    {card.icon}
                  </div>
                  <h3 className="font-extrabold text-[#1B2D5B] text-lg m-0" style={{ fontFamily: 'var(--font-display)' }}>
                    {card.title}
                  </h3>
                </div>
                <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                  {card.description}
                </p>
                <div className="flex items-center justify-between text-xs font-semibold pt-2 border-t border-slate-50">
                  <span className="text-slate-400">Last updated: {card.lastUpdated}</span>
                  <span className="text-[#F07B1D]">Read Policy &rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </PublicLayout>
    );
  }

  const section = legalSections.find((s) => s.id === activeSectionId);

  if (!section) {
    return (
      <PublicLayout title="Not Found" subtitle="Requested policy section does not exist.">
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <Link to="/legal" className="no-underline font-bold text-sm px-6 py-3 rounded-lg text-white" style={{ background: '#1B2D5B' }}>
            Back to Legal Hub
          </Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={section.title} subtitle={section.subtitle}>
      <article className="max-w-3xl mx-auto px-6 py-16">
        <Link
          to="/legal"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#1B2D5B] hover:text-[#F07B1D] no-underline mb-10 transition-colors"
        >
          &larr; Back to Legal Hub
        </Link>

        <div className="pb-6 mb-10 border-b border-slate-200 flex flex-wrap justify-between items-center gap-4">
          <h2 className="text-2xl font-bold text-slate-800 m-0" style={{ fontFamily: 'var(--font-display)' }}>
            Official Policy
          </h2>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-3 py-1.5 rounded-full">
            Last updated: {section.lastUpdated}
          </span>
        </div>

        <div className="space-y-6">
          {section.content.map((block: any, idx: number) => {
            switch (block.type) {
              case 'subheading':
                return (
                  <h3 key={idx} className="text-lg font-bold text-slate-800 pt-6 pb-2 border-b border-slate-100">
                    {block.text}
                  </h3>
                );
              case 'notice':
                return (
                  <div key={idx} role="note" className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-5">
                    <p className="text-sm font-medium text-amber-800 leading-relaxed m-0">
                      {block.text}
                    </p>
                  </div>
                );
              case 'contact_list':
                return (
                  <div key={idx} className="mt-4 rounded-xl border border-slate-100 overflow-hidden shadow-sm">
                    {block.items.map((item: any, i: number) => (
                      <div
                        key={i}
                        className={`flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-6 py-4 ${
                          i % 2 === 0 ? 'bg-slate-50/50' : 'bg-transparent'
                        }`}
                      >
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider w-36 shrink-0">
                          {item.label}
                        </span>
                        <span className="font-semibold text-slate-700 break-words">{item.value}</span>
                      </div>
                    ))}
                  </div>
                );
              default:
                return (
                  <p key={idx} className="text-slate-600 leading-relaxed text-[0.95rem] m-0">
                    {block.text}
                  </p>
                );
            }
          })}
        </div>

        <div className="mt-16 pt-10 border-t border-slate-100 flex flex-wrap gap-4 justify-between items-center">
          <Link to="/legal" className="no-underline font-semibold text-sm px-6 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">
            Other Policies
          </Link>
          <a href="tel:9392433422" className="no-underline font-semibold text-sm px-6 py-2.5 rounded-lg text-white transition-colors hover:opacity-90" style={{ background: '#1B2D5B' }}>
            Call Support
          </a>
        </div>
      </article>
    </PublicLayout>
  );
}
