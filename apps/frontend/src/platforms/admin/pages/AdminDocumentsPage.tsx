import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  FileText,
  IdCard,
  Image as ImageIcon,
  Inbox,
  Phone,
  X,
} from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';
import { DocumentViewer } from '../documents/DocumentViewer';
import {
  DOC_LABEL,
  groupByOwner,
  isOverdue,
  stepSelection,
  waitingLabel,
  type AdminOwnerDocument,
  type ReviewStatus,
} from '../documents/documentQueue';

const TABS: { key: ReviewStatus; label: string }[] = [
  { key: 'PENDING', label: 'Awaiting review' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'REJECTED', label: 'Rejected' },
];

const DOC_ICON: Record<string, typeof IdCard> = { AADHAAR: IdCard, PAN: FileText, PHOTO: ImageIcon };

/** Offered as one-tap reasons — most rejections are one of these. */
const QUICK_REASONS = [
  'The image is too blurry to read.',
  'The document is cut off — please upload the full page.',
  'This does not match the name on the account.',
  'Wrong document type uploaded.',
];

/**
 * Owner KYC review.
 *
 * Built as a two-pane queue rather than a grid of cards because reviewing is a
 * loop, not a browse: pick the oldest, look at the document, decide, and the
 * next one takes its place. The document renders inline — a link to a new tab
 * would break that loop on every item.
 *
 * Owners, not files, are the unit: Aadhaar and PAN are shown together so the
 * names can be cross-checked, which is most of what a reviewer is actually
 * doing.
 */
export function AdminDocumentsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReviewStatus>('PENDING');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const listQuery = useQuery({
    queryKey: ['admin', 'owner-documents', tab],
    queryFn: () => platformAdminService.getOwnerDocuments(tab),
    staleTime: 15_000,
  });

  const pendingCountQuery = useQuery({
    queryKey: ['admin', 'owner-documents', 'PENDING'],
    queryFn: () => platformAdminService.getOwnerDocuments('PENDING'),
    staleTime: 15_000,
  });

  const groups = useMemo(
    () => groupByOwner((listQuery.data ?? []) as AdminOwnerDocument[]),
    [listQuery.data],
  );

  const selectedIndex = Math.max(
    0,
    groups.findIndex((g) => g.ownerId === selectedOwnerId),
  );
  const selected = groups.find((g) => g.ownerId === selectedOwnerId) ?? groups[0] ?? null;

  // Keep a selection as the queue changes underneath — after a decision the
  // acted-on owner disappears and the next slides into the same slot.
  useEffect(() => {
    if (groups.length === 0) {
      setSelectedOwnerId(null);
      return;
    }
    if (!groups.some((g) => g.ownerId === selectedOwnerId)) {
      setSelectedOwnerId(groups[Math.min(selectedIndex, groups.length - 1)].ownerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'VERIFIED' | 'REJECTED'; reason?: string }) =>
      platformAdminService.reviewOwnerDocument(id, decision, reason),
    onSuccess: (_r, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'owner-documents'] });
      stayoToast.success(variables.decision === 'VERIFIED' ? 'Verified' : 'Rejected — the owner is shown your reason');
      setRejectingDocId(null);
      setNote('');
    },
    onError: (error: any) =>
      stayoToast.error(error?.response?.data?.error?.message || 'Could not record that review'),
  });

  // A queue is repetitive; J/K to move is the difference between reviewing
  // twenty documents and dreading it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = stepSelection(groups, selectedIndex, 1);
        setSelectedOwnerId(groups[next]?.ownerId ?? null);
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = stepSelection(groups, selectedIndex, -1);
        setSelectedOwnerId(groups[prev]?.ownerId ?? null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groups, selectedIndex]);

  const pendingCount = (pendingCountQuery.data ?? []).length;

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-5 sm:px-7">
      <div className="mb-4">
        <p className="text-[13.5px] text-[#8A7F75]">
          Aadhaar and PAN must both be verified before an owner&apos;s hostel can go live.
          <span className="ml-1.5 hidden sm:inline text-[#9C9186]">Press J / K to move through the queue.</span>
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setSelectedOwnerId(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
              tab === t.key ? 'bg-foreground text-background' : 'border border-[#E7DDD1] bg-white text-[#8A7F75]'
            }`}
          >
            {t.label}
            {t.key === 'PENDING' && pendingCount > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10.5px] font-bold tabular-nums ${
                  tab === t.key ? 'bg-background/25 text-background' : 'bg-primary/12 text-primary'
                }`}
              >
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[74px] animate-pulse rounded-[14px] bg-muted" />
            ))}
          </div>
          <div className="hidden h-[460px] animate-pulse rounded-[14px] bg-muted lg:block" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-[14px] border border-[#EFE6DA] bg-white py-16 text-center">
          <Inbox className="mx-auto mb-3 h-9 w-9 text-[#C9BDB1]" strokeWidth={1.6} />
          <p className="text-[14px] font-bold text-foreground">
            {tab === 'PENDING' ? 'Nothing waiting for review' : `No ${tab.toLowerCase()} documents`}
          </p>
          <p className="mt-1 text-[12.5px] text-[#8A7F75]">
            {tab === 'PENDING'
              ? 'Every owner document has been reviewed. New uploads appear here.'
              : 'Documents you decide on will show up here.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* QUEUE */}
          <div
            className={`space-y-2.5 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1 ${
              selected ? 'hidden lg:block' : ''
            }`}
          >
            {groups.map((group) => {
              const active = group.ownerId === selected?.ownerId;
              const overdue = tab === 'PENDING' && isOverdue(group.waitingSince);

              return (
                <button
                  key={group.ownerId}
                  type="button"
                  onClick={() => setSelectedOwnerId(group.ownerId)}
                  className={`w-full rounded-[14px] border bg-white p-3.5 text-left transition-colors ${
                    active ? 'border-primary shadow-[0_0_0_1px_rgba(164,93,68,0.35)]' : 'border-[#EFE6DA] hover:border-[#DCCDBE]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-foreground">
                      {group.ownerName}
                    </span>
                    {overdue && (
                      <span className="inline-flex flex-none items-center gap-1 rounded-full bg-[#C0503A]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#C0503A]">
                        <AlertCircle className="h-2.5 w-2.5" strokeWidth={3} />
                        Overdue
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {group.documents.map((d) => (
                      <span
                        key={d.id}
                        className="rounded-md bg-[#F7F3EF] px-1.5 py-0.5 text-[10.5px] font-bold text-[#8A7F75]"
                      >
                        {DOC_LABEL[d.doc_type] ?? d.doc_type}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-[#9C9186]">{waitingLabel(group.waitingSince)}</div>
                </button>
              );
            })}
          </div>

          {/* REVIEW PANE */}
          {selected && (
            <div className="rounded-[14px] border border-[#EFE6DA] bg-white">
              <div className="flex items-start gap-3 border-b border-[#F2ECE5] p-4">
                <button
                  type="button"
                  onClick={() => setSelectedOwnerId(null)}
                  aria-label="Back to queue"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[#E7DDD1] text-[#8A7F75] lg:hidden"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[17px] font-extrabold text-foreground">
                    {selected.ownerName}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-[#8A7F75]">
                    {selected.phone && (
                      <a href={`tel:${selected.phone}`} className="inline-flex items-center gap-1 tabular-nums hover:text-primary">
                        <Phone className="h-3 w-3" />
                        {selected.phone}
                      </a>
                    )}
                    <span>{waitingLabel(selected.waitingSince)}</span>
                  </div>
                </div>
              </div>

              {selected.documents.map((doc) => {
                const Icon = DOC_ICON[doc.doc_type] ?? FileText;
                const isRejecting = rejectingDocId === doc.id;
                const decided = doc.status !== 'PENDING';

                return (
                  <div key={doc.id} className="border-b border-[#F2ECE5] last:border-b-0">
                    <div className="flex items-center gap-2.5 px-4 pt-4">
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" strokeWidth={2.2} />
                      </span>
                      <span className="text-[14px] font-bold text-foreground">
                        {DOC_LABEL[doc.doc_type] ?? doc.doc_type}
                      </span>
                      {doc.status === 'VERIFIED' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-bold text-success">
                          <CheckCircle2 className="h-3 w-3" strokeWidth={2.8} />
                          Verified
                        </span>
                      )}
                      {doc.status === 'REJECTED' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#C0503A]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#C0503A]">
                          Rejected
                        </span>
                      )}
                    </div>

                    <div className="mt-3 h-[300px] sm:h-[380px]">
                      <DocumentViewer document={doc} />
                    </div>

                    {doc.review_note && (
                      <p className="mx-4 mt-3 rounded-lg bg-[#F7F3EF] px-3 py-2 text-[12px] text-[#6B5B52]">
                        <span className="font-bold">Reason given:</span> {doc.review_note}
                      </p>
                    )}

                    {!decided &&
                      (isRejecting ? (
                        <div className="p-4">
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[#9C9186]">
                            Why is it being rejected?
                          </label>
                          <p className="mb-2 text-[11.5px] text-[#8A7F75]">
                            The owner is shown this and has to fix it, so write it for them.
                          </p>
                          {/* One-tap reasons: most rejections are one of these,
                              and free-typing the same sentence twenty times a
                              day is how reviewers start writing "no". */}
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {QUICK_REASONS.map((reason) => (
                              <button
                                key={reason}
                                type="button"
                                onClick={() => setNote(reason)}
                                className="rounded-full border border-[#E7DDD1] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#8A7F75] hover:border-primary hover:text-primary"
                              >
                                {reason.replace(/\.$/, '')}
                              </button>
                            ))}
                          </div>
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            autoFocus
                            placeholder="Add or edit the reason…"
                            className="w-full resize-none rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3 py-2 text-[12.5px] outline-none focus:border-primary"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={!note.trim() || reviewMutation.isPending}
                              onClick={() =>
                                reviewMutation.mutate({ id: doc.id, decision: 'REJECTED', reason: note.trim() })
                              }
                              className="h-9 flex-1 rounded-[10px] bg-[#C0503A] text-[12.5px] font-bold text-white disabled:opacity-50"
                            >
                              {reviewMutation.isPending ? 'Rejecting…' : 'Confirm rejection'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingDocId(null);
                                setNote('');
                              }}
                              className="h-9 flex-1 rounded-[10px] border border-[#E7DDD1] text-[12.5px] font-bold text-[#8A7F75]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 p-4">
                          <button
                            type="button"
                            disabled={reviewMutation.isPending}
                            onClick={() => reviewMutation.mutate({ id: doc.id, decision: 'VERIFIED' })}
                            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-success text-[13px] font-bold text-white disabled:opacity-60"
                          >
                            <Check className="h-4 w-4" strokeWidth={3} />
                            Verify
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingDocId(doc.id);
                              setNote('');
                            }}
                            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#EAD0C9] bg-white text-[13px] font-bold text-[#C0503A]"
                          >
                            <X className="h-4 w-4" strokeWidth={3} />
                            Reject
                          </button>
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
