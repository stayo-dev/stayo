import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { tenantService } from '@features/tenants/api';
import {
  MAX_REJECT_REASON_LENGTH,
  isRejectReasonValid,
  type ReviewDocument,
} from '../documents/kycDocuments';

/**
 * The conversation between owner and tenant about one document.
 *
 * `POST /api/tenants/:id/documents/:docId/message` and the thread it appends
 * to have existed all along — `parseRejectionThread` already reads both the
 * current JSON-array form and the legacy bare-string one. The owner's review
 * card rendered only the newest *owner* message, as a rejection headline, so
 * the tenant's replies were fetched and discarded: an owner could ask "is this
 * the back of the card?" and never see the answer.
 *
 * Reuses `isRejectReasonValid`'s 800-character rule rather than restating it,
 * because that is the same limit this endpoint enforces.
 */

interface DocumentThreadProps {
  tenantId: string;
  doc: ReviewDocument;
}

function formatWhen(timestamp: string): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function DocumentThread({ tenantId, doc }: DocumentThreadProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const send = useMutation({
    mutationFn: (message: string) => tenantService.postDocumentMessage(tenantId, doc.id, message),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
    },
    onError: (error: any) =>
      stayoToast.error(
        error?.response?.data?.error?.message || 'Could not send that message.',
      ),
  });

  const trimmed = draft.trim();
  const canSend = isRejectReasonValid(draft) && !send.isPending;
  const remaining = MAX_REJECT_REASON_LENGTH - trimmed.length;

  return (
    <section className="flex flex-col gap-2.5 border-t border-border pt-3">
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        Conversation about this document
      </span>

      {doc.thread.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">
          Nothing said yet. If something is wrong with this document, say so here — the tenant sees
          it on their own Documents screen.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {doc.thread.map((message, i) => {
            const fromOwner = message.sender === 'owner';
            return (
              <li
                key={`${message.timestamp}-${i}`}
                className={`max-w-[85%] rounded-[13px] px-3 py-2 ${
                  fromOwner ? 'self-end bg-primary/10' : 'self-start bg-muted'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {fromOwner ? 'You' : message.senderName || 'Tenant'}
                  </span>
                  {formatWhen(message.timestamp) && (
                    <span className="text-[10px] text-muted-foreground">{formatWhen(message.timestamp)}</span>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground">
                  {message.message}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* The backend answers 409 for an archived document — don't offer a box
          that cannot post. */}
      {doc.isActive ? (
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={MAX_REJECT_REASON_LENGTH}
            placeholder="Ask for a clearer photo, or explain what's missing…"
            aria-label="Message about this document"
            className="min-w-0 flex-1 resize-none rounded-[11px] border border-border bg-background px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => send.mutate(trimmed)}
            disabled={!canSend}
            aria-label="Send message"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
          >
            {send.isPending ? <StayoLoader size="sm" label={null} /> : <Send className="h-4 w-4" strokeWidth={2} />}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          This document was replaced by a newer upload — its thread is read-only.
        </p>
      )}

      {remaining < 100 && doc.isActive && (
        <span className="self-end text-[10.5px] text-muted-foreground">{remaining} characters left</span>
      )}
    </section>
  );
}
