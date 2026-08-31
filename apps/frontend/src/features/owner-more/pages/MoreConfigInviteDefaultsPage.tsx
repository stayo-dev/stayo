import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { useHostelBedSummary } from '../hooks/useHostelBedSummary';
import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { hasChanges } from '../config/dirtyState';
import {
  toInviteDefaultsForm,
  buildInviteDefaultsPatch,
  describeInviteExpiry,
  previewMonthlyCharge,
  MAINTENANCE_CHOICES,
  type InviteDefaultsForm,
} from '../billing-policy/inviteDefaultsPolicy';

const card =
  'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const rowBase = 'flex items-center gap-3 px-4 py-3.5';

const EXPIRY_CHOICES = [24, 48, 72, 168];

/**
 * Defaults for new tenants.
 *
 * This row used to open a screen titled "Agreement duration" that set exactly
 * one of the five values an invite repeats — so four fifths of what the row
 * promised was not there, and two of those five had no editor anywhere in the
 * app.
 *
 * The worse of the two was maintenance: `MAINTENANCE` obligations are
 * generated and billed to tenants, and with no hostel-level default an owner
 * typed the same figure by hand on every invite. In admission season that is
 * the same number typed thirty times, and a number typed thirty times is a
 * number eventually typed wrong.
 *
 * Deposit and billing cycle are deliberately absent. They already have correct
 * homes on the Deposits and Rent screens; a second editor for one value is how
 * two screens start disagreeing about it. This screen says where they come
 * from instead.
 */
export function MoreConfigInviteDefaultsPage() {
  const navigate = useNavigate();
  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');
  const { rents } = useHostelBedSummary(hostelId);

  const [values, setValues] = useState<InviteDefaultsForm | null>(null);
  const [baseline, setBaseline] = useState<InviteDefaultsForm | null>(null);

  useEffect(() => {
    if (!policyQuery.data?.policy) return;
    const loaded = toInviteDefaultsForm(policyQuery.data.policy);
    setValues(loaded);
    setBaseline(loaded);
  }, [policyQuery.data]);

  const set = <K extends keyof InviteDefaultsForm>(key: K, value: InviteDefaultsForm[K]) =>
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));

  const dirty = hasChanges(baseline, values);
  /** A real room's rent, so the preview is this hostel's numbers, not a sample. */
  const sampleRent = Array.isArray(rents) && rents.length > 0 ? Number(rents[0]) : null;

  const save = () => {
    if (!hostelId || !values) return;
    updateMutation.mutate(buildInviteDefaultsPatch(values), {
      onSuccess: () => {
        stayoToast.success('Defaults saved');
        navigate(-1);
      },
      onError: () => stayoToast.error('Could not save defaults'),
    });
  };

  return (
    <div className={`flex flex-col gap-5 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader
        title="Defaults for new tenants"
        subtitle="Filled in for you every time you invite someone"
      />

      {!values ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>What they are charged</span>
            <div className={card}>
              <label className={`${rowBase} border-b border-border/60`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] text-foreground/80">Use each room's own rent</span>
                  <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">
                    Fills the rent from whichever room you give them. Turn off to type it every time.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={values.useRoomRent}
                  onChange={() => set('useRoomRent', !values.useRoomRent)}
                  className="h-5 w-5 flex-none accent-primary"
                />
              </label>

              <div className="border-b border-border/60 px-4 py-3.5">
                <span className="block text-[13.5px] text-foreground/80">Maintenance</span>
                <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">
                  A monthly charge and a one-time joining fee are different things — the same
                  ₹2,000 is ₹24,000 a year or ₹2,000 once.
                </span>
                <div className="mt-3 flex flex-wrap gap-2">
                  {MAINTENANCE_CHOICES.map((choice) => {
                    const active = values.maintenanceType === choice.value;
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        onClick={() => {
                          set('maintenanceType', choice.value);
                          // Choosing "not charged" must clear the amount, or a
                          // figure stays on screen describing a charge nobody
                          // pays.
                          if (choice.value === 'NONE') set('maintenanceAmount', 0);
                        }}
                        aria-pressed={active}
                        className={`rounded-full px-3.5 py-2 text-[12.5px] font-semibold ${
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border bg-card text-foreground/80'
                        }`}
                      >
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {values.maintenanceType !== 'NONE' && (
              <div className={rowBase}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] text-foreground/80">Amount</span>
                  <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">
                    {values.maintenanceType === 'ONE_TIME'
                      ? 'Charged once, when the tenant moves in'
                      : 'Charged every month, alongside rent'}
                  </span>
                </span>
                <span className="flex flex-none items-center gap-1 rounded-xl border border-border px-3 py-2">
                  <span className="text-[13px] text-muted-foreground">₹</span>
                  <input
                    value={values.maintenanceAmount || ''}
                    onChange={(e) => set('maintenanceAmount', Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="Maintenance amount"
                    className="w-16 bg-transparent text-right text-[14px] font-semibold tabular-nums text-foreground outline-none"
                  />
                </span>
              </div>
              )}
            </div>

            {/* The point of the screen: this line is already right before the
                owner edits anything. */}
            <p className="pl-0.5 text-[11.5px] leading-[1.5] text-muted-foreground">
              A new tenant would be billed{' '}
              <span className="font-semibold text-foreground">{previewMonthlyCharge(values, sampleRent)}</span>.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>How long they commit</span>
            <div className={card}>
              <div className={rowBase}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] text-foreground/80">Agreement length</span>
                  <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">
                    The lease term offered on a new invite
                  </span>
                </span>
                <span className="flex flex-none items-center gap-1 rounded-xl border border-border px-3 py-2">
                  <input
                    value={values.agreementMonths || ''}
                    onChange={(e) => set('agreementMonths', Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                    inputMode="numeric"
                    placeholder="11"
                    aria-label="Agreement length in months"
                    className="w-10 bg-transparent text-right text-[14px] font-semibold tabular-nums text-foreground outline-none"
                  />
                  <span className="text-[12px] text-muted-foreground">months</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>The invite itself</span>
            <div className={`${card} p-4`}>
              <span className="block text-[13.5px] text-foreground/80">Invite link stays valid for</span>
              <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">
                After this it stops working and you send a new one.
              </span>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXPIRY_CHOICES.map((hours) => {
                  const active = values.inviteExpiryHours === hours;
                  return (
                    <button
                      key={hours}
                      type="button"
                      onClick={() => set('inviteExpiryHours', hours)}
                      aria-pressed={active}
                      className={`rounded-full px-3.5 py-2 text-[12.5px] font-semibold ${
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border bg-card text-foreground/80'
                      }`}
                    >
                      {describeInviteExpiry(hours)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Named, not duplicated: a second editor for one value is how two
              screens start disagreeing about it. */}
          <p className="pl-0.5 text-[11.5px] leading-[1.5] text-muted-foreground">
            Deposit comes from <span className="font-semibold text-foreground">Deposits</span>, and how often rent is
            billed from <span className="font-semibold text-foreground">Rent</span>. Both apply to new tenants
            automatically.
          </p>
        </>
      )}

      <SaveBar
        visible={dirty}
        pending={updateMutation.isPending}
        onSave={save}
        onDiscard={() => baseline && setValues(baseline)}
        label="Save defaults"
      />
    </div>
  );
}
