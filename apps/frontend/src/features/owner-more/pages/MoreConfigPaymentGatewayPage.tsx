import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { CreditCard } from 'lucide-react';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const card = 'overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/**
 * Configuration > Finance > Payment gateway — intentionally static. There is
 * no self-serve "connect your own gateway" flow in this product; the real
 * payment provider is configured platform-side. No toggle, no fake
 * "Connect" button, no third-party provider branding.
 */
export function MoreConfigPaymentGatewayPage() {
  
  const policyQuery = useHostelPolicy(useConfiguredHostelId());
  const upiId = policyQuery.data?.policy?.payments?.upi_id;

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more/configuration/finance" backLabel="Finance" title="Payment gateway" subtitle="How tenants pay you" />

      <div className={`${card} px-[22px] py-[26px] text-center`}>
        <div className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <CreditCard className="h-6 w-6 text-primary" strokeWidth={1.8} />
        </div>
        <div className="font-display text-base font-bold tracking-tight text-foreground">Payments enabled by Stayo</div>
        <p className="mx-auto mt-1.5 max-w-[260px] text-[12.5px] leading-relaxed text-muted-foreground">
          Your payment provider is set up and managed for you as part of your Stayo account. To change how tenants pay, contact Stayo support.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Currently accepted</span>
        <div className={card}>
          <div className="px-4 py-3.5 text-[13.5px] font-semibold text-foreground">
            UPI{upiId ? ` (${upiId})` : ''} · Cash · Bank transfer
          </div>
        </div>
      </div>
    </div>
  );
}
