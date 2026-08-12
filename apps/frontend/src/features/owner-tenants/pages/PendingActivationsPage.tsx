import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCheck, ShieldAlert, Phone, MessageCircle, ChevronRight } from 'lucide-react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { usePendingActivations } from '../hooks/usePendingActivations';
import { WorkQueue, type WorkQueueSection, type WorkQueueItem } from '@features/owner-workqueue/WorkQueue';
import { whatsAppNumber, phoneDigits } from '@features/owner-collection/collectionQueue';

export const PENDING_ACTIVATIONS_ROUTE = '/owner/tenants/activations';

/**
 * Activate Tenants queue (ADR-046).
 *
 * Rebuilt onto the shared `WorkQueue` so it behaves exactly like the
 * collection, agreement and vacancy queues — the owner learns one workflow.
 * Previously this screen had its own bespoke card layout, no prioritisation
 * and no inline actions: it could tell you who was stuck but not let you do
 * anything about it without opening each profile.
 *
 * The activation step itself still comes from the backend state machine via
 * `usePendingActivations` — nothing here re-derives a step. See ADR of the
 * original activation-visibility work for that contract.
 */
export function PendingActivationsPage() {
  const navigate = useNavigate();
  const { rows, count, isLoading, isError, refetch } = usePendingActivations();

  const sections: WorkQueueSection[] = useMemo(() => {
    const toItem = (row: any): WorkQueueItem => {
      const digits = phoneDigits(row.phone);
      const wa = whatsAppNumber(row.phone);
      return {
        id: row.tenantId,
        title: row.name,
        subtitle: [row.room ? `Room ${row.room}` : 'No room yet', row.hostelName].filter(Boolean).join(' · '),
        headline: row.currentLabel,
        headlineTone: 'default',
        urgency: row.waitingLabel ?? undefined,
        meta: [row.documentVerified ? 'KYC verified' : 'KYC pending'],
        onOpen: () => navigate(`/owner/tenants/${row.tenantId}`),
        actions: [
          {
            id: 'open',
            label: 'Open',
            Icon: ChevronRight,
            primary: true,
            onClick: () => navigate(`/owner/tenants/${row.tenantId}`),
          },
          ...(digits ? [{ id: 'call', label: 'Call', Icon: Phone, href: `tel:+${wa ?? digits}` }] : []),
          ...(wa ? [{ id: 'wa', label: 'WhatsApp', Icon: MessageCircle, href: `https://wa.me/${wa}` }] : []),
        ],
      };
    };

    // Longest wait first — the tenant who has been stuck longest is the one
    // whose move-in is most at risk.
    const byWait = (a: any, b: any) => {
      const at = a.waitingSince ? new Date(a.waitingSince).getTime() : Infinity;
      const bt = b.waitingSince ? new Date(b.waitingSince).getTime() : Infinity;
      return at - bt || String(a.name).localeCompare(String(b.name));
    };

    const blockedOnKyc = rows.filter((r: any) => !r.documentVerified);
    const rest = rows.filter((r: any) => r.documentVerified);

    const out: WorkQueueSection[] = [];
    if (blockedOnKyc.length) {
      out.push({
        id: 'KYC',
        label: 'Waiting on documents',
        Icon: ShieldAlert,
        tone: 'text-warning',
        summary: `${blockedOnKyc.length}`,
        items: [...blockedOnKyc].sort(byWait).map(toItem),
      });
    }
    if (rest.length) {
      out.push({
        id: 'READY',
        label: 'Documents done, still not activated',
        Icon: UserCheck,
        tone: 'text-info',
        summary: `${rest.length}`,
        items: [...rest].sort(byWait).map(toItem),
      });
    }
    return out;
  }, [rows, navigate]);

  const state = isLoading ? 'loading' : isError ? 'error' : count === 0 ? 'empty' : 'ready';

  return (
    // This route sits outside <OwnerAppShell> (declared as a sibling in
    // OwnerRoutes.tsx, like its neighbours /owner/tenants/verifications and
    // /owner/tenants/:tenantId), so it doesn't inherit OwnerAppShell's
    // ThemeProvider and must scope the StayO tokens itself — otherwise it
    // silently falls back to theme.css's unscoped legacy (pre-StayO) tokens.
    <ThemeProvider theme="product">
      <WorkQueue
        title="Tenants to activate"
        subtitle={`${count} tenant${count === 1 ? '' : 's'} still finishing activation`}
        state={state}
        sections={sections}
        emptyTitle="Everyone is activated"
        emptyBody="No invited tenant is waiting to complete activation."
        onRetry={() => refetch()}
      />
    </ThemeProvider>
  );
}
