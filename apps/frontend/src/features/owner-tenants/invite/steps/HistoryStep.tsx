import { Check, AlertTriangle, Loader2 } from 'lucide-react';
import type { InviteWizardData } from '../../types';
import { monthLabel, type InviteSettlementPreview } from '../priorHistory';

interface HistoryStepProps {
  data: InviteWizardData;
  setD: (patch: Partial<InviteWizardData>) => void;
  /** The server's answer. Null while it is being fetched or could not be built. */
  preview: InviteSettlementPreview | null;
  isLoading: boolean;
  error: string | null;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/**
 * What this tenant has already paid, before Stayo knew about them.
 *
 * Three questions in the owner's words, not the ledger's — they do not think
 * in obligations, they think "he's paid up to July and gave me the deposit".
 *
 * Every figure below comes from the server
 * (`POST /api/owners/invitations/settlement-preview`), not from arithmetic
 * here: the same module answers this and performs the write, so what the owner
 * approves is exactly what gets recorded. This is the one step in the wizard
 * that creates *settled* financial records, and its effect should never be
 * discovered afterwards. See ADR-141.
 */
export function HistoryStep({ data, setD, preview, isLoading, error }: HistoryStepProps) {
  const deposit = preview?.security_deposit ?? (Number(data.deposit) || 0);
  const maintenance = preview?.maintenance_amount ?? 0;
  const months = preview?.months ?? [];

  return (
    <div className="flex flex-col gap-4.5">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Tell us what they have already paid you. We'll record it as settled, so you never have to enter
        these months again.
      </p>

      <label className="block">
        <span className={labelStyle}>Rent paid up to</span>
        <select
          value={data.rentPaidThrough}
          onChange={(e) => setD({ rentPaidThrough: e.target.value })}
          disabled={months.length === 0}
          className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
        >
          <option value="">Nothing paid yet</option>
          {months.map((month) => (
            <option key={month.key} value={month.key}>
              {monthLabel(month.key)}
            </option>
          ))}
        </select>
      </label>

      {deposit > 0 && (
        <Toggle
          label={`Security deposit of ${money(deposit)}`}
          hint="Tick this if you are already holding it. It gets refunded at move-out."
          checked={data.depositAlreadyPaid}
          onChange={(v) => setD({ depositAlreadyPaid: v })}
        />
      )}

      {maintenance > 0 && (
        <Toggle
          label={`Maintenance of ${money(maintenance)}`}
          hint="Tick this if it has already been collected."
          checked={data.maintenanceAlreadyPaid}
          onChange={(v) => setD({ maintenanceAlreadyPaid: v })}
        />
      )}

      {preview?.truncated && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning-bg/60 p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning" strokeWidth={2} />
          <p className="text-[12px] leading-relaxed text-foreground">
            That stay is longer than two years, so only the most recent 24 months are rebuilt. Check the
            move-in date if that looks wrong.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          What we'll record
        </span>

        {isLoading && !preview ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Working out the months…
          </div>
        ) : error ? (
          <p className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-[12.5px] font-semibold text-destructive">
            {error}
          </p>
        ) : months.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-[12.5px] leading-relaxed text-muted-foreground">
            Pick a move-in date and a rent on the previous steps and we'll work out which months to record.
          </p>
        ) : (
          <div className={`flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 ${isLoading ? 'opacity-60' : ''}`}>
            <ul className="flex flex-col gap-1">
              {months.map((month) => (
                <SummaryRow
                  key={month.key}
                  label={monthLabel(month.key)}
                  amount={month.amount}
                  settled={month.settled}
                  settledWord="paid"
                />
              ))}
              {deposit > 0 && (
                <SummaryRow
                  label="Security deposit"
                  amount={deposit}
                  settled={data.depositAlreadyPaid}
                  settledWord="held"
                />
              )}
              {maintenance > 0 && (
                <SummaryRow
                  label="Maintenance"
                  amount={maintenance}
                  settled={data.maintenanceAlreadyPaid}
                  settledWord="paid"
                />
              )}
            </ul>

            <div className="flex items-baseline justify-between border-t border-border pt-2.5">
              <span className="font-display text-[13px] font-bold text-foreground">
                Recorded as already paid
              </span>
              <span className="font-display text-lg font-extrabold tabular-nums text-success">
                {money(preview?.amount_paid ?? 0)}
              </span>
            </div>
          </div>
        )}

        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Recorded quietly — {data.tenantName.trim() || 'your tenant'} gets no payment messages or
          receipts for money they handed over before today. Months you leave unticked stay due from
          their original date.
        </p>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  amount,
  settled,
  settledWord,
}: {
  label: string;
  amount: number;
  settled: boolean;
  settledWord: string;
}) {
  return (
    <li className="flex items-center justify-between text-[12.5px]">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {settled && <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.8} />}
        {label}
      </span>
      <span className={`font-semibold tabular-nums ${settled ? 'text-success' : 'text-foreground'}`}>
        {money(amount)} {settled ? settledWord : 'due'}
      </span>
    </li>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
        checked ? 'border-primary/45 bg-primary/[0.05]' : 'border-border bg-card'
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-md border-2 ${
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'
        }`}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3.2} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[13.5px] font-bold text-foreground">
          Already paid — {label}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
