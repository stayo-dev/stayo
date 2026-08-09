import { BillingPolicyForm } from './BillingPolicyForm';

/**
 * Finance › Late fees — charge type, amount and cap.
 *
 * This route previously redirected to the combined billing screen. It writes the
 * complete late-fee shape (type + amount + cap together), which is what stops it
 * repeating the bug ADR-043 fixed, where a partial write reset the charge type.
 */
export function MoreConfigLateFeePage() {
  return (
    <BillingPolicyForm
      sections={['lateFee']}
      title="Late fees"
      subtitle="What a tenant is charged for paying late"
      backTo="/owner/more/configuration/finance"
      backLabel="Finance"
    />
  );
}
