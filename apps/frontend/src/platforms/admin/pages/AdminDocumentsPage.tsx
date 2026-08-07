import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FileText, IdCard, Image as ImageIcon, X } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';

type ReviewStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

const TABS: { key: ReviewStatus; label: string }[] = [
  { key: 'PENDING', label: 'Awaiting review' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'REJECTED', label: 'Rejected' },
];

const DOC_ICON = { AADHAAR: IdCard, PAN: FileText, PHOTO: ImageIcon } as const;

const DOC_LABEL = { AADHAAR: 'Aadhaar', PAN: 'PAN', PHOTO: 'Profile photo' } as const;

const fmt = (iso: string) =>
  `${new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · ${new Date(iso).toLocaleTimeString(
    'en-IN',
    { hour: 'numeric', minute: '2-digit' },
  )}`;

/**
 * Owner KYC review queue.
 *
 * Uploads have been landing in `owner_documents` since ADR-038 with nowhere to
 * review them, so nothing could ever leave PENDING and "verified" was
 * unreachable in practice. This is the missing half.
 *
 * Rejecting requires a reason because the owner is shown it — a rejection with
 * no explanation just produces the same upload again.
 */
export function AdminDocumentsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReviewStatus>('PENDING');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const listQuery = useQuery({
    queryKey: ['admin', 'owner-documents', tab],
    queryFn: () => platformAdminService.getOwnerDocuments(tab),
    staleTime: 15_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'VERIFIED' | 'REJECTED'; reason?: string }) =>
      platformAdminService.reviewOwnerDocument(id, decision, reason),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'owner-documents'] });
      stayoToast.success(variables.decision === 'VERIFIED' ? 'Document verified' : 'Document rejected — owner notified in-app');
      setRejectingId(null);
      setNote('');
    },
    onError: (error: any) =>
      stayoToast.error(error?.response?.data?.error?.message || 'Could not record that review'),
  });

  const documents = listQuery.data ?? [];

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-7">
      <div className="mb-5">
        <h1 className="font-display text-[22px] font-extrabold text-foreground">Owner documents</h1>
        <p className="mt-1 text-[13.5px] text-[#8A7F75]">
          Aadhaar and PAN must both be verified before an owner&apos;s hostel can go live.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
              tab === t.key ? 'bg-foreground text-background' : 'border border-[#E7DDD1] bg-white text-[#8A7F75]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="py-16 text-center text-[13.5px] text-[#9C9186]">
          {tab === 'PENDING' ? 'Nothing waiting for review.' : `No ${tab.toLowerCase()} documents.`}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {documents.map((doc) => {
            const Icon = DOC_ICON[doc.doc_type] ?? FileText;
            const isRejecting = rejectingId === doc.id;

            return (
              <div
                key={doc.id}
                className="rounded-[14px] border border-[#EFE6DA] bg-white p-4 shadow-[0_1px_2px_rgba(40,30,20,0.03)]"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-foreground">{doc.profile?.name || 'Unknown owner'}</div>
                    <div className="truncate text-[12.5px] text-[#8A7F75]">
                      {DOC_LABEL[doc.doc_type] ?? doc.doc_type} · {fmt(doc.uploaded_at)}
                    </div>
                    {doc.profile?.phone && (
                      <div className="mt-0.5 truncate text-[12px] tabular-nums text-[#9C9186]">{doc.profile.phone}</div>
                    )}
                  </div>
                </div>

                <a
                  href={doc.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-primary underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open document
                </a>

                {doc.review_note && (
                  <p className="mt-2 rounded-lg bg-[#F7F3EF] px-3 py-2 text-[12px] text-[#6B5B52]">{doc.review_note}</p>
                )}

                {tab === 'PENDING' &&
                  (isRejecting ? (
                    <div className="mt-3 border-t border-[#F2ECE5] pt-3">
                      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#9C9186]">
                        Why is it being rejected?
                      </label>
                      <p className="mb-2 text-[11.5px] text-[#8A7F75]">The owner is shown this, so write it for them.</p>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        autoFocus
                        placeholder="e.g. The image is too blurry to read the number."
                        className="w-full resize-none rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3 py-2 text-[12.5px] outline-none focus:border-primary"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={!note.trim() || reviewMutation.isPending}
                          onClick={() => reviewMutation.mutate({ id: doc.id, decision: 'REJECTED', reason: note.trim() })}
                          className="h-9 flex-1 rounded-[10px] bg-[#C0503A] text-[12.5px] font-bold text-white disabled:opacity-50"
                        >
                          Confirm rejection
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(null);
                            setNote('');
                          }}
                          className="h-9 flex-1 rounded-[10px] border border-[#E7DDD1] text-[12.5px] font-bold text-[#8A7F75]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2 border-t border-[#F2ECE5] pt-3">
                      <button
                        type="button"
                        disabled={reviewMutation.isPending}
                        onClick={() => reviewMutation.mutate({ id: doc.id, decision: 'VERIFIED' })}
                        className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-success text-[12.5px] font-bold text-white disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        Verify
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(doc.id);
                          setNote('');
                        }}
                        className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#EAD0C9] bg-white text-[12.5px] font-bold text-[#C0503A]"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={3} />
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
  );
}
