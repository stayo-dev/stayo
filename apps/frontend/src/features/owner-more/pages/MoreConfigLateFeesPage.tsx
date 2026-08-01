import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy, useUpdateHostelPolicy, type LateFeeRule } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { Stepper } from '../components/Stepper';

const card = 'overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

const CHARGE_TYPES: { key: LateFeeRule['type']; title: string; sub: string }[] = [
  { key: 'PER_DAY', title: '₹ / day', sub: 'Compounds daily' },
  { key: 'FLAT', title: 'One-time', sub: 'Flat charge' },
  { key: 'PERCENTAGE', title: '% of rent', sub: 'Scales with rent' },
];

/** Configuration > Finance > Late fees — real 3-charge-type screen, backed by billing.late_fee via useHostelPolicy/useUpdateHostelPolicy. */
export function MoreConfigLateFeesPage() {
  const navigate = useNavigate();
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const [enabled, setEnabled] = useState(false);
  const [chargeType, setChargeType] = useState<LateFeeRule['type']>('PER_DAY');
  const [amount, setAmount] = useState('');
  const [graceDays, setGraceDays] = useState(0);
  const [amountError, setAmountError] = useState(false);

  useEffect(() => {
    const lateFee = policyQuery.data?.policy?.billing?.late_fee;
    const rule = lateFee?.rules?.[0];
    if (lateFee) {
      setEnabled(lateFee.enabled);
      setChargeType(rule?.type ?? 'PER_DAY');
      setAmount(rule?.amount ? String(rule.amount) : '');
      setGraceDays(rule?.starts_after_days ?? 0);
    }
  }, [policyQuery.data]);

  const maxAmount = policyQuery.data?.policy?.billing?.late_fee?.max_amount ?? 0;

  const amountSuffix = chargeType === 'PER_DAY' ? '/ day' : chargeType === 'PERCENTAGE' ? '% of rent' : 'one-time';

  const preview = (() => {
    const amt = parseInt(amount || '0', 10);
    if (!amt) return 'Set an amount to preview what a late tenant would owe.';
    const daysLate = 4;
    if (chargeType === 'PER_DAY') return `A tenant who pays ${daysLate} days late (after your ${graceDays}-day grace) would owe ₹${amt * daysLate} extra — ₹${amt} × ${daysLate} days.`;
    if (chargeType === 'FLAT') return `Any tenant who pays after the ${graceDays}-day grace owes a flat ₹${amt}, no matter how late.`;
    return `A tenant who pays late owes an extra ${amt}% of their monthly rent.`;
  })();

  const save = () => {
    if (!hostelId) return;
    if (enabled && !amount) {
      setAmountError(true);
      return;
    }
    updateMutation.mutate(
      {
        billing: {
          late_fee: enabled
            ? { enabled: true, rules: [{ type: chargeType, amount: Number(amount) || 0, starts_after_days: graceDays }], max_amount: maxAmount }
            : { enabled: false },
        },
      },
      {
        onSuccess: () => {
          stayoToast.success('Late fee rules saved');
          navigate('/owner/more/configuration/finance');
        },
        onError: () => stayoToast.error('Could not save late fee rules'),
      },
    );
  };

  return (
    <div className="flex flex-col gap-[18px] px-4 pb-28 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more/configuration/finance" backLabel="Finance" title="Late fees" subtitle="Charged after the grace period ends" />

      <div className={`${card} flex items-center gap-3 px-4 py-3.5`}>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Charge late fees</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">Applied automatically after the grace period</div>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`relative h-[27px] w-[46px] flex-none rounded-full transition-colors ${enabled ? 'bg-[#A45D44]' : 'bg-muted'}`}
        >
          <span className={`absolute top-0.5 h-[21px] w-[21px] rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[21px]' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {enabled ? (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>How it&apos;s charged</span>
            <div className="flex gap-2">
              {CHARGE_TYPES.map((opt) => {
                const active = chargeType === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setChargeType(opt.key)}
                    className={`flex-1 rounded-[13px] px-2 py-3 text-center transition-all ${active ? 'border-[1.5px] border-primary bg-primary/10' : 'border border-border bg-card'}`}
                  >
                    <div className={`font-display text-[13px] font-bold ${active ? 'text-primary' : 'text-foreground'}`}>{opt.title}</div>
                    <div className={`mt-0.5 text-[10px] ${active ? 'text-primary/80' : 'text-muted-foreground'}`}>{opt.sub}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Amount</span>
            <div className={`flex items-center gap-2 rounded-[13px] border ${amountError ? 'border-destructive' : 'border-border'} bg-card px-3.5 py-1`}>
              <span className="font-display text-base font-bold text-muted-foreground">₹</span>
              <input
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.replace(/[^0-9]/g, ''));
                  setAmountError(false);
                }}
                inputMode="numeric"
                placeholder="0"
                className="min-w-0 flex-1 bg-transparent py-2.5 font-display text-[17px] font-bold text-foreground focus:outline-none"
              />
              <span className="text-[13px] font-medium text-muted-foreground">{amountSuffix}</span>
            </div>
            {amountError && (
              <div className="flex items-center gap-1.5 pl-0.5 text-[11.5px] font-medium text-destructive">
                <AlertCircle className="h-3.5 w-3.5" /> Enter a late fee amount to continue
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Grace period</span>
            <div className="flex items-center gap-3 rounded-[13px] border border-border bg-card px-3.5 py-[11px]">
              <span className="flex-1 text-[13.5px] font-medium text-foreground">Days after due date</span>
              <Stepper value={graceDays} onChange={setGraceDays} min={0} max={15} />
            </div>
          </div>

          <div className="flex items-start gap-[11px] rounded-2xl border border-border bg-secondary/60 px-[15px] py-[13px]">
            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] bg-foreground font-display text-[11px] font-bold text-background">i</span>
            <p className="text-[12.5px] leading-relaxed text-foreground/80">{preview}</p>
          </div>
        </div>
      ) : (
        <div className="px-5 py-6 text-center text-[13px] leading-relaxed text-muted-foreground">
          Late fees are off. Tenants won&apos;t be charged anything for paying after the due date.
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-5 pb-8 pt-3">
        <button
          type="button"
          onClick={save}
          disabled={updateMutation.isPending}
          className="w-full rounded-xl bg-[#A45D44] py-3.5 text-center font-display text-sm font-bold text-white shadow-[0_6px_16px_rgba(164,93,68,0.28)] disabled:opacity-60"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save late fee rules'}
        </button>
      </div>
    </div>
  );
}
