import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Hourglass, CalendarDays, Phone, MessageCircle, Wallet } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { QuickCollectModal } from '@features/owner-tenants/quick-collect/QuickCollectModal';
import { getInitials } from '@features/tenants/utils/normalize';
import { WorkQueue, type WorkQueueSection, type WorkQueueItem } from '@features/owner-workqueue/WorkQueue';
import { useCollectionQueue } from './useCollectionQueue';
import {
  formatINR,
  urgencyLabel,
  locationLabel,
  lastPaymentLabel,
  lastReminderLabel,
  topReasons,
  whatsAppNumber,
  phoneDigits,
  type CollectionQueueRow,
} from './collectionQueue';
import type { QuickCollectTenant } from '@features/owner-tenants/types';

/** Icons, not emoji. */
const BUCKET_STYLE: Record<string, { Icon: typeof AlertTriangle; tone: string }> = {
  NEEDS_ATTENTION: { Icon: AlertTriangle, tone: 'text-destructive' },
  DUE_TODAY: { Icon: Clock, tone: 'text-warning' },
  AWAITING_REMINDER: { Icon: Hourglass, tone: 'text-info' },
  DUE_SOON: { Icon: CalendarDays, tone: 'text-muted-foreground' },
};

/**
 * Today's Collection Queue (ADR-045), rendered through the shared
 * `WorkQueue` (ADR-046).
 *
 * This screen originally carried its own layout; it was refactored onto the
 * shared component so all four Action Center queues are literally the same
 * implementation rather than four similar ones that drift.
 */
export function CollectionQueuePage() {
  const navigate = useNavigate();
  const { groups, totalTenants, totalOutstanding, state, refetch } = useCollectionQueue();
  const [why, setWhy] = useState<CollectionQueueRow | null>(null);
  const [collectFor, setCollectFor] = useState<QuickCollectTenant | undefined>(undefined);

  const rowsById = useMemo(() => {
    const map = new Map<string, CollectionQueueRow>();
    for (const g of groups) for (const r of g.rows) map.set(r.tenantId, r);
    return map;
  }, [groups]);

  const sections: WorkQueueSection[] = useMemo(
    () =>
      groups.map((group) => {
        const style = BUCKET_STYLE[group.id] ?? BUCKET_STYLE.DUE_SOON;
        return {
          id: String(group.id),
          label: group.label,
          Icon: style.Icon,
          tone: style.tone,
          summary: `${group.count} · ${formatINR(group.totalOutstanding)}`,
          items: group.rows.map((row): WorkQueueItem => {
            const digits = phoneDigits(row.phone);
            const wa = whatsAppNumber(row.phone);
            return {
              id: row.tenantId,
              title: row.tenantName,
              subtitle: locationLabel(row),
              headline: formatINR(row.outstanding),
              headlineTone: 'destructive',
              urgency: urgencyLabel(row),
              meta: [lastPaymentLabel(row), lastReminderLabel(row)],
              reasons: topReasons(row),
              onOpen: () => navigate(`/owner/tenants/${row.tenantId}`),
              actions: [
                {
                  id: 'collect',
                  label: 'Collect',
                  Icon: Wallet,
                  primary: true,
                  onClick: () =>
                    setCollectFor({
                      id: row.tenantId,
                      name: row.tenantName,
                      initials: getInitials(row.tenantName),
                      phone: row.phone,
                      hostelId: row.hostelId,
                      hostelName: row.hostelName,
                      room: row.room || 'N/A',
                      outstanding: row.outstanding,
                      deposit: 0,
                    }),
                },
                ...(digits ? [{ id: 'call', label: 'Call', Icon: Phone, href: `tel:+${wa ?? digits}` }] : []),
                ...(wa ? [{ id: 'wa', label: 'WhatsApp', Icon: MessageCircle, href: `https://wa.me/${wa}` }] : []),
              ],
            };
          }),
        };
      }),
    [groups, navigate],
  );

  return (
    <WorkQueue
      title="Today's collection"
      subtitle={`${totalTenants} tenant${totalTenants === 1 ? '' : 's'} · ${formatINR(totalOutstanding)} to collect`}
      state={state === 'all-clear' ? 'empty' : state}
      sections={sections}
      emptyTitle="Nothing to collect today"
      emptyBody="No rent is overdue or due in the next week."
      onRetry={() => refetch()}
      onExplain={(item) => setWhy(rowsById.get(item.id) ?? null)}
    >
      {/* The full "why", on demand. Ordering is never a black box. */}
      <BottomSheet
        open={why != null}
        onOpenChange={(v) => !v && setWhy(null)}
        title={why ? `Why ${why.tenantName} is here` : ''}
      >
        {why && (
          <div className="flex flex-col gap-2">
            {why.factors.length === 0 && (
              <p className="text-[12.5px] text-muted-foreground">
                No priority signals — this tenant simply owes money.
              </p>
            )}
            {[...why.factors]
              .sort((a, b) => b.points - a.points)
              .map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3.5 py-2.5">
                  <span className="text-[12.5px] text-foreground">{f.label}</span>
                  <span className="flex-none font-display text-[12px] font-bold tabular-nums text-muted-foreground">
                    +{f.points}
                  </span>
                </div>
              ))}
            <div className="mt-1 flex items-center justify-between gap-3 px-3.5">
              <span className="text-[12.5px] font-bold text-foreground">Priority score</span>
              <span className="font-display text-[13px] font-extrabold tabular-nums text-foreground">{why.score}</span>
            </div>
            <p className="mt-1 px-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Higher scores are shown first within each section. Sections themselves are ordered by urgency.
            </p>
          </div>
        )}
      </BottomSheet>

      <QuickCollectModal
        open={collectFor != null}
        onClose={() => setCollectFor(undefined)}
        initialTenant={collectFor}
      />
    </WorkQueue>
  );
}
