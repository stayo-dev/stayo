import { BillingPolicyForm } from './BillingPolicyForm';

/**
 * "All billing settings" — every section on one screen.
 *
 * Kept because ADR-043's consolidation is still the right *data* model (one
 * screen that can safely write the whole `billing` object), and because an
 * owner sometimes wants to review everything at once. But it is no longer the
 * deep-link target for individual Finance rows: each of those now opens its own
 * focused screen (see billingSections.ts), so tapping "Security deposit" no
 * longer lands in a six-section wall.
 */
export function MoreConfigBillingPolicyPage() {
  return (
    <BillingPolicyForm
      sections={['schedule', 'collection', 'deposit', 'lateFee', 'agreement']}
      title="All billing settings"
      subtitle="How rent is collected, charged and enforced"
    />
  );
}
