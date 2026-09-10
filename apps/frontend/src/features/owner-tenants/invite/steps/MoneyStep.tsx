import { BILLING_FREQUENCIES, PAYMENT_MODES, type PaymentMode } from '@shared/mocks/payments';
import type { InviteWizardData } from '../../types';
import { paidAmountGuidance } from '../paidAmountGuidance';
import type { InviteSettlementPreviewResponse } from '../settlementPreview';

interface MoneyStepProps {
  data: InviteWizardData;
  setD: (patch: Partial<InviteWizardData>) => void;
  /**
   * The settlement the wizard has already fetched. It was passed only to the
   * final step, so an owner typed an amount here with nothing on screen saying
   * what was owed — and learned whether it was acceptable two steps later.
   */
  settlementPreview?: InviteSettlementPreviewResponse | null;
  isLoadingSettlementPreview?: boolean;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const moneyInputStyle = 'flex-1 min-w-0 bg-transparent px-2 py-3 text-sm font-semibold text-foreground focus:outline-none';

/** Step 3/4 of the Invite Tenant wizard — rent, deposit, billing, maintenance. */
export function MoneyStep({ data, setD, settlementPreview, isLoadingSettlementPreview }: MoneyStepProps) {
  const rent = Number(data.monthlyRent) || 0;
  const deposit = Number(data.deposit) || 0;
  const maintenance = Number(data.maintenance) || 0;
  const total = rent + deposit + maintenance;

  const guidance = paidAmountGuidance(data.paidAmount, settlementPreview?.total_outstanding);

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
        {/*
          The amount alone was never enough: the invite did not send a type, so
          every tenant got the column default of MONTHLY and a one-time joining
          fee silently became a recurring charge. Pre-filled from the hostel's
          own maintenance policy, changeable for this tenant.
        */}
        {Number(data.maintenance) > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { value: 'MONTHLY', label: 'Every month' },
              { value: 'ONE_TIME', label: 'Once at move-in' },
            ].map((choice) => {
              const active = (data.maintenanceType || 'MONTHLY') === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => setD({ maintenanceType: choice.value })}
                  aria-pressed={active}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                    active ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground/75'
                  }`}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        )}
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

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted p-4">
        <button
          type="button"
          onClick={() => setD({ hasPaidAlready: !data.hasPaidAlready })}
          className="flex items-center justify-between text-left"
        >
          <span className="text-[13.5px] font-bold text-foreground">Has the tenant already paid anything?</span>
          <span
            className={`relative h-6 w-10 flex-none rounded-full transition-colors ${data.hasPaidAlready ? 'bg-primary' : 'bg-border'}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${data.hasPaidAlready ? 'translate-x-4.5' : 'translate-x-0.5'}`}
            />
          </span>
        </button>

        {data.hasPaidAlready && (
          <div className="flex flex-col gap-3.5 border-t border-border pt-3.5">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              A deposit paid in cash at the door, or months already collected from a tenant who joined before
              Stayo — record it here and it settles the same way a real payment would.
            </p>

            <label className="block">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className={`${labelStyle} mb-0`}>Amount already paid</span>
                {/*
                  What is owed, from the backend's own settlement plan — never
                  recomputed here. Tapping it fills the field, which is the
                  whole gesture for the common case: the tenant handed over
                  exactly what was due.
                */}
                {guidance.owedLabel && guidance.fillAmount !== null && (
                  <button
                    type="button"
                    onClick={() => setD({ paidAmount: String(guidance.fillAmount) })}
                    className="text-[11.5px] font-bold text-primary"
                  >
                    {guidance.owedLabel} · Pay all
                  </button>
                )}
                {guidance.owedLabel && guidance.fillAmount === null && (
                  <span className="text-[11.5px] font-semibold text-muted-foreground">{guidance.owedLabel}</span>
                )}
                {!guidance.owedLabel && isLoadingSettlementPreview && (
                  <span className="text-[11.5px] text-muted-foreground">Working out what is owed…</span>
                )}
              </div>
              <div
                className={`flex items-center rounded-[11px] border bg-card px-3 ${
                  guidance.isBlocking ? 'border-destructive' : 'border-border'
                }`}
              >
                <span className="text-sm font-semibold text-muted-foreground">₹</span>
                <input
                  value={data.paidAmount}
                  onChange={(e) => setD({ paidAmount: e.target.value.replace(/[^0-9]/g, '') })}
                  inputMode="numeric"
                  placeholder="0"
                  className={moneyInputStyle}
                />
              </div>
              {guidance.message && (
                <p
                  className={`mt-1.5 text-[11.5px] font-medium leading-[1.5] ${
                    guidance.isBlocking ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                  role={guidance.isBlocking ? 'alert' : undefined}
                >
                  {guidance.message}
                </p>
              )}
            </label>

            <button
              type="button"
              onClick={() => setD({ paidIncludesDeposit: !data.paidIncludesDeposit })}
              className="flex items-center justify-between text-left"
            >
              <span className="text-[12.5px] font-semibold text-foreground">Does this include the security deposit?</span>
              <span
                className={`relative h-5.5 w-9 flex-none rounded-full transition-colors ${data.paidIncludesDeposit ? 'bg-primary' : 'bg-border'}`}
              >
                <span
                  className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${data.paidIncludesDeposit ? 'translate-x-4' : 'translate-x-0.5'}`}
                />
              </span>
            </button>

            <label className="block">
              <span className={labelStyle}>Payment method{Number(data.paidAmount) > 0 ? ' *' : ''}</span>
              <div className="mt-1.5 flex gap-2">
                {PAYMENT_MODES.map((m: PaymentMode) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setD({ paymentMethod: m })}
                    className={`flex-1 rounded-xl border-[1.5px] py-2.5 text-center font-display text-[12.5px] font-bold ${data.paymentMethod === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </label>

            <label className="block">
              <span className={labelStyle}>Reference (optional)</span>
              <input
                value={data.paymentReference}
                onChange={(e) => setD({ paymentReference: e.target.value })}
                placeholder="UTR / transaction ID / note"
                className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
