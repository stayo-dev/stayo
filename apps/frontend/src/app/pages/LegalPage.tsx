import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  legalDocuments,
  documentIdForPath,
  documentHref,
  formatEffectiveDate,
  type LegalBlock,
  type LegalDocument,
} from '@/content/legal';
import { COMPANY } from '@/content/company';
import { MarketingLayout } from './public/components/MarketingLayout';
import {
  ArrowLeft,
  ArrowRight,
  Cookie,
  FileText,
  MonitorSmartphone,
  PhoneCall,
  RotateCcw,
  Shield,
  Trash2,
} from 'lucide-react';

const SITE = 'https://yourstayo.com';

/** Hub-card icon per document. Anything unlisted falls back to a plain page icon. */
const ICONS: Record<string, ReactNode> = {
  terms: <FileText className="h-6 w-6" />,
  privacy: <Shield className="h-6 w-6" />,
  refunds: <RotateCcw className="h-6 w-6" />,
  cookies: <Cookie className="h-6 w-6" />,
  'service-delivery': <MonitorSmartphone className="h-6 w-6" />,
  'data-deletion': <Trash2 className="h-6 w-6" />,
  contact: <PhoneCall className="h-6 w-6" />,
};

/** Keeps the <head> in step with the document on screen, for search and link previews. */
function usePageMeta(doc: LegalDocument | null) {
  useEffect(() => {
    const title = doc ? `${doc.title} | Stayo` : 'Legal & Policies | Stayo';
    const description = doc
      ? doc.metaDescription
      : 'Terms, privacy, payments and refunds, cookies, data deletion and how to reach us — every Stayo policy in one place.';
    const url = `${SITE}${doc ? documentHref(doc) : '/legal'}`;

    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);

    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', url);

    document.getElementById('legal-webpage-jsonld')?.remove();
    const ld = document.createElement('script');
    ld.id = 'legal-webpage-jsonld';
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      url,
      ...(doc && { dateModified: doc.effectiveDate }),
      publisher: { '@type': 'Organization', name: COMPANY.name, url: SITE },
    });
    document.head.appendChild(ld);

    return () => document.getElementById('legal-webpage-jsonld')?.remove();
  }, [doc]);
}

/**
 * Scrolls to a clause when the URL names one (`#clause-4-2`), otherwise to the
 * top. The previous page always scrolled to the top on load, which silently
 * defeated every deep link support might send someone.
 */
function useScrollToHash(docId: string | null) {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo(0, 0);
    }
  }, [docId, hash]);
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case 'paragraph':
      return <p className="m-0 text-[15px] leading-[1.75] text-foreground/80">{block.text}</p>;

    case 'subheading':
      return (
        <h2
          id={block.id}
          className="mt-4 scroll-mt-24 border-b border-border pb-2 font-display text-[19px] font-bold text-foreground first:mt-0"
        >
          {block.text}
        </h2>
      );

    case 'clause':
      return (
        <p id={block.id} className="m-0 scroll-mt-24 text-[15px] leading-[1.75] text-foreground/80">
          <a
            href={`#${block.id}`}
            className="mr-2 font-display text-[13px] font-bold text-primary no-underline hover:underline"
            aria-label={`Link to clause ${block.number}`}
          >
            {block.number}
          </a>
          {block.text}
        </p>
      );

    case 'notice':
      return (
        <div role="note" className="rounded-xl border border-primary/20 bg-secondary/50 px-5 py-4">
          <p className="m-0 text-[14px] font-semibold leading-relaxed text-foreground">{block.text}</p>
        </div>
      );

    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag
          className={`m-0 flex flex-col gap-2 pl-6 text-[15px] leading-[1.75] text-foreground/80 ${
            block.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ListTag>
      );
    }

    case 'definitions':
      return (
        <dl className="m-0 flex flex-col gap-3">
          {block.items.map((item, i) => (
            <div key={i} className="rounded-xl border border-border px-5 py-3.5">
              <dt className="font-display text-[14px] font-bold text-foreground">{item.term}</dt>
              <dd className="m-0 mt-1 text-[14.5px] leading-relaxed text-foreground/80">{item.definition}</dd>
            </div>
          ))}
        </dl>
      );

    case 'table':
      return (
        // Wide tables scroll inside their own box so they never widen the page on a phone.
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
            <thead className="bg-muted/40">
              <tr>
                {block.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="px-4 py-3 font-display text-[11px] font-bold uppercase tracking-wider text-primary"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-border align-top">
                  {row.map((cell, c) => (
                    <td key={c} className="px-4 py-3 leading-relaxed text-foreground/80">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'contact_list':
      return (
        <div className="overflow-hidden rounded-xl border border-border">
          {block.items.map((item, i) => (
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

    default: {
      // A new block type added to LegalBlock without a case here is a compile
      // error, not a section that silently disappears from a legal document.
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function LegalHub() {
  return (
    <MarketingLayout
      eyebrow="LEGAL"
      title="Legal & Policies"
      subtitle="How Stayo handles your money, your data and your stay — in plain terms."
    >
      <section className="px-4 pb-16 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-5 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
          {legalDocuments.map((doc) => (
            <Link
              key={doc.id}
              to={documentHref(doc)}
              className="group flex flex-col rounded-[22px] border border-border bg-card p-7 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)] transition-transform hover:-translate-y-1"
            >
              <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-primary">
                {ICONS[doc.id] ?? <FileText className="h-6 w-6" />}
              </span>
              <h2 className="mb-2 font-display text-[19px] font-bold text-foreground">{doc.title}</h2>
              <p className="mb-6 text-[13.5px] leading-relaxed text-muted-foreground">{doc.metaDescription}</p>
              <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
                <span className="text-[11.5px] font-semibold text-muted-foreground">
                  Effective {formatEffectiveDate(doc.effectiveDate)}
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
          {COMPANY.attribution} Questions about any policy? Write to{' '}
          <a href={`mailto:${COMPANY.emails.grievance}`} className="font-semibold text-primary hover:underline">
            {COMPANY.emails.grievance}
          </a>
          .
        </p>
      </section>
    </MarketingLayout>
  );
}

function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  return (
    <MarketingLayout eyebrow="LEGAL" title={doc.title} subtitle={doc.metaDescription}>
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
              Version {doc.version} · Effective {formatEffectiveDate(doc.effectiveDate)}
            </span>
          </div>

          <section
            aria-labelledby="in-short"
            className="mb-6 rounded-[22px] border border-primary/20 bg-secondary/40 p-6 sm:p-7"
          >
            <h2 id="in-short" className="m-0 mb-3 font-display text-[16px] font-bold text-foreground">
              In short
            </h2>
            <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-[14.5px] leading-relaxed text-foreground/85">
              {doc.summary.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="m-0 mt-4 text-[12px] text-muted-foreground">
              This summary is here for convenience. It does not replace the full text below, which is what applies.
            </p>
          </section>

          <div className="rounded-[22px] border border-border bg-card p-6 shadow-[0_20px_50px_-34px_rgba(47,47,47,0.28)] sm:p-9">
            <div className="flex flex-col gap-5">
              {doc.content.map((block, i) => (
                <LegalBlockView key={i} block={block} />
              ))}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-border bg-muted/40 px-5 py-4">
            <p className="m-0 text-[13px] text-muted-foreground">Questions about this policy?</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`mailto:${COMPANY.emails.grievance}`}
                className="rounded-xl border border-border bg-card px-4 py-2 font-display text-[13px] font-bold text-foreground hover:border-primary"
              >
                {COMPANY.emails.grievance}
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

export function LegalPage() {
  const { pathname } = useLocation();
  const isHub = pathname.replace(/\/$/, '') === '/legal';
  const docId = isHub ? null : documentIdForPath(pathname, legalDocuments);
  const doc = legalDocuments.find((d) => d.id === docId) ?? null;

  usePageMeta(doc);
  useScrollToHash(docId);

  if (isHub) return <LegalHub />;

  if (!doc) {
    return (
      <MarketingLayout eyebrow="LEGAL" title="Policy not found" subtitle="That policy does not exist.">
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

  return <LegalDocumentView doc={doc} />;
}
