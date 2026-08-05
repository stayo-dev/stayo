import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { Toggle } from '@features/owner-food/components/Toggle';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { Stepper } from '../components/Stepper';
import { policyDetail, policyHeadline } from './billingPolicy';

const card =
  'overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04)]';
const rowBase = 'flex items-center gap-3 px-4 py-3.5';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const sectionNote = 'pl-0.5 text-[11px] leading-relaxed text-muted-foreground';

const CHARGE_TYPES = [
  { value: 'FLAT', label: 'Flat' },
  { value: 'PERCENTAGE', label: 'Percentage' },
  { value: 'PER_DAY', label: 'Per day' },
] as const;

type ChargeType = (typeof CHARGE_TYPES)[number]['value'];

function NumberField({
  value,
  onChange,
  prefix,
  suffix,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-[13.5px] font-bold text-muted-foreground">{prefix}</span>}
      <input
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        inputMode="numeric"
        className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-right font-display text-[13.5px] font-bold tabular-nums text-foreground focus:border-primary focus:outline-none"
      />
      {suffix && <span className="text-[13.5px] font-bold text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/**
 * **The** billing policy screen — the single place billing behaviour is
 * configured (ADR-043).
 *
 * It replaces three screens that each owned a slice of the same concept and
 * could overwrite one another: `MoreBillingPage` (Settings → "Rent and
 * billing", FLAT-only late fee), `MoreConfigLateFeesPage` (Configure →
 * Finance, all three charge types) and `MoreConfigTenantDefaultsPage`
 * (Configure → Hostel, deposit + agreement). The first silently rewrote the
 * second's PERCENTAGE/PER_DAY rule to FLAT and dropped its cap, because it
 * always wrote `type: 'FLAT'` and omitted `max_amount`.
 *
 * Everything writes through the one existing
 * `PATCH /hostels/:id/preferences`, deep-merged server-side.
 */
export function MoreConfigBillingPolicyPage() {
  const navigate = useNavigate();
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  // Rent collection
  const [allowPartial, setAllowPartial] = useState(false);
  const [minAmount, setMinAmount] = useState('0');
  const [minPercent, setMinPercent] = useState('0');
  // Deposit + agreement
  const [depositMonths, setDepositMonths] = useState(1);
  const [agreementMonths, setAgreementMonths] = useState(12);
  // Schedule
  const [generationDay, setGenerationDay] = useState(1);
  const [dueDay, setDueDay] = useState(5);
  const [graceDays, setGraceDays] = useState(0);
  // Late fee
  const [lateFeeEnabled, setLateFeeEnabled] = useState(false);
  const [chargeType, setChargeType] = useState<ChargeType>('FLAT');
  const [lateFeeAmount, setLateFeeAmount] = useState('0');
  const [maxLateFee, setMaxLateFee] = useState('0');

  useEffect(() => {
    const billing = policyQuery.data?.policy?.billing;
    if (!billing) return;

    const partial = billing.partial_payments;
    setAllowPartial(Boolean(partial?.enabled));
    setMinAmount(String(partial?.minimum_amount ?? 0));
    setMinPercent(String(partial?.minimum_percentage ?? 0));

    setDepositMonths(billing.deposit?.deposit_months ?? 1);
    setAgreementMonths(billing.invite_defaults?.agreement_duration_months ?? 12);

    setGenerationDay(billing.auto_rent_day ?? 1);
    setDueDay(billing.due_day ?? 5);
    setGraceDays(billing.grace_days ?? 0);

    const lateFee = billing.late_fee;
    setLateFeeEnabled(Boolean(lateFee?.enabled));
    const rule = lateFee?.rules?.[0];
    if (rule) {
      setChargeType((rule.type as ChargeType) ?? 'FLAT');
      setLateFeeAmount(String(rule.amount ?? 0));
    }
    setMaxLateFee(String(lateFee?.max_amount ?? 0));
  }, [policyQuery.data]);

  const livePolicy = {
    enabled: allowPartial,
    minimumAmount: Number(minAmount) || 0,
    minimumPercentage: Number(minPercent) || 0,
  };

  const save = () => {
    if (!hostelId) return;
    updateMutation.mutate(
      {
        billing: {
          partial_payments: {
            enabled: allowPartial,
            minimum_amount: Number(minAmount) || 0,
            minimum_percentage: Number(minPercent) || 0,
          },
          deposit: { deposit_months: depositMonths },
          invite_defaults: { agreement_duration_months: agreementMonths },
          auto_rent_day: generationDay,
          due_day: dueDay,
          grace_days: graceDays,
          // Always send the full late-fee shape — writing a partial shape is
          // exactly how the old screen destroyed the charge type and cap.
          late_fee: lateFeeEnabled
            ? {
                enabled: true,
                rules: [
                  { type: chargeType, amount: Number(lateFeeAmount) || 0, starts_after_days: graceDays },
                ],
                max_amount: Number(maxLateFee) || 0,
              }
            : { enabled: false },
        },
      },
      {
        onSuccess: () => {
          stayoToast.success('Billing policy saved');
          navigate('/owner/more/configuration/finance');
        },
        onError: (error: any) => {
          const msg = error?.response?.data?.error?.message;
          stayoToast.error(msg || 'Could not save billing policy');
        },
      },
    );
  };

  if (policyQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-40 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo="/owner/more/configuration/finance"
        backLabel="Finance"
        title="Billing policy"
        subtitle="How rent is collected, charged and enforced"
      />

      {/* ── 1. Rent collection ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Rent collection</span>
        <div className={card}>
          <div className="border-b border-border/60 px-4 pb-1 pt-3.5">
            <Toggle
              checked={allowPartial}
              onChange={() => setAllowPartial((v) => !v)}
              label="Accept part payments"
              sub="Let a tenant pay a due in instalments"
            />
          </div>

          {allowPartial ? (
            <>
              <div className={`${rowBase} border-b border-border/60`}>
                <span className="flex-1 text-[13.5px] text-foreground/80">
                  Minimum amount
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">0 for no minimum</span>
                </span>
                <NumberField value={minAmount} onChange={setMinAmount} prefix="₹" ariaLabel="Minimum part payment amount" />
              </div>
              <div className={rowBase}>
                <span className="flex-1 text-[13.5px] text-foreground/80">
                  Minimum percentage
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">Of what the tenant owes. 0 for none</span>
                </span>
                <NumberField value={minPercent} onChange={setMinPercent} suffix="%" ariaLabel="Minimum part payment percentage" />
              </div>
            </>
          ) : null}
        </div>

        {/* Live restatement of the rule the owner just set, in their language. */}
        <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
          <div className="font-display text-[12.5px] font-bold text-foreground">{policyHeadline(livePolicy)}</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{policyDetail(livePolicy)}</p>
          {allowPartial && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Anything left unpaid stays outstanding against the tenant, and they keep showing as partly unpaid until it's collected.
            </p>
          )}
        </div>
      </div>

      {/* ── 2. Security deposit ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Security deposit</span>
        <div className={`${card} flex items-center justify-between gap-3 px-4 py-3.5`}>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">Months of rent</div>
            <div className="text-[11px] text-muted-foreground">Default deposit collected at move-in</div>
          </div>
          <Stepper value={depositMonths} onChange={setDepositMonths} min={1} max={12} />
        </div>
      </div>

      {/* ── 3. Agreement ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Agreement</span>
        <div className={`${card} flex items-center justify-between gap-3 px-4 py-3.5`}>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">Duration (months)</div>
            <div className="text-[11px] text-muted-foreground">Default lease length offered to new tenants</div>
          </div>
          <Stepper value={agreementMonths} onChange={setAgreementMonths} min={1} max={120} />
        </div>
      </div>

      {/* ── 4. Rent schedule ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Rent schedule</span>
        <div className={card}>
          <div className={`${rowBase} border-b border-border/60`}>
            <span className="flex-1 text-[13.5px] text-foreground/80">
              Generation day
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Rent is raised on this day each month</span>
            </span>
            <Stepper value={generationDay} onChange={setGenerationDay} min={1} max={28} />
          </div>
          <div className={`${rowBase} border-b border-border/60`}>
            <span className="flex-1 text-[13.5px] text-foreground/80">
              Due day
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Payment is expected by this day</span>
            </span>
            <Stepper value={dueDay} onChange={setDueDay} min={1} max={28} />
          </div>
          <div className={rowBase}>
            <span className="flex-1 text-[13.5px] text-foreground/80">
              Grace period
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Days after the due day before it counts as late</span>
            </span>
            <Stepper value={graceDays} onChange={setGraceDays} min={0} max={28} />
          </div>
        </div>
        <p className={sectionNote}>
          Rent is raised on day {generationDay}, due on day {dueDay}
          {graceDays > 0 ? `, and counts as late after ${graceDays} more day${graceDays > 1 ? 's' : ''}.` : ', and counts as late the next day.'}
        </p>
      </div>

      {/* ── 5. Late fee ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Late fee</span>
        <div className={card}>
          <div className="px-4 pb-1 pt-3.5">
            <Toggle
              checked={lateFeeEnabled}
              onChange={() => setLateFeeEnabled((v) => !v)}
              label="Charge a late fee"
              sub="Applied once the grace period ends"
            />
          </div>

          {lateFeeEnabled && (
            <>
              <div className={`${rowBase} border-y border-border/60`}>
                <span className="flex-1 text-[13.5px] text-foreground/80">Charge type</span>
                <div className="flex gap-1 rounded-lg bg-secondary p-0.5">
                  {CHARGE_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setChargeType(t.value)}
                      className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                        chargeType === t.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={`${rowBase} border-b border-border/60`}>
                <span className="flex-1 text-[13.5px] text-foreground/80">Amount</span>
                <NumberField
                  value={lateFeeAmount}
                  onChange={setLateFeeAmount}
                  prefix={chargeType === 'PERCENTAGE' ? undefined : '₹'}
                  suffix={chargeType === 'PERCENTAGE' ? '%' : undefined}
                  ariaLabel="Late fee amount"
                />
              </div>
              <div className={rowBase}>
                <span className="flex-1 text-[13.5px] text-foreground/80">
                  Maximum cap
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">0 for no cap</span>
                </span>
                <NumberField value={maxLateFee} onChange={setMaxLateFee} prefix="₹" ariaLabel="Maximum late fee" />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-background px-5 pb-[30px] pt-3 sm:mx-auto sm:max-w-[480px] sm:px-6">
        <button
          type="button"
          onClick={save}
          disabled={updateMutation.isPending}
          className="w-full rounded-xl bg-[#A45D44] py-3.5 text-center font-display text-sm font-bold text-primary-foreground shadow-[0_6px_16px_rgba(164,93,68,0.28)] disabled:opacity-60"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save billing policy'}
        </button>
      </div>
    </div>
  );
}
