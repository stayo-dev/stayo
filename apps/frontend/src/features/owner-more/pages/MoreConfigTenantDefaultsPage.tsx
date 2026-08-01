import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { Stepper } from '../components/Stepper';

const card = 'overflow-hidden rounded-[16px] border border-border bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** Configuration > Hostel > Tenant defaults — deposit months & agreement duration used to prefill new tenant invites. */
export function MoreConfigTenantDefaultsPage() {
  const navigate = useNavigate();
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const [depositMonths, setDepositMonths] = useState(1);
  const [agreementMonths, setAgreementMonths] = useState(3);

  useEffect(() => {
    const billing = policyQuery.data?.policy?.billing;
    if (billing) {
      setDepositMonths(billing.deposit?.deposit_months ?? 1);
      setAgreementMonths(billing.invite_defaults?.agreement_duration_months ?? 3);
    }
  }, [policyQuery.data]);

  const save = () => {
    if (!hostelId) return;
    updateMutation.mutate(
      {
        billing: {
          deposit: { deposit_months: depositMonths },
          invite_defaults: { agreement_duration_months: agreementMonths },
        },
      },
      {
        onSuccess: () => {
          stayoToast.success('Tenant defaults saved');
          navigate('/owner/more/configuration/hostel');
        },
        onError: () => stayoToast.error('Could not save tenant defaults'),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-28 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more/configuration/hostel" backLabel="Hostel" title="Tenant defaults" subtitle="Prefilled automatically when you invite a new tenant" />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Security deposit</span>
        <div className={`${card} flex items-center justify-between gap-3`}>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">Months of rent</div>
            <div className="text-[11px] text-muted-foreground">Default deposit collected at move-in</div>
          </div>
          <Stepper value={depositMonths} onChange={setDepositMonths} min={1} max={12} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Agreement</span>
        <div className={`${card} flex items-center justify-between gap-3`}>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">Duration (months)</div>
            <div className="text-[11px] text-muted-foreground">Default lease length offered to new tenants</div>
          </div>
          <Stepper value={agreementMonths} onChange={setAgreementMonths} min={1} max={120} />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-5 pb-8 pt-3">
        <button
          type="button"
          onClick={save}
          disabled={updateMutation.isPending}
          className="w-full rounded-xl bg-[#A45D44] py-3.5 text-center font-display text-sm font-bold text-white shadow-[0_6px_16px_rgba(164,93,68,0.28)] disabled:opacity-60"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save tenant defaults'}
        </button>
      </div>
    </div>
  );
}
