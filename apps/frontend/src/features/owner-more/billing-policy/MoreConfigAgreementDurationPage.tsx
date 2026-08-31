import { BillingPolicyForm } from './BillingPolicyForm';

/**
 * Hostel › Agreement duration — the default lease length offered to new tenants.
 *
 * Lives under Hostel because it is a tenancy default, not money movement. The
 * deposit deliberately stays in Finance so exactly one screen owns each field.
 */
export function MoreConfigAgreementDurationPage() {
  return (
    <BillingPolicyForm
      sections={['agreement']}
      title="Agreement duration"
      subtitle="Default lease length offered to new tenants"
    />
  );
}
