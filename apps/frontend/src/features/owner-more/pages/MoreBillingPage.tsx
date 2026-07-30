import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { Toggle } from '@features/owner-food/components/Toggle';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const row = 'flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-none';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/**
 * More → Settings → Rent and billing, per Stayo App.dc.html. Real data via
 * `useHostelPolicy`/`useUpdateHostelPolicy` (`GET`/`PATCH /hostels/:id/
 * preferences`, deep-merged server-side). Scoped to the owner's primary
 * hostel — the original design has no hostel picker on this screen, so
 * multi-hostel owners editing a *specific* hostel's billing policy is a
 * follow-up, not silently faked here.
 */
export function MoreBillingPage() {
  const navigate = useNavigate();
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const [lateFeeEnabled, setLateFeeEnabled] = useState(false);
  const [lateFeeAmount, setLateFeeAmount] = useState('0');

  useEffect(() => {
    const lateFee = policyQuery.data?.policy?.billing?.late_fee;
    if (lateFee) {
      setLateFeeEnabled(lateFee.enabled);
      setLateFeeAmount(String(lateFee.rules?.[0]?.amount ?? 0));
    }
  }, [policyQuery.data]);

  const billing = policyQuery.data?.policy?.billing;

  const save = () => {
    if (!hostelId) return;
    updateMutation.mutate(
      {
        billing: {
          late_fee: lateFeeEnabled
            ? { enabled: true, rules: [{ type: 'FLAT', amount: Number(lateFeeAmount) || 0, starts_after_days: billing?.grace_days ?? 0 }] }
            : { enabled: false },
        },
      },
      {
        onSuccess: () => {
          stayoToast.success('Billing settings saved');
          navigate('/owner/more/settings');
        },
        onError: () => stayoToast.error('Could not save billing settings'),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-28 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more/settings" backLabel="Settings" title="Rent and billing" subtitle="Applies to all new invoices" />

      {policyQuery.isLoading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Schedule</span>
            <div className={card}>
              <div className={row}>
                <span className="flex-1 text-[13.5px] text-foreground/80">Generation day</span>
                <span className="font-display text-[13.5px] font-bold text-foreground">{billing?.auto_rent_day ?? '—'}</span>
              </div>
              <div className={row}>
                <span className="flex-1 text-[13.5px] text-foreground/80">Due day</span>
                <span className="font-display text-[13.5px] font-bold text-foreground">{billing?.due_day ?? '—'}</span>
              </div>
              <div className={row}>
                <span className="flex-1 text-[13.5px] text-foreground/80">Grace period</span>
                <span className="font-display text-[13.5px] font-bold text-foreground">{billing?.grace_days ?? '—'} days</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Late fee</span>
            <div className={card}>
              <Toggle checked={lateFeeEnabled} onChange={() => setLateFeeEnabled((v) => !v)} label="Charge late fee" sub="After the grace period ends" />
              {lateFeeEnabled && (
                <div className={row}>
                  <span className="flex-1 text-[13.5px] text-foreground/80">Amount</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[13.5px] font-bold text-muted-foreground">₹</span>
                    <input
                      value={lateFeeAmount}
                      onChange={(e) => setLateFeeAmount(e.target.value.replace(/[^0-9]/g, ''))}
                      inputMode="numeric"
                      className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-right font-display text-[13.5px] font-bold tabular-nums text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-20 border-t border-[#EAE1D8] bg-[#FFFDFB] px-5 pb-[30px] pt-3 sm:mx-auto sm:max-w-[480px] sm:px-6">
        <button
          type="button"
          onClick={save}
          disabled={updateMutation.isPending || policyQuery.isLoading}
          className="w-full rounded-xl bg-[#A45D44] py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
