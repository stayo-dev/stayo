import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ChevronDown, Receipt } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { StayoLoader } from '@shared/ui/brand';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { queryKeys } from '@lib/queryKeys';
import { obligationService } from '../api/obligations';
import {
  CHARGE_TYPES,
  chargeType,
  resolveBillingMonth,
  resolveDueDate,
  summariseCharge,
  validateChargeDraft,
  type ChargeDraft,
} from './chargeDraft';

/**
 * Raise a manual charge against a tenant.
 *
 * Replaces `CreateObligationModal`, a centred dialog in the pre-Stayo palette
 * with an eleven-option native `<select>`, two cramped two-column rows, and a
 * password field. Four things changed beyond the styling:
 *
 *  - **No password.** It fetched an identity token and never sent it —
 *    `POST /api/payments/obligations` accepts none, being owner-scoped by
 *    session — so the prompt was a step that protected nothing. Cancel and
 *    Waive keep theirs; those forgive money.
 *  - **No default type.** It preselected Rent Installment, the one type an
 *    owner should rarely raise by hand, since rent is generated monthly and a
 *    manual one double-bills. The owner now chooses, from cards that say when
 *    each type applies.
 *  - **Billing month only where it means something.** It was a permanent
 *    "(Optional)" field that most charges have no answer to. It appears for
 *    the types where a charge belongs to a month, and is otherwise derived.
 *  - **Errors inline and all at once**, rather than one toast per submit.
 */

interface CreateChargeSheetProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  tenantName: string;
  hostelId: string;
  onSuccess?: () => void;
}

const EMPTY: ChargeDraft = {
  type: '',
  amount: '',
  dueDate: '',
  billingMonth: '',
  description: '',
  notes: '',
};

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function firstOfNextMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

const fieldBase =
  'w-full rounded-[11px] border bg-background px-3.5 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary';

export function CreateChargeSheet({
  open,
  onClose,
  tenantId,
  tenantName,
  hostelId,
  onSuccess,
}: CreateChargeSheetProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ChargeDraft>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const set = <K extends keyof ChargeDraft>(key: K, value: ChargeDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const selectedType = chargeType(draft.type);
  const validation = useMemo(() => validateChargeDraft(draft), [draft]);
  const summary = summariseCharge(draft);
  const errors = showErrors ? validation.errors : {};

  const reset = () => {
    setDraft(EMPTY);
    setShowErrors(false);
    setNotesOpen(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const create = useMutation({
    mutationFn: () => {
      const dueDate = resolveDueDate(draft.dueDate);
      const rentMonth = resolveBillingMonth(draft.dueDate, draft.billingMonth);
      if (!dueDate || !rentMonth) throw new Error('That due date could not be read.');

      return obligationService.create({
        tenant_id: tenantId,
        obligation_type: draft.type,
        amount: Number(draft.amount),
        due_date: dueDate,
        rent_month: rentMonth,
        description: draft.description.trim() || undefined,
        notes: draft.notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all(hostelId) });
      stayoToast.success(summary ? `Charged ${summary.split(' · ')[0]}` : 'Charge created');
      onSuccess?.();
      close();
    },
    onError: (error: any) => {
      stayoToast.error(
        error?.response?.data?.error?.message || error?.message || 'Could not create this charge.',
      );
    },
  });

  const submit = () => {
    if (!validation.valid) {
      setShowErrors(true);
      return;
    }
    create.mutate();
  };

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && close()} title="Add a charge">
      <div className="flex flex-col gap-4">
        <p className="px-0.5 text-[11.5px] text-muted-foreground">
          A one-off charge for <b className="font-bold text-foreground">{tenantName}</b>. It appears
          in their dues straight away.
        </p>

        {/* ── What for ─────────────────────────────────────────────── */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              What is this charge for?
            </span>
            {errors.type && <span className="text-[10.5px] font-semibold text-destructive">{errors.type}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CHARGE_TYPES.map((option) => {
              const active = option.value === draft.type;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => set('type', option.value)}
                  aria-pressed={active}
                  className={`rounded-[13px] border p-2.5 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/8'
                      : errors.type
                        ? 'border-destructive/30 bg-card'
                        : 'border-border bg-card hover:bg-muted/60'
                  }`}
                >
                  <span className="block font-display text-[12.5px] font-bold text-foreground">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {selectedType?.caution && (
          <div className="flex items-start gap-2 rounded-[13px] border border-warning/25 bg-warning/8 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning" strokeWidth={1.9} />
            <p className="text-[11.5px] leading-relaxed text-foreground">{selectedType.caution}</p>
          </div>
        )}

        {/* ── How much ─────────────────────────────────────────────── */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="charge-amount" className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Amount
            </label>
            {errors.amount && <span className="text-[10.5px] font-semibold text-destructive">{errors.amount}</span>}
          </div>
          <div
            className={`flex items-center rounded-[13px] border-[1.5px] bg-card px-3.5 ${
              errors.amount ? 'border-destructive' : 'border-primary'
            }`}
          >
            <span className="font-display text-base font-bold text-primary">₹</span>
            <input
              id="charge-amount"
              value={draft.amount}
              onChange={(e) => set('amount', e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0"
              className="min-w-0 flex-1 bg-transparent px-2 py-3 font-display text-lg font-extrabold tabular-nums text-foreground focus:outline-none"
            />
          </div>
        </div>

        {/* ── When ─────────────────────────────────────────────────── */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Due</span>
            {errors.dueDate && <span className="text-[10.5px] font-semibold text-destructive">{errors.dueDate}</span>}
          </div>
          <div className="mb-2 flex gap-1.5">
            {[
              { label: 'Today', value: isoDay(0) },
              { label: 'In a week', value: isoDay(7) },
              { label: '1st next month', value: firstOfNextMonth() },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => set('dueDate', preset.value)}
                className={`flex-1 rounded-full border px-2 py-1.5 text-[11px] font-bold transition-colors ${
                  draft.dueDate === preset.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2.5 rounded-[13px] border border-border px-3.5 py-2">
            <CalendarDays className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
            <input
              type="date"
              aria-label="Due date"
              value={draft.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
              className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-foreground focus:outline-none"
            />
          </div>
        </div>

        {/* Only asked where a charge genuinely belongs to a month. */}
        {selectedType?.billingMonthApplies && (
          <div>
            <label htmlFor="charge-month" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Which month is this for?
            </label>
            <input
              id="charge-month"
              type="month"
              value={draft.billingMonth}
              onChange={(e) => set('billingMonth', e.target.value)}
              className={`${fieldBase} border-border`}
            />
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              Leave blank to file it under the due date's month.
            </p>
          </div>
        )}

        {/* ── What the tenant sees ─────────────────────────────────── */}
        <div>
          <label htmlFor="charge-description" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            What the tenant will see
          </label>
          <input
            id="charge-description"
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="e.g. Electricity — August, Broken window in 204"
            className={`${fieldBase} border-border`}
          />
        </div>

        {notesOpen ? (
          <div>
            <label htmlFor="charge-notes" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Private note <span className="font-semibold normal-case tracking-normal">— only you and co-owners</span>
            </label>
            <textarea
              id="charge-notes"
              rows={2}
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Context for your own records"
              className={`${fieldBase} resize-none border-border`}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="flex items-center gap-1 self-start text-[11.5px] font-bold text-primary"
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.2} />
            Add a private note
          </button>
        )}

        {summary && (
          <div className="flex items-center gap-2.5 rounded-[13px] bg-muted/60 p-3">
            <Receipt className="h-4 w-4 flex-none text-primary" strokeWidth={1.9} />
            <span className="font-display text-[12.5px] font-bold text-foreground">{summary}</span>
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-[14px] font-bold text-primary-foreground shadow-[0_6px_16px_rgba(143,74,56,0.28)] transition-opacity disabled:opacity-40 disabled:shadow-none"
        >
          {create.isPending ? (
            <>
              <StayoLoader size="sm" label={null} />
              Adding…
            </>
          ) : (
            'Add charge'
          )}
        </button>
      </div>
    </BottomSheet>
  );
}
