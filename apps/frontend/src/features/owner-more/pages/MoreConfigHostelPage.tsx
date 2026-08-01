import { useNavigate } from 'react-router-dom';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { Toggle } from '@features/owner-food/components/Toggle';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { useHostelBedSummary } from '../hooks/useHostelBedSummary';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** Configuration > Hostel — identity (links to the existing real screen), refund policy, tenant defaults. */
export function MoreConfigHostelPage() {
  const navigate = useNavigate();
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');
  const { bedsTotal } = useHostelBedSummary(hostelId);

  const hostel = policyQuery.data?.hostel;
  const billing = policyQuery.data?.policy?.billing;
  const refundable = billing?.deposit?.refundable ?? false;

  const toggleRefundable = () => {
    if (!hostelId) return;
    updateMutation.mutate(
      { billing: { deposit: { refundable: !refundable } } },
      {
        onSuccess: () => stayoToast.success(!refundable ? 'Deposit is now refundable' : 'Deposit is now non-refundable'),
        onError: () => stayoToast.error('Could not update refund policy'),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more/configuration" backLabel="Configuration" title="Hostel" subtitle="Your physical property setup" />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Identity &amp; property</span>
        <div className={card}>
          <ListRow
            leading={<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary font-display text-sm font-bold text-primary">H</span>}
            title="Hostel identity"
            meta={hostel ? `${hostel.name} · ${bedsTotal} bed${bedsTotal === 1 ? '' : 's'}` : 'Loading…'}
            showChevron
            onClick={() => navigate('/owner/more/hostel')}
            className="px-4"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Rules &amp; defaults</span>
        <div className={card}>
          <Toggle
            checked={refundable}
            onChange={toggleRefundable}
            label="Refundable security deposit"
            sub="Deposit is returned to the tenant at move-out"
          />
        </div>
        <div className={card}>
          <ListRow
            leading={<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary font-display text-xs font-bold text-primary">TD</span>}
            title="Tenant defaults"
            meta="Deposit months & agreement duration"
            showChevron
            onClick={() => navigate('/owner/more/configuration/hostel/tenant-defaults')}
            className="px-4"
          />
        </div>
      </div>
    </div>
  );
}
