import { useNavigate } from 'react-router-dom';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { readPartialPolicy, policyHeadline, BILLING_POLICY_PATH } from '../billing-policy/billingPolicy';

const card = 'overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

const LATE_FEE_TYPE_LABEL: Record<string, string> = { PER_DAY: '/day', FLAT: 'one-time', PERCENTAGE: '% of rent' };

/** Configuration > Finance — real rent/deposit/late-fee/receipt data via useHostelPolicy. */
export function MoreConfigFinancePage() {
  const navigate = useNavigate();
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const policy = policyQuery.data?.policy;
  const hostel = policyQuery.data?.hostel;
  const billing = policy?.billing;
  const lateFee = billing?.late_fee;
  const lateFeeRule = lateFee?.rules?.[0];
  const partialLabel = policyHeadline(readPartialPolicy(policy));

  const row = (i: number) => (i === 0 ? '' : 'border-t border-border/60');

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more/configuration" backLabel="Configuration" title="Finance" subtitle="How money moves through your business" />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Money in</span>
        <div className={card}>
          <ListRow
            title="Rent rules"
            meta={billing ? `Generated ${billing.auto_rent_day}st · Due on ${billing.due_day}th · ${billing.grace_days}-day grace` : 'Loading…'}
            showChevron
            onClick={() => navigate(BILLING_POLICY_PATH)}
            className={`px-4 ${row(0)}`}
          />
          <ListRow
            title="Security deposit"
            meta={
              billing?.deposit
                ? `${billing.deposit.deposit_months ?? 1} month${(billing.deposit.deposit_months ?? 1) === 1 ? '' : 's'} · ${billing.deposit.refundable ? 'Refundable' : 'Non-refundable'}`
                : 'Loading…'
            }
            showChevron
            onClick={() => navigate(BILLING_POLICY_PATH)}
            className={`px-4 ${row(1)}`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Billing</span>
        <div className={card}>
          <ListRow
            title="Billing policy"
            meta={
              lateFee?.enabled && lateFeeRule?.amount
                ? `${partialLabel} · late fee ₹${lateFeeRule.amount}${LATE_FEE_TYPE_LABEL[lateFeeRule.type] ?? ''}`
                : `${partialLabel} · no late fee`
            }
            showChevron
            onClick={() => navigate(BILLING_POLICY_PATH)}
            className={`px-4 ${row(0)}`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Getting paid</span>
        <div className={card}>
          <ListRow title="Payment methods" meta="UPI · Cash · Bank transfer" className={`px-4 ${row(0)}`} />
          <ListRow
            title="Payment gateway"
            showChevron
            onClick={() => navigate('/owner/more/configuration/finance/payment-gateway')}
            className={`px-4 ${row(1)}`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Compliance &amp; receipts</span>
        <div className={card}>
          <ListRow
            title="Receipts"
            meta={policy?.receipts ? `${policy.receipts.prefix}-${policy.receipts.format} · ${policy.receipts.auto_email ? 'Auto-emailed' : 'Manual'}` : 'Loading…'}
            showChevron
            onClick={() => navigate('/owner/more/configuration/finance/receipt-footer')}
            className={`px-4 ${row(0)}`}
          />
          <ListRow
            title="GST"
            meta={hostel?.gst_number ?? 'Not added'}
            showChevron
            onClick={() => navigate('/owner/more/hostel')}
            className={`px-4 ${row(1)}`}
          />
        </div>
      </div>
    </div>
  );
}
