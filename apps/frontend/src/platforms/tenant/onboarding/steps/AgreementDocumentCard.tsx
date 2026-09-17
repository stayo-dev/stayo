import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, FileText, ChevronRight } from 'lucide-react';
import {
  agreementDocumentKeys,
  fetchActivationAgreementDocument,
} from '@features/agreements/document/agreementDocumentApi';
import {
  clauseCount,
  highlightTitles,
  sectionIndex,
} from '@features/agreements/document/documentReading';
import { useFieldGuidance } from '../guidance/Guidance';
import { GuidanceNote } from '../guidance/Guidance';

/**
 * The agreement, described honestly and opened.
 *
 * Every figure here is counted from the real document — never a hardcoded
 * number, because the screen this replaces printed section headings ("1.",
 * "6.") for a document that did not exist and clauses the owner never wrote.
 *
 * The card loads the document so the counts and highlights are real, and the
 * reader opens instantly from cache rather than showing a second spinner.
 */
export function AgreementDocumentCard({
  token,
  hostelName,
  readCompletedAt,
  facts,
}: {
  token: string;
  hostelName: string;
  readCompletedAt: string | null;
  facts: Array<{ k: string; v: string }>;
}) {
  const guide = useFieldGuidance('agreement_document');

  const { data: doc, isLoading } = useQuery({
    queryKey: agreementDocumentKeys.activation(token),
    queryFn: () => fetchActivationAgreementDocument(token),
    enabled: Boolean(token),
  });

  const sections = sectionIndex(doc);
  const clauses = clauseCount(doc);
  const highlights = highlightTitles(doc);
  const read = Boolean(readCompletedAt);

  return (
    <div ref={guide.ref} className={guide.className}>
      <div className="mt-[15px] overflow-hidden rounded-[14px] border border-border bg-card">
        <div className="flex items-start gap-3 px-4 pt-4">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-secondary text-primary">
            <FileText className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[14.5px] font-extrabold text-foreground">
              Hostel Accommodation Agreement
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              {hostelName}
              {doc ? ` · Version ${doc.meta.versionNumber}` : ''}
            </div>
            <div className="mt-1 text-[11.5px] font-semibold text-foreground/70">
              {isLoading
                ? 'Loading your agreement…'
                : sections.length > 0
                  ? `${sections.length} section${sections.length === 1 ? '' : 's'} · ${clauses} clause${clauses === 1 ? '' : 's'}`
                  : 'Your agreement is ready to read'}
            </div>
          </div>
        </div>

        {/* The owner's own key terms, surfaced before the tenant opens it. */}
        {highlights.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 px-4">
            {highlights.map((title) => (
              <span
                key={title}
                className="rounded-full bg-[color:var(--warning)]/12 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--warning)]"
              >
                {title}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 bg-secondary/40 px-4 py-3">
          {facts.map((f) => (
            <div key={f.k} className="text-[11.5px] leading-snug text-muted-foreground">
              {f.k}: <b className="text-foreground">{f.v}</b>
            </div>
          ))}
        </div>

        {read ? (
          <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3 text-[12.5px] font-semibold text-[color:var(--success)]">
            <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-[color:var(--success)]">
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </span>
            You&apos;ve read this agreement
            <Link
              to={`/activate/agreement?token=${encodeURIComponent(token)}`}
              className="ml-auto text-[12px] font-semibold text-primary underline underline-offset-2"
            >
              Read again
            </Link>
          </div>
        ) : (
          <Link
            to={`/activate/agreement?token=${encodeURIComponent(token)}`}
            className="flex items-center gap-2 border-t border-border/60 bg-primary/5 px-4 py-3.5 text-[13.5px] font-bold text-primary"
            {...guide.aria}
          >
            Read the full agreement
            <ChevronRight className="ml-auto h-4 w-4 flex-none" strokeWidth={2.4} />
          </Link>
        )}
      </div>
      <GuidanceNote field="agreement_document" />
    </div>
  );
}
