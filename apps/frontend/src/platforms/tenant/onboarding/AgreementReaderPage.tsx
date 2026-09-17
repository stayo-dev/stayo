import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import { AgreementDocumentView } from '@features/agreements/document/AgreementDocumentView';
import {
  agreementDocumentKeys,
  fetchActivationAgreementDocument,
  recordAgreementRead,
} from '@features/agreements/document/agreementDocumentApi';
import { isReadComplete, readProgress } from '@features/agreements/document/documentReading';

/**
 * The agreement, read in full before it is signed.
 *
 * This screen exists because the signing step used to show a hardcoded
 * document — section 1, then a jump to a fabricated "6. Management Rights" —
 * containing none of the owner's actual clauses, and the real PDF was not
 * generated until *after* the signature was captured. There was, literally,
 * nothing to read.
 *
 * A full screen rather than a modal or an inline box: a contract is read by
 * scrolling one column, and nesting that inside a step's own scroll container
 * is what made the old screen feel like it had no document in it.
 *
 * The read is recorded server-side at both ends — opened, and finished — so a
 * reload cannot skip the gate and the evidence outlives the session.
 */
export function AgreementReaderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const completedRef = useRef(false);
  const openedRef = useRef(false);

  const { data: doc, isLoading, isError } = useQuery({
    queryKey: agreementDocumentKeys.activation(token),
    queryFn: () => fetchActivationAgreementDocument(token),
    enabled: Boolean(token),
  });

  // Fire-and-forget: a failure to record the open must not block reading. The
  // completion record is the one that gates signing, and it is retried by the
  // act of reaching the end again.
  useEffect(() => {
    if (!doc || !token || openedRef.current) return;
    openedRef.current = true;
    void recordAgreementRead(token, 'opened', doc.contentHash).catch(() => {});
  }, [doc, token]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !doc) return;

    const next = readProgress(el.scrollTop, el.scrollHeight, el.clientHeight);
    setProgress(next);

    if (isReadComplete(next) && !completedRef.current) {
      completedRef.current = true;
      void recordAgreementRead(token, 'completed', doc.contentHash).catch(() => {
        // Let them try again by scrolling away and back, rather than silently
        // marking a read we never managed to record.
        completedRef.current = false;
      });
    }
  }, [doc, token]);

  // A document shorter than the viewport never fires a scroll event, so the
  // gate would never open. Measure once the content is laid out.
  useEffect(() => {
    if (doc) handleScroll();
  }, [doc, handleScroll]);

  const done = isReadComplete(progress);
  const percent = Math.round(progress * 100);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex-none border-b border-border bg-card px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back to signing"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold text-foreground">Your agreement</div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              {doc ? `${doc.meta.hostelName} · Version ${doc.meta.versionNumber}` : 'Loading…'}
            </div>
          </div>
        </div>
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150"
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Reading progress"
          />
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {isLoading && <div className="mx-auto h-72 w-full max-w-[68ch] animate-pulse rounded-2xl bg-muted" />}

        {isError && (
          <p className="mx-auto max-w-[68ch] rounded-xl border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
            We couldn&apos;t load your agreement. Check your connection and try again.
          </p>
        )}

        {doc && <AgreementDocumentView doc={doc} />}
      </div>

      <footer className="flex-none border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {done ? (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-primary py-3 text-[14px] font-bold text-primary-foreground"
          >
            <Check className="h-4 w-4" strokeWidth={2.4} />
            I&apos;ve read it — continue to sign
          </button>
        ) : (
          <p className="py-1 text-center text-[12.5px] font-medium text-muted-foreground">
            Scroll to the end to continue · {percent}%
          </p>
        )}
      </footer>
    </div>
  );
}
