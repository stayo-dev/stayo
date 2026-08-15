/**
 * The admin dashboard's "Needs you" section.
 *
 * The old dashboard was nine static counters — a reading exercise that left
 * the admin to go hunting for what actually required them. This turns the same
 * data into a short list of queues, each of which ends in a decision.
 *
 * Two rules it enforces:
 *
 *  - **An item only appears when there is something to do.** A queue at zero
 *    is not shown; a permanent row reading "0 pending" trains people to skip
 *    the section that is supposed to be the reason they opened the page.
 *  - **Every item routes to the screen that clears it**, not to a general
 *    list the admin then has to filter by hand.
 */

export interface AdminKpis {
  new_leads?: number;
  pending_approvals?: number;
  documents_awaiting_review?: number;
  pending_dues?: number;
}

export type QueueSeverity = 'high' | 'medium' | 'low';

export interface AttentionItem {
  code: 'HOSTEL_APPROVALS' | 'DOCUMENT_REVIEW' | 'OWNERS_AT_RISK' | 'NEW_LEADS' | 'PLATFORM_DUES';
  label: string;
  count: number;
  /** Where it gets cleared. */
  to: string;
  severity: QueueSeverity;
}

const SEVERITY_ORDER: Record<QueueSeverity, number> = { high: 0, medium: 1, low: 2 };

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function deriveAttention(kpis: AdminKpis, ownersNeedingAttention = 0): AttentionItem[] {
  const items: AttentionItem[] = [];

  const documents = Number(kpis.documents_awaiting_review ?? 0);
  if (documents > 0) {
    items.push({
      code: 'DOCUMENT_REVIEW',
      // Only the admin can clear this, and it blocks the owner from going
      // live — so it outranks everything else.
      label: plural(documents, 'document to verify', 'documents to verify'),
      count: documents,
      to: '/admin/documents',
      severity: 'high',
    });
  }

  const approvals = Number(kpis.pending_approvals ?? 0);
  if (approvals > 0) {
    items.push({
      code: 'HOSTEL_APPROVALS',
      label: plural(approvals, 'hostel awaiting approval', 'hostels awaiting approval'),
      count: approvals,
      // Routed at the owner, not a hostel list. Approving is done from the
      // owner's own profile, where the admin can see whose property it is and
      // what else that account needs — and it avoids a cross-screen filter
      // link that silently stops filtering if the query param goes unread.
      to: '/admin/owners',
      severity: 'high',
    });
  }

  if (ownersNeedingAttention > 0) {
    items.push({
      code: 'OWNERS_AT_RISK',
      label: plural(ownersNeedingAttention, 'owner needs attention', 'owners need attention'),
      count: ownersNeedingAttention,
      to: '/admin/owners',
      severity: 'medium',
    });
  }

  const leads = Number(kpis.new_leads ?? 0);
  if (leads > 0) {
    items.push({
      code: 'NEW_LEADS',
      label: plural(leads, 'new lead', 'new leads'),
      count: leads,
      to: '/admin/leads',
      severity: 'medium',
    });
  }

  const dues = Number(kpis.pending_dues ?? 0);
  if (dues > 0) {
    items.push({
      code: 'PLATFORM_DUES',
      label: 'Unpaid platform invoices',
      count: dues,
      to: '/admin/revenue',
      severity: 'low',
    });
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * The snapshot row — kept to four figures.
 *
 * Deliberately excludes tenant counts. Tenants belong to owners, not to Stayo:
 * "791 tenants" tells an admin nothing they can act on, and it crowded out the
 * numbers that describe the platform's own business.
 */
export interface SnapshotFigure {
  label: string;
  value: string;
  to: string;
}

export function deriveSnapshot(
  kpis: { owners_total?: number; active_hostels?: number; platform_revenue?: number; collections?: number },
  formatMoney: (value: number) => string,
): SnapshotFigure[] {
  return [
    { label: 'Owners', value: String(kpis.owners_total ?? 0), to: '/admin/owners' },
    { label: 'Live hostels', value: String(kpis.active_hostels ?? 0), to: '/admin/owners' },
    { label: 'MRR', value: formatMoney(Number(kpis.platform_revenue ?? 0)), to: '/admin/revenue' },
    { label: 'Collected', value: formatMoney(Number(kpis.collections ?? 0)), to: '/admin/revenue' },
  ];
}
