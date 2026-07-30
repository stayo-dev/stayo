import type { TimelineEvent } from './financialColors';

/**
 * A payment, its settlement allocation, any future credit it created/consumed,
 * and its receipt are one operational event to the owner — this folds the flat
 * TimelineEvent[] from GET /api/tenants/[id]/financial-timeline into grouped
 * "Financial Activity" entries. Pure client-side fold, no backend change
 * (see plan §3 "Financial Activity — grouped entries").
 */
export interface FinancialActivityEntry {
  /** Stable id for React keys / expand-state tracking */
  id: string;
  timestamp: string;
  /** The primary event this card represents (PAYMENT_GROUP_SETTLED when grouped, else itself) */
  primary: TimelineEvent;
  /** PAYMENT_RECORDED events folded into this group (empty for ungrouped entries) */
  payments: TimelineEvent[];
  /** LEDGER_CREDIT/LEDGER_DEBIT future-credit events folded into this group */
  credits: TimelineEvent[];
  /** Any one payment id from this group — receipts for a grouped settlement can be
   *  fetched from any single payment id in the group (see plan's verified findings). */
  receiptPaymentId: string | null;
}

const FUTURE_CREDIT_REFERENCE_TYPES = new Set([
  'PAYMENT_GROUP',
  'PAYMENT_GROUP_REMAINDER',
]);

export function groupFinancialActivity(events: TimelineEvent[]): FinancialActivityEntry[] {
  const settledGroups = new Map<string, TimelineEvent>();
  for (const event of events) {
    if (event.type === 'PAYMENT_GROUP_SETTLED' && event.references.payment_group_id) {
      settledGroups.set(event.references.payment_group_id, event);
    }
  }

  const paymentsByGroup = new Map<string, TimelineEvent[]>();
  const creditsByGroup = new Map<string, TimelineEvent[]>();
  const consumedIds = new Set<string>();

  for (const event of events) {
    if (event.type === 'PAYMENT_RECORDED') {
      const groupId = event.references.payment_group_id;
      if (groupId && settledGroups.has(groupId)) {
        const list = paymentsByGroup.get(groupId) ?? [];
        list.push(event);
        paymentsByGroup.set(groupId, list);
        consumedIds.add(event.id);
      }
      continue;
    }
    if (event.type === 'LEDGER_CREDIT' || event.type === 'LEDGER_DEBIT') {
      const referenceType = event.metadata?.reference_type as string | undefined;
      const referenceId = event.metadata?.reference_id as string | undefined;
      if (referenceId && referenceType && FUTURE_CREDIT_REFERENCE_TYPES.has(referenceType) && settledGroups.has(referenceId)) {
        const list = creditsByGroup.get(referenceId) ?? [];
        list.push(event);
        creditsByGroup.set(referenceId, list);
        consumedIds.add(event.id);
      }
    }
  }

  const entries: FinancialActivityEntry[] = [];
  for (const event of events) {
    if (consumedIds.has(event.id)) continue;

    if (event.type === 'PAYMENT_GROUP_SETTLED' && event.references.payment_group_id) {
      const groupId = event.references.payment_group_id;
      const payments = paymentsByGroup.get(groupId) ?? [];
      entries.push({
        id: event.id,
        timestamp: event.timestamp,
        primary: event,
        payments,
        credits: creditsByGroup.get(groupId) ?? [],
        receiptPaymentId: payments[0]?.references.payment_id ?? null,
      });
      continue;
    }

    entries.push({
      id: event.id,
      timestamp: event.timestamp,
      primary: event,
      payments: [],
      credits: [],
      receiptPaymentId: event.type === 'PAYMENT_RECORDED' ? event.references.payment_id ?? null : null,
    });
  }

  return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
