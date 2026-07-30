// frontend-v2/src/features/tenants/components/profile/UnifiedActivityTimeline.tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, ListFilter, Banknote, ReceiptText, Wallet, FileCheck2,
  UserPlus, Bed, FileUp, FileCheck, LogOut, ShieldAlert, Send, Calendar,
  type LucideIcon,
} from 'lucide-react';
import { groupFinancialActivity } from '@features/tenants/utils/groupFinancialActivity';
import type { TimelineEvent } from '@features/tenants/utils/financialColors';
import { FinancialActivityCard } from '@features/tenants/components/financial/FinancialActivityCard';
import { activityListService } from '@features/activity/api';
import { queryKeys } from '@lib/queryKeys';

interface LedgerEntry {
  id: string;
  balance_after: number;
}

type FilterCategory = 'all' | 'payments' | 'ledger' | 'obligations' | 'agreement' | 'kyc' | 'room_stay' | 'system';

const FILTER_CHIPS: { id: FilterCategory; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'All', icon: ListFilter },
  { id: 'payments', label: 'Payments', icon: Banknote },
  { id: 'ledger', label: 'Ledger', icon: Wallet },
  { id: 'obligations', label: 'Charges', icon: ReceiptText },
  { id: 'agreement', label: 'Agreement', icon: FileCheck2 },
  { id: 'kyc', label: 'KYC', icon: FileCheck },
  { id: 'room_stay', label: 'Room & Stay', icon: Bed },
  { id: 'system', label: 'System', icon: ShieldAlert },
];

function matchesFinancialFilter(event: TimelineEvent, filter: FilterCategory): boolean {
  if (filter === 'payments') return event.type === 'PAYMENT_RECORDED' || event.type === 'PAYMENT_GROUP_SETTLED';
  if (filter === 'ledger') return event.type === 'LEDGER_CREDIT' || event.type === 'LEDGER_DEBIT';
  if (filter === 'obligations') return event.type === 'OBLIGATION_CREATED' || event.type === 'OBLIGATION_WAIVED' || event.type === 'OBLIGATION_CANCELLED';
  if (filter === 'agreement') return event.type === 'CHANGE_REQUEST';
  return false;
}

interface GeneralEvent {
  id: string;
  timestamp: string;
  title: string;
  subtitle?: string;
  category: 'stay' | 'documents' | 'system';
  icon: LucideIcon;
  color: string;
}

function buildGeneralEvents(params: {
  joinedOn?: string;
  allocations: Record<string, any>[];
  documents: Record<string, any>[];
  moveOutRequest?: Record<string, any> | null;
  invitations: Record<string, any>[];
  tenantStatus: string;
  systemLogs: Record<string, any>[];
  tenantId: string;
  tenantName: string;
}): GeneralEvent[] {
  const { joinedOn, allocations, documents, moveOutRequest, invitations, tenantStatus, systemLogs, tenantId, tenantName } = params;
  const list: GeneralEvent[] = [];

  if (joinedOn) {
    const d = new Date(joinedOn);
    if (!isNaN(d.getTime())) {
      list.push({
        id: `join-${joinedOn}`,
        timestamp: d.toISOString(),
        title: 'Joined Hostel & Created Profile',
        subtitle: 'Tenant onboarding initiated',
        category: 'system',
        icon: UserPlus,
        color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
      });
    }
  }

  allocations.forEach((alloc, idx) => {
    const createdDate = new Date(alloc.created_at ?? alloc.assigned_at);
    if (!isNaN(createdDate.getTime())) {
      list.push({
        id: `alloc-in-${idx}-${createdDate.getTime()}`,
        timestamp: createdDate.toISOString(),
        title: `Room Allocation: Room ${alloc.room_no || 'Assigned'}`,
        subtitle: `Checked in to floor ${alloc.floor ?? '—'} · Rent: ₹${(alloc.monthly_rent ?? 0).toLocaleString('en-IN')}`,
        category: 'stay',
        icon: Bed,
        color: 'text-accent bg-accent/10 border-accent/20',
      });
    }
    if (alloc.vacated_at) {
      const vacatedDate = new Date(alloc.vacated_at);
      if (!isNaN(vacatedDate.getTime())) {
        list.push({
          id: `alloc-out-${idx}-${vacatedDate.getTime()}`,
          timestamp: vacatedDate.toISOString(),
          title: `Vacated Room ${alloc.room_no}`,
          subtitle: 'Checked out / changed room allocation',
          category: 'stay',
          icon: LogOut,
          color: 'text-zinc-600 bg-zinc-500/10 border-zinc-500/20',
        });
      }
    }
  });

  documents.forEach((doc, idx) => {
    const createdDate = new Date(doc.created_at);
    const docTypeLabel = String(doc.doc_type ?? doc.type ?? 'Document').replace(/_/g, ' ');
    if (!isNaN(createdDate.getTime())) {
      list.push({
        id: `doc-upload-${idx}-${createdDate.getTime()}`,
        timestamp: createdDate.toISOString(),
        title: `${docTypeLabel} Submitted`,
        subtitle: 'Document uploaded for verification',
        category: 'documents',
        icon: FileUp,
        color: 'text-sky-600 bg-sky-500/10 border-sky-500/20',
      });
    }
    const status = String(doc.document_status ?? doc.status ?? '').toUpperCase();
    if (status === 'APPROVED' || doc.is_verified === true) {
      const verifiedDate = new Date(doc.updated_at ?? doc.created_at);
      if (!isNaN(verifiedDate.getTime())) {
        list.push({
          id: `doc-verify-${idx}-${verifiedDate.getTime()}`,
          timestamp: verifiedDate.toISOString(),
          title: `${docTypeLabel} Approved`,
          subtitle: 'Document verified and marked active by hostel owner',
          category: 'documents',
          icon: FileCheck,
          color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
        });
      }
    }
  });

  if (moveOutRequest) {
    const reqDate = new Date(moveOutRequest.created_at ?? moveOutRequest.requested_at);
    if (!isNaN(reqDate.getTime())) {
      list.push({
        id: 'move-out-request-timeline',
        timestamp: reqDate.toISOString(),
        title: 'Move-out Notice Submitted',
        subtitle: `Requested vacating date: ${moveOutRequest.vacating_date ? new Date(moveOutRequest.vacating_date).toLocaleDateString('en-IN') : 'Not specified'}`,
        category: 'stay',
        icon: LogOut,
        color: 'text-rose-600 bg-rose-500/10 border-rose-500/20',
      });
    }
  }

  invitations.forEach((invite, index) => {
    const createdDate = new Date(invite.created_at);
    if (!isNaN(createdDate.getTime())) {
      const isActive = index === 0;
      const label = isActive
        ? tenantStatus === 'ACTIVE'
          ? 'Invitation Accepted'
          : tenantStatus === 'CANCELLED'
            ? 'Invitation Cancelled'
            : 'Invitation Sent'
        : 'Invitation Superseded';
      list.push({
        id: `invitation-${invite.id}`,
        timestamp: createdDate.toISOString(),
        title: label,
        subtitle: `Room ${invite.room?.room_no || 'Unassigned'} · Rent ₹${Number(invite.monthly_rent ?? 0).toLocaleString('en-IN')}`,
        category: 'system',
        icon: Send,
        color: isActive ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' : 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20',
      });
    }
  });

  const filteredLogs = systemLogs.filter(
    (e) => String(e.tenant_id ?? '') === tenantId || String(e.tenant_name ?? '').toLowerCase().includes(tenantName.toLowerCase()),
  );
  filteredLogs.forEach((log, idx) => {
    const logDate = new Date(log.created_at);
    if (!isNaN(logDate.getTime())) {
      const logMessage = String(log.detail ?? log.message ?? log.type ?? '');
      // Payments and onboarding are already represented by the financial-event
      // path and the synthetic "Joined Hostel" entry above — skip the
      // duplicate system-log line instead of showing the same fact twice.
      if (logMessage.toLowerCase().includes('payment')) return;
      if (logMessage.toLowerCase().includes('onboard') && joinedOn) return;
      list.push({
        id: `system-log-${idx}-${logDate.getTime()}`,
        timestamp: logDate.toISOString(),
        title: logMessage,
        subtitle: 'System logged event',
        category: 'system',
        icon: ShieldAlert,
        color: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20',
      });
    }
  });

  return list;
}

type UnifiedEntry =
  | { kind: 'financial'; timestamp: string; financial: ReturnType<typeof groupFinancialActivity>[number] }
  | { kind: 'general'; timestamp: string; general: GeneralEvent };

interface UnifiedActivityTimelineProps {
  events: TimelineEvent[];
  ledgerEntries: LedgerEntry[];
  isLoading?: boolean;
  onDownloadReceipt?: (paymentId: string) => void;
  onViewObligation?: (obligationId: string) => void;
  onCorrectPayment?: (paymentId: string) => void;
  hostelId: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  joinedOn?: string;
  documents?: Record<string, any>[];
  allocations?: Record<string, any>[];
  moveOutRequest?: Record<string, any> | null;
  invitations?: Record<string, any>[];
}

const PAGE_SIZE = 8;

/**
 * Replaces the former Financial Activity, Ledger & Accounting Statement, and
 * Recent Activity sections (and the standalone Invitation History card) —
 * one chronological, filterable feed instead of four overlapping ones.
 */
export function UnifiedActivityTimeline({
  events,
  ledgerEntries,
  isLoading,
  onDownloadReceipt,
  onViewObligation,
  onCorrectPayment,
  hostelId,
  tenantId,
  tenantName,
  tenantStatus,
  joinedOn,
  documents = [],
  allocations = [],
  moveOutRequest,
  invitations = [],
}: UnifiedActivityTimelineProps) {
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: systemLogsData, isLoading: systemLogsLoading } = useQuery({
    queryKey: queryKeys.tenants.activity(hostelId, tenantId),
    queryFn: () => activityListService.getList(hostelId, { tenantId, limit: 50 }),
    staleTime: 60_000,
  });
  const systemLogs = (Array.isArray(systemLogsData) ? systemLogsData : (systemLogsData as Record<string, any>)?.items ?? (systemLogsData as Record<string, any>)?.activity ?? []) as Record<string, any>[];

  const grouped = useMemo(() => groupFinancialActivity(events), [events]);

  const generalEvents = useMemo(
    () => buildGeneralEvents({ joinedOn, allocations, documents, moveOutRequest, invitations, tenantStatus, systemLogs, tenantId, tenantName }),
    [joinedOn, allocations, documents, moveOutRequest, invitations, tenantStatus, systemLogs, tenantId, tenantName],
  );

  const balanceByLedgerEntryId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of ledgerEntries) map.set(entry.id, entry.balance_after);
    return map;
  }, [ledgerEntries]);

  const merged = useMemo<UnifiedEntry[]>(() => {
    const financial: UnifiedEntry[] = grouped.map((entry) => ({ kind: 'financial', timestamp: entry.timestamp, financial: entry }));
    const general: UnifiedEntry[] = generalEvents.map((event) => ({ kind: 'general', timestamp: event.timestamp, general: event }));
    return [...financial, ...general].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [grouped, generalEvents]);

  const filtered = useMemo(
    () =>
      merged.filter((item) => {
        if (activeFilter === 'all') return true;
        if (item.kind === 'financial') return matchesFinancialFilter(item.financial.primary, activeFilter);
        if (activeFilter === 'kyc') return item.general.category === 'documents';
        if (activeFilter === 'room_stay') return item.general.category === 'stay';
        if (activeFilter === 'system') return item.general.category === 'system';
        return false;
      }),
    [merged, activeFilter],
  );

  const visible = filtered.slice(0, visibleCount);
  const loading = Boolean(isLoading) || systemLogsLoading;

  return (
    <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h3 className="text-sm font-bold text-foreground">Activity</h3>
      </div>

      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {FILTER_CHIPS.map((chip) => {
          const ChipIcon = chip.icon;
          const isSelected = activeFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => {
                setActiveFilter(chip.id);
                setVisibleCount(PAGE_SIZE);
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                isSelected
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/10'
              }`}
            >
              <ChipIcon className="w-3.5 h-3.5" />
              <span>{chip.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-10">
          <Calendar className="w-7 h-7 text-muted-foreground opacity-50 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No activity recorded yet for this filter.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1 scrollbar-hide">
          {visible.map((item) => {
            if (item.kind === 'financial') {
              const entry = item.financial;
              const isLedger = entry.primary.type === 'LEDGER_CREDIT' || entry.primary.type === 'LEDGER_DEBIT';
              const balanceAfter = isLedger ? balanceByLedgerEntryId.get(entry.primary.references.ledger_entry_id ?? '') ?? null : null;
              return (
                <FinancialActivityCard
                  key={entry.id}
                  entry={entry}
                  balanceAfter={balanceAfter}
                  isExpanded={expandedId === entry.id}
                  onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  onDownloadReceipt={onDownloadReceipt}
                  onViewObligation={onViewObligation}
                  onCorrectPayment={onCorrectPayment}
                />
              );
            }
            const event = item.general;
            const Icon = event.icon;
            return (
              <div key={event.id} className="flex items-start gap-3 p-3.5 rounded-2xl border border-border bg-card">
                <div className={`p-1.5 rounded-lg shrink-0 border ${event.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-bold text-foreground">{event.title}</p>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  {event.subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{event.subtitle}</p>}
                </div>
              </div>
            );
          })}
          {filtered.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="w-full py-2 text-xs font-semibold text-accent hover:underline"
            >
              Load more ↓
            </button>
          )}
        </div>
      )}
    </div>
  );
}
