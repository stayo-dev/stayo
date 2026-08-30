import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, Eye, ShieldCheck, X } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { usePendingVerifications } from '../hooks/usePendingVerifications';
import { useDocumentVerification } from '../hooks/useDocumentVerification';
import { RejectDocumentSheet } from '../documents/RejectDocumentSheet';
import { documentTypeLabel } from '../documents/kycDocuments';
import { APP_SURFACE } from '@shared/ui/surface';

const card =
  'flex flex-col gap-3 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const actionBtn =
  'flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-2.5 font-display text-[12.5px] font-bold disabled:opacity-50';

function waitedFor(iso: string | null) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/**
 * The owner's pending-KYC queue, reached from the Home dashboard's "Verify
 * Pending KYC" card — which counted real documents and did nothing when
 * tapped, because there was nowhere for it to go.
 *
 * Grouped by tenant rather than listed by document: the owner is deciding
 * about a person, and the person who has waited longest is the one whose
 * move-in is blocked.
 */
export function PendingVerificationsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusTenantId = searchParams.get('tenantId');

  const { groups, documentCount, tenantCount, isLoading, isError, refetch } = usePendingVerifications();
  const verification = useDocumentVerification(undefined);
  const [rejecting, setRejecting] = useState<
    { documentId: string; docType: string; tenantId: string; tenantName: string } | null
  >(null);

  const visible = focusTenantId ? groups.filter((g) => g.tenantId === focusTenantId) : groups;

  return (
    <ThemeProvider theme="product">
      <div className={APP_SURFACE}>
        <div className="flex items-center gap-2.5 px-4 pb-1.5 pt-6 sm:px-6">
          <button
            type="button"
            onClick={() => navigate('/owner/home')}
            aria-label="Back"
            className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
          </button>
          <span className="text-[13px] font-medium text-muted-foreground">Home</span>
        </div>

        <div className="px-4 pb-3 pt-1 sm:px-6">
          <h1 className="font-display text-[21px] font-extrabold tracking-tight text-foreground">Verify KYC</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {isLoading
              ? 'Loading…'
              : documentCount === 0
                ? 'Nothing waiting on you'
                : `${documentCount} document${documentCount === 1 ? '' : 's'} from ${tenantCount} tenant${tenantCount === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-4 pb-10 sm:px-6">
          {isLoading && (
            <>
              <div className="h-32 animate-pulse rounded-[18px] bg-muted" />
              <div className="h-32 animate-pulse rounded-[18px] bg-muted" />
            </>
          )}

          {isError && !isLoading && (
            <EmptyState
              icon={<X className="h-5 w-5" />}
              title="Couldn't load the queue"
              description="Something went wrong fetching pending documents."
              action={
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="rounded-xl bg-primary px-5 py-2.5 font-display text-sm font-bold text-primary-foreground"
                >
                  Try again
                </button>
              }
            />
          )}

          {/* Zero pending is a finished state, not an empty list. */}
          {!isLoading && !isError && visible.length === 0 && (
            <EmptyState
              icon={<ShieldCheck className="h-5 w-5 text-success" />}
              title={focusTenantId ? 'Nothing pending for this tenant' : 'All caught up'}
              description={
                focusTenantId
                  ? 'Every document for this tenant has been reviewed.'
                  : 'Every tenant document has been reviewed. New uploads will appear here.'
              }
              action={
                <button
                  type="button"
                  onClick={() => navigate('/owner/tenants')}
                  className="rounded-xl border border-border bg-card px-5 py-2.5 font-display text-sm font-bold text-foreground"
                >
                  View tenants
                </button>
              }
            />
          )}

          {visible.map((group) => (
            <div key={group.tenantId} className={card}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/owner/tenants/${group.tenantId}`)}
                    className="text-left font-display text-[14.5px] font-bold text-foreground underline-offset-2 hover:underline"
                  >
                    {group.tenantName}
                  </button>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    Room {group.roomNo} · {group.hostelName}
                  </div>
                </div>
                {waitedFor(group.waitingSince) && (
                  <span className="flex-none rounded-full bg-warning/10 px-2.5 py-1 font-display text-[11px] font-bold text-warning">
                    {waitedFor(group.waitingSince)}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
                {group.documents.map((doc) => (
                  <div key={doc.id} className="flex flex-col gap-2 rounded-[14px] bg-muted/40 p-3">
                    <div className="text-[12.5px] font-bold text-foreground">{documentTypeLabel(doc.docType)}</div>
                    <div className="flex gap-2">
                      {doc.downloadUrl && (
                        <>
                          <button
                            type="button"
                            onClick={() => window.open(doc.downloadUrl!, '_blank', 'noopener,noreferrer')}
                            className={`${actionBtn} border border-border bg-card text-foreground`}
                          >
                            <Eye className="h-3.5 w-3.5" strokeWidth={1.9} />
                            View
                          </button>
                          <a href={doc.downloadUrl} download className={`${actionBtn} border border-border bg-card text-foreground`}>
                            <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
                            Save
                          </a>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => verification.approve({ documentId: doc.id, targetTenantId: group.tenantId })}
                        disabled={verification.isApproving}
                        className={`${actionBtn} bg-success text-white`}
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRejecting({
                            documentId: doc.id,
                            docType: doc.docType,
                            tenantId: group.tenantId,
                            tenantName: group.tenantName,
                          })
                        }
                        disabled={verification.isRejecting}
                        className={`${actionBtn} border border-destructive/30 bg-card text-destructive`}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <RejectDocumentSheet
        open={rejecting != null}
        docType={rejecting?.docType ?? ''}
        tenantName={rejecting?.tenantName ?? 'The tenant'}
        isSubmitting={verification.isRejecting}
        onClose={() => setRejecting(null)}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          await verification.rejectAsync({
            documentId: rejecting.documentId,
            reason,
            targetTenantId: rejecting.tenantId,
          });
          setRejecting(null);
        }}
      />
    </ThemeProvider>
  );
}
