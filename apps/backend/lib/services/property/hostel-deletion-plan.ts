/**
 * Whether a hostel may be deleted for good.
 *
 * `DELETE /api/hostels/:id` **archives** — it always has. That is right for a
 * property that carried real tenancies: obligations, payments and agreements
 * must outlive the hostel they happened in. But it left no way at all to get
 * rid of a hostel that never carried anything: a test entry, a typo, a
 * duplicate. Those sit in the owner's Archived tab permanently, where the only
 * offered action is Reactivate.
 *
 * So there is a second, narrower door. It opens only for a hostel with **no
 * operational history whatsoever**, and only once the hostel is already
 * archived — deletion is deliberately a two-step, so nothing live can be
 * destroyed in one press.
 *
 * Pure and separate from the writes for the usual reason: this repo has no
 * provisioned test database, and "what makes a permanent delete safe" is
 * exactly the logic that must not go untested.
 */

/** Everything that would make a hostel worth keeping a record of. */
export interface HostelHistory {
  tenants: number;
  payments: number;
  obligations: number;
  allocations: number;
  agreements: number;
  receipts: number;
  expenses: number;
  leads: number;
}

export type HostelDeletionPlan =
  | { ok: true }
  | { ok: false; code: 'VALIDATION' | 'CONFLICT'; reason: string };

/**
 * Checked in this order so the owner is told the *most actionable* reason
 * first: archive it, versus "this one can never be deleted".
 */
const HISTORY_LABELS: Array<{ key: keyof HostelHistory; singular: string; plural: string }> = [
  { key: 'tenants', singular: 'tenant record', plural: 'tenant records' },
  { key: 'payments', singular: 'payment', plural: 'payments' },
  { key: 'obligations', singular: 'rent obligation', plural: 'rent obligations' },
  { key: 'allocations', singular: 'room allocation', plural: 'room allocations' },
  { key: 'agreements', singular: 'agreement', plural: 'agreements' },
  { key: 'receipts', singular: 'receipt', plural: 'receipts' },
  { key: 'expenses', singular: 'expense', plural: 'expenses' },
  { key: 'leads', singular: 'enquiry', plural: 'enquiries' },
];

export function planHostelDeletion(input: {
  status: string;
  history: HostelHistory;
}): HostelDeletionPlan {
  // Two steps on purpose. Archiving is reversible and already carries its own
  // guard (no active allocations); this second step cannot be reached from a
  // live property at all.
  if (input.status !== 'ARCHIVED') {
    return {
      ok: false,
      code: 'VALIDATION',
      reason: 'Archive this hostel first — only an archived hostel can be deleted for good.',
    };
  }

  for (const { key, singular, plural } of HISTORY_LABELS) {
    const count = input.history[key] ?? 0;
    if (count > 0) {
      const noun = count === 1 ? singular : plural;
      return {
        ok: false,
        code: 'CONFLICT',
        reason:
          `This hostel has ${count} ${noun} on record, so it cannot be deleted. ` +
          `It stays archived, and its history stays intact.`,
      };
    }
  }

  return { ok: true };
}

/** True when nothing in the history block is non-zero. */
export function hasNoHistory(history: HostelHistory): boolean {
  return HISTORY_LABELS.every(({ key }) => (history[key] ?? 0) === 0);
}
