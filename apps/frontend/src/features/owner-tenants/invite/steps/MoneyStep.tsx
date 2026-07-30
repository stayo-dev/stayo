import { BILLING_FREQUENCIES } from '@shared/mocks/payments';
import type { InviteWizardData } from '../../types';

interface MoneyStepProps {
  data: InviteWizardData;
  setD: (patch: Partial<InviteWizardData>) => void;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const moneyInputStyle = 'flex-1 min-w-0 bg-transparent px-2 py-3 text-sm font-semibold text-foreground focus:outline-none';

/** Step 3/4 of the Invite Tenant wizard — rent, deposit, billing, maintenance. */
export function MoneyStep({ data, setD }: MoneyStepProps) {
  const rent = Number(data.monthlyRent) || 0;
  const deposit = Number(data.deposit) || 0;
  const maintenance = Number(data.maintenance) || 0;
  const total = rent + deposit + maintenance;

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex gap-2.5">
        <label className="block flex-1">
          <span className={labelStyle}>Monthly rent</span>
          <div className="flex items-center rounded-[11px] border border-border bg-card px-3">
            <span className="text-sm font-semibold text-muted-foreground">₹</span>
            <input value={data.monthlyRent} onChange={(e) => setD({ monthlyRent: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" className={moneyInputStyle} />
          </div>
        </label>
        <label className="block flex-1">
          <div className="mb-1.5 flex items-center justify-between">
            <span className={labelStyle}>Deposit</span>
            <span className="rounded bg-success/10 px-1.5 py-0.5 text-[9px] font-bold text-success">auto</span>
          </div>
          <div className="flex items-center rounded-[11px] border border-border bg-card px-3">
            <span className="text-sm font-semibold text-muted-foreground">₹</span>
            <input value={data.deposit} onChange={(e) => setD({ deposit: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" className={moneyInputStyle} />
          </div>
        </label>
      </div>

      <label className="block">
        <span className={labelStyle}>Billing</span>
        <select
          value={data.billing}
          onChange={(e) => setD({ billing: e.target.value })}
          className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        >
          {BILLING_FREQUENCIES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelStyle}>Maintenance (optional)</span>
        <div className="flex items-center rounded-[11px] border border-border bg-card px-3">
          <span className="text-sm font-semibold text-muted-foreground">₹</span>
          <input value={data.maintenance} onChange={(e) => setD({ maintenance: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" placeholder="0" className={moneyInputStyle} />
        </div>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Pricing summary</span>
        <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
          <div className="flex justify-between text-[12.5px] text-muted-foreground">
            <span>Monthly rent</span>
            <span className="font-semibold tabular-nums text-foreground">₹{rent.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between text-[12.5px] text-muted-foreground">
            <span>Security deposit</span>
            <span className="font-semibold tabular-nums text-foreground">₹{deposit.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between text-[12.5px] text-muted-foreground">
            <span>Maintenance</span>
            <span className="font-semibold tabular-nums text-foreground">₹{maintenance.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-border pt-2.5">
            <span className="font-display text-[13.5px] font-bold text-foreground">Total due at move-in</span>
            <span className="font-display text-xl font-extrabold tabular-nums text-foreground">₹{total.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
