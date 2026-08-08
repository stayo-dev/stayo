import { BillingPolicyForm } from './BillingPolicyForm';

/** Finance › Security deposit — months of rent collected at move-in. */
export function MoreConfigDepositPage() {
  return (
    <BillingPolicyForm
      sections={['deposit']}
      title="Security deposit"
      subtitle="What you collect at move-in"
      backTo="/owner/more/configuration/finance"
      backLabel="Finance"
    />
  );
}
