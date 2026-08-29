import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { ownerServiceRequestsService, type OwnerServiceRequestEvent } from '@features/hostel-content/api/serviceRequests';

const STATUS_LABEL: Record<string, string> = {
  RAISED: 'Raised',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

interface ServiceRequestChatSheetProps {
  /** Null closes the sheet — same on/off contract `BottomSheet` expects. */
  requestId: string | null;
  onClose: () => void;
}

function Bubble({ event }: { event: OwnerServiceRequestEvent }) {
  const meta = new Date(event.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  if (event.status) {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
          {event.note ? event.note : `Status changed to ${STATUS_LABEL[event.status] ?? event.status}`} · {meta}
        </span>
      </div>
    );
  }

  const fromOwner = event.actor_role === 'OWNER';
  return (
    <div className={`flex ${fromOwner ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-[16px] px-3.5 py-2.5 ${
          fromOwner ? 'rounded-br-[4px] bg-foreground text-background' : 'rounded-bl-[4px] bg-muted text-foreground'
        }`}
      >
        <div className="text-[13px] leading-snug">{event.note}</div>
        <div className={`mt-1 text-[10px] font-medium ${fromOwner ? 'text-background/70' : 'text-muted-foreground'}`}>{meta}</div>
      </div>
    </div>
  );
}

/** Real chat on one service-request ticket — replaces the "Coming soon" stub on `AlertsRequestsPage`. Owner and tenant messages share the same `tenant_service_request_events` timeline, so status changes appear inline as centered pills. */
export function ServiceRequestChatSheet({ requestId, onClose }: ServiceRequestChatSheetProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  const queryKey = ['owner', 'service-requests', requestId, 'messages'];

  const messagesQuery = useQuery({
    queryKey,
    queryFn: () => ownerServiceRequestsService.getMessages(requestId!),
    enabled: Boolean(requestId),
  });

  const sendMutation = useMutation({
    mutationFn: (message: string) => ownerServiceRequestsService.sendMessage(requestId!, message),
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const events = messagesQuery.data?.tenant_service_request_events ?? [];
  const ticketLabel = messagesQuery.data ? (messagesQuery.data.category ?? messagesQuery.data.type.replace(/_/g, ' ')) : 'Chat';
  const tenantName = messagesQuery.data?.tenants?.profiles?.name;

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  };

  return (
    <BottomSheet
      open={Boolean(requestId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={tenantName ? `${ticketLabel} · ${tenantName}` : ticketLabel}
      footer={
        <div className="flex items-center gap-2 rounded-[14px] border border-border bg-card p-1.5">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="Type a message…"
            className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sendMutation.isPending}
            aria-label="Send"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-foreground text-background disabled:opacity-40"
          >
            <Send className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      }
    >
      {messagesQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 pb-2">
          {events.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">No messages yet — say hello.</p>
          ) : (
            events.map((e) => <Bubble key={e.id} event={e} />)
          )}
        </div>
      )}
    </BottomSheet>
  );
}
