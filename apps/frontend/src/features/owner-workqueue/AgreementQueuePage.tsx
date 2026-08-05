import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileClock, CalendarDays, LogOut, Phone, MessageCircle, ChevronRight } from 'lucide-react';
import { agreementService } from '@features/agreements/api';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { queryKeys } from '@lib/queryKeys';
import { WorkQueue, type WorkQueueSection, type WorkQueueItem } from './WorkQueue';
import { whatsAppNumber, phoneDigits } from '@features/owner-collection/collectionQueue';

/**
 * Review Agreements queue (ADR-046).
 *
 * **No new backend.** `renewalDecisionService.getOwnerRenewalQueue` already
 * evaluates every expiring/expired agreement, tags it with decision states,
 * ranks it (expired-and-rent-overdue → critical → decision-pending → expiring
 * → move-out, then by days overdue) and returns per-category counts. This
 * screen groups that existing, already-prioritised output into the standard
 * queue sections — it re-derives nothing.
 */

const SECTIONS: { id: string; label: string; Icon: typeof AlertTriangle; tone: string; match: (s: string[]) => boolean }[] = [
  {
    id: 'CRITICAL',
    label: 'Expired and rent overdue',
    Icon: AlertTriangle,
    tone: 'text-destructive',
    match: (s) => s.includes('EXPIRED_AND_RENT_OVERDUE') || s.includes('RENEWAL_OVERDUE_CRITICAL'),
  },
  {
    id: 'DECISION',
    label: 'Waiting on your decision',
    Icon: FileClock,
    tone: 'text-warning',
    match: (s) => s.includes('RENEWAL_DECISION_PENDING'),
  },
  {
    id: 'EXPIRING',
    label: 'Expiring soon',
    Icon: CalendarDays,
    tone: 'text-info',
    match: (s) => s.includes('EXPIRING_SOON'),
  },
  {
    id: 'MOVE_OUT',
    label: 'Moving out',
    Icon: LogOut,
    tone: 'text-muted-foreground',
    match: (s) => s.includes('MOVE_OUT_IN_PROGRESS'),
  },
];

export function AgreementQueuePage() {
  const navigate = useNavigate();
  const session = useOwnerSession();

  const query = useQuery({
    queryKey: queryKeys.owner.renewalQueue(),
    queryFn: () => agreementService.getRenewalQueue() as Promise<any>,
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  const data = query.data?.data ?? query.data;
  const renewals: any[] = data?.renewals ?? [];

  // The renewal payload carries `hostel_id` but no hostel name, so resolve it
  // from the session's already-loaded hostel list rather than firing a lookup.
  const hostelNameById = useMemo(
    () => new Map<string, string>((session.hostels ?? []).map((h: any) => [h.id, h.name ?? ''])),
    [session.hostels],
  );

  const sections: WorkQueueSection[] = useMemo(() => {
    const claimed = new Set<string>();
    const out: WorkQueueSection[] = [];

    for (const def of SECTIONS) {
      // First matching section wins, so a row appears exactly once even though
      // the backend can tag it with several states at the same time.
      const rows = renewals.filter((r) => {
        const key = r.current_agreement?.id ?? r.tenant?.id;
        if (!key || claimed.has(key)) return false;
        if (!def.match(r.states ?? [])) return false;
        claimed.add(key);
        return true;
      });
      if (rows.length === 0) continue;

      out.push({
        id: def.id,
        label: def.label,
        Icon: def.Icon,
        tone: def.tone,
        summary: `${rows.length}`,
        items: rows.map((r): WorkQueueItem => {
          const tenant = r.tenant ?? {};
          const phone = tenant.phone ?? '';
          const digits = phoneDigits(phone);
          const wa = whatsAppNumber(phone);
          const overdueRent = Number(r.overdue_rent?.total ?? 0);

          const urgency =
            r.days_overdue > 0
              ? `Expired ${r.days_overdue} day${r.days_overdue === 1 ? '' : 's'} ago`
              : r.days_until_expiry != null
                ? `Expires in ${r.days_until_expiry} day${r.days_until_expiry === 1 ? '' : 's'}`
                : 'Agreement ended';

          const meta: string[] = [];
          if (overdueRent > 0) meta.push(`₹${overdueRent.toLocaleString('en-IN')} rent overdue`);
          if (r.move_out_status) meta.push('Move-out in progress');
          if (r.renewal_blocked_reason && !r.renewal_available) meta.push('Renewal not available');

          return {
            id: String(r.current_agreement?.id ?? tenant.id),
            title: tenant.name ?? 'Tenant',
            subtitle: [
              tenant.room?.room_no ? `Room ${tenant.room.room_no}` : null,
              hostelNameById.get(tenant.hostel_id) ?? '',
            ]
              .filter(Boolean)
              .join(' · '),
            urgency,
            meta: meta.length ? meta : undefined,
            onOpen: () => navigate(`/owner/tenants/${tenant.id}`),
            actions: [
              {
                id: 'review',
                label: 'Review',
                Icon: ChevronRight,
                primary: true,
                onClick: () => navigate(`/owner/tenants/${tenant.id}`),
              },
              ...(digits
                ? [{ id: 'call', label: 'Call', Icon: Phone, href: `tel:+${wa ?? digits}` }]
                : []),
              ...(wa
                ? [{ id: 'wa', label: 'WhatsApp', Icon: MessageCircle, href: `https://wa.me/${wa}` }]
                : []),
            ],
          };
        }),
      });
    }
    return out;
  }, [renewals, navigate, hostelNameById]);

  const total = renewals.length;
  const state = query.isLoading ? 'loading' : query.isError ? 'error' : total === 0 ? 'empty' : 'ready';

  return (
    <WorkQueue
      title="Agreements to review"
      subtitle={`${total} agreement${total === 1 ? '' : 's'} need attention`}
      state={state}
      sections={sections}
      emptyTitle="No agreements need attention"
      emptyBody="Nothing is expiring, expired or waiting on a renewal decision."
      onRetry={() => query.refetch()}
    />
  );
}
