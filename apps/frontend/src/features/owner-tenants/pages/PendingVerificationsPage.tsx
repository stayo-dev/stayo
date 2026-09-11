import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ShieldCheck, X } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { usePendingVerifications } from '../hooks/usePendingVerifications';
import { useDocumentVerification } from '../hooks/useDocumentVerification';
import { RejectDocumentSheet } from '../documents/RejectDocumentSheet';
import { DocumentDecisionBar } from '../documents/DocumentDecisionBar';
import { documentTypeLabel } from '../documents/kycDocuments';
import { currentItem, flattenQueue, queueProgress, upNext, type QueueItem } from '../documents/reviewQueue';
import { DocumentPreviewPane } from '../profile/DocumentPreviewPane';
import { APP_SURFACE } from '@shared/ui/surface';

function waitedFor(iso: string | null) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Uploaded today';
  if (days === 1) return 'Waiting 1 day';
  return `Waiting ${days} days`;
}

/**
 * Reviewing tenants' KYC uploads — reached from Alerts › Documents, the Home
 * dashboard's "Verify pending KYC" card, and a tenant's own profile.
 *
 * Built as a review, not a list. One document fills the screen with whose it
 * is above it, Reject / Approve sit in a sticky bar in thumb reach, and the
 * moment a decision lands the next document is on screen (see reviewQueue.ts).
 * An owner clearing twenty uploads does twenty decisions, not forty taps.
 *
 * Mobile first. The preview is full-width and opens full-screen on tap,
 * because a name or an Aadhaar number has to actually be read before it is
 * approved — the old version only offered "View" in a new tab. On a wide
 * screen the same column is simply centred.
 *
 * There is deliberately no "approve all": the point of the screen is that the
 * owner looked at each document before saying yes to it.
 */
export function PendingVerificationsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusTenantId = searchParams.get('tenantId');

  const { groups, isLoading, isError, refetch } = usePendingVerifications();
  const verification = useDocumentVerification(undefined);

  // Decided in this session — the queue advances off this, not the refetch.
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<QueueItem | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: 'approve' | 'reject' } | null>(null);

  const queue = useMemo(() => {
    const all = flattenQueue(groups);
    return focusTenantId ? all.filter((i) => i.tenantId === focusTenantId) : all;
  }, [groups, focusTenantId]);

  const current = currentItem(queue, decided, picked);
  const progress = queueProgress(queue, decided);
  const next = upNext(queue, decided, current?.id ?? null);

  const markDecided = (id: string) => {
    setDecided((prev) => new Set(prev).add(id));
    setPicked(null);
    // Back to the top for the next document, so its owner is the first thing read.
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const approve = (item: QueueItem) => {
    setPending({ id: item.id, kind: 'approve' });
    verification.approve(
      { documentId: item.id, targetTenantId: item.tenantId },
      { onSuccess: () => markDecided(item.id), onSettled: () => setPending(null) },
    );
  };

  return (
    <ThemeProvider theme="product">
      <div className={APP_SURFACE}>
        <div className="mx-auto w-full max-w-[560px]">
          <div className="flex items-center gap-2.5 px-4 pb-1.5 pt-6">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-border bg-card"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-[19px] font-extrabold leading-tight tracking-tight text-foreground">Verify documents</h1>
              <p className="text-[12px] text-muted-foreground">
                {isLoading
                  ? 'Loading…'
                  : progress.remaining === 0
                    ? 'Nothing waiting on you'
                    : `${progress.remaining} left · ${progress.tenants} tenant${progress.tenants === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>

          {/* Session progress — only once something has been decided, so an untouched queue isn't a 0% bar. */}
          {progress.decided > 0 && progress.remaining > 0 && (
            <div className="mx-4 mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full bg-success transition-[width] duration-300"
                style={{ width: `${(progress.decided / (progress.decided + progress.remaining)) * 100}%` }}
              />
            </div>
          )}

          <div className="flex flex-col gap-3 px-4 pb-36 pt-3">
            {isLoading && <div className="h-[420px] animate-pulse rounded-[18px] bg-muted" />}

            {isError && !isLoading && (
              <EmptyState
                icon={<X className="h-5 w-5" />}
                title="Couldn't load the queue"
                description="Something went wrong fetching pending documents."
                action={
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="min-h-11 rounded-xl bg-primary px-5 py-2.5 font-display text-sm font-bold text-primary-foreground"
                  >
                    Try again
                  </button>
                }
              />
            )}

            {/* Zero pending is a finished state, not an empty list. */}
            {!isLoading && !isError && !current && (
              <EmptyState
                icon={<ShieldCheck className="h-5 w-5 text-success" />}
                title={progress.decided > 0 ? 'All done' : focusTenantId ? 'Nothing pending for this tenant' : 'All caught up'}
                description={
                  progress.decided > 0
                    ? `You reviewed ${progress.decided} document${progress.decided === 1 ? '' : 's'}. Tenants see your decisions straight away.`
                    : 'Every tenant document has been reviewed. New uploads will appear here.'
                }
                action={
                  <button
                    type="button"
                    onClick={() => navigate('/owner/tenants')}
                    className="min-h-11 rounded-xl border border-border bg-card px-5 py-2.5 font-display text-sm font-bold text-foreground"
                  >
                    View tenants
                  </button>
                }
              />
            )}

            {current && (
              <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
                {/* Whose it is, first — the thing to check the document against. */}
                <button
                  type="button"
                  onClick={() => navigate(`/owner/tenants/${current.tenantId}`)}
                  className="flex min-h-11 items-center gap-2 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-[15px] font-bold text-foreground">{current.tenantName}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      Room {current.roomNo} · {current.hostelName}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
                </button>

                <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                  <span className="font-display text-[16px] font-extrabold text-foreground">{documentTypeLabel(current.docType)}</span>
                  {waitedFor(current.uploadedAt) && (
                    <span className="flex-none rounded-full bg-warning/10 px-2.5 py-1 text-[11px] font-bold text-warning">
                      {waitedFor(current.uploadedAt)}
                    </span>
                  )}
                </div>

                {/* key: a fresh pane per document, so the previous image never flashes under the next name. */}
                <DocumentPreviewPane
                  key={current.id}
                  url={current.downloadUrl}
                  title={`${documentTypeLabel(current.docType)} — ${current.tenantName}`}
                  fileName={`${current.docType.toLowerCase()}-${current.tenantName.replace(/\s+/g, '-').toLowerCase()}`}
                  imageMaxHeight="max-h-[46dvh]"
                />

                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Check the name and photo match <span className="font-semibold text-foreground">{current.tenantName}</span>, and that
                  the details are readable.
                </p>
              </div>
            )}

            {current && next.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="px-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Up next · {next.length}</div>
                {next.slice(0, 6).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPicked(item.id);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="flex min-h-12 items-center gap-2 rounded-[14px] border border-border bg-card px-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-foreground">{item.tenantName}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{documentTypeLabel(item.docType)}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Thumb-reach decision bar, pinned while a document is on screen. */}
        {current && (
          <div
            className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur"
          >
            <div className="mx-auto w-full max-w-[560px]">
              <DocumentDecisionBar
                onApprove={() => approve(current)}
                onReject={() => setRejecting(current)}
                busy={pending != null}
                pending={pending?.id === current.id ? pending.kind : null}
              />
            </div>
          </div>
        )}
      </div>

      <RejectDocumentSheet
        open={rejecting != null}
        docType={rejecting?.docType ?? ''}
        tenantName={rejecting?.tenantName ?? 'The tenant'}
        isSubmitting={verification.isRejecting}
        onClose={() => setRejecting(null)}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          const item = rejecting;
          setPending({ id: item.id, kind: 'reject' });
          try {
            await verification.rejectAsync({ documentId: item.id, reason, targetTenantId: item.tenantId });
            setRejecting(null);
            markDecided(item.id);
          } catch {
            // useDocumentVerification has already shown the error; the sheet stays
            // open with the reason intact so the owner can try again.
          } finally {
            setPending(null);
          }
        }}
      />
    </ThemeProvider>
  );
}
