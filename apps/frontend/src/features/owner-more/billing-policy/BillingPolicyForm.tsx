import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { Toggle } from '@features/owner-food/components/Toggle';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { Stepper } from '../components/Stepper';
import { hasChanges } from '../config/dirtyState';
import { useHostelBedSummary } from '../hooks/useHostelBedSummary';
import { policyDetail, policyHeadline } from './billingPolicy';
import { depositPreview, type DepositMode } from './depositPolicy';
import { monthDays, scheduleMilestones, describeSchedule, crossesMonthEnd } from './rentScheduleCalendar';
import {
  buildBillingPatch,
  policyToFormValues,
  type BillingFormValues,
  type BillingSectionKey,
  type ChargeType,
} from './billingSections';

const card =
  'overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04)]';
const rowBase = 'flex items-center gap-3 px-4 py-3.5';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const sectionNote = 'pl-0.5 text-[11px] leading-relaxed text-muted-foreground';

const CHARGE_TYPES: Array<{ value: ChargeType; label: string }> = [
  { value: 'FLAT', label: 'Flat' },
  { value: 'PERCENTAGE', label: 'Percentage' },
  { value: 'PER_DAY', label: 'Per day' },
];

const DEPOSIT_MODES: Array<{ value: DepositMode; label: string }> = [
  { value: 'FLAT', label: 'Fixed amount' },
  { value: 'MONTHS_OF_RENT', label: 'Months of rent' },
];

/** Segmented control shared by charge type and deposit mode. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1 rounded-lg bg-secondary p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
            value === option.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Numeric input over a numeric value.
 *
 * Holds its own text buffer so the field can be emptied while typing without
 * snapping back to "0" — the buffer is only re-synced when the incoming value
 * genuinely disagrees with what has been typed (e.g. after Discard).
 */
function NumberField({
  value,
  onChange,
  prefix,
  suffix,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  ariaLabel: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    if ((Number(text) || 0) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-[13.5px] font-bold text-muted-foreground">{prefix}</span>}
      <input
        value={text}
        aria-label={ariaLabel}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, '');
          setText(raw);
          onChange(Number(raw) || 0);
        }}
        inputMode="numeric"
        className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-right font-display text-[13.5px] font-bold tabular-nums text-foreground focus:border-primary focus:outline-none"
      />
      {suffix && <span className="text-[13.5px] font-bold text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/**
 * The billing policy form, rendering only the sections it is asked for.
 *
 * ADR-043 consolidated three overlapping billing screens into one because they
 * overwrote each other's fields. That fixed the data hazard but produced a
 * single long form, so every Finance row deep-linked to the same page — tapping
 * "Security deposit" landed in a six-section wall.
 *
 * This keeps both properties: focused screens, and no cross-clobbering. The
 * patch comes from `buildBillingPatch`, which emits **only** the visible
 * sections' fields; the backend deep-merges, so hidden sections are untouched.
 * The isolation is unit-tested in billingSections.test.ts.
 *
 * Save appears only once the form differs from the loaded policy (`hasChanges`),
 * so reading a screen can no longer produce a no-op PATCH and a change-log entry.
 */
export function BillingPolicyForm({
  sections,
  title,
  subtitle,
  backTo,
  backLabel,
}: {
  sections: BillingSectionKey[];
  title: string;
  subtitle: string;
  /** Omit to return wherever the owner opened this from. */
  backTo?: string;
  backLabel?: string;
}) {
  const navigate = useNavigate();
  
  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');
  const { rents } = useHostelBedSummary(hostelId);

  const shown = (key: BillingSectionKey) => sections.includes(key);

  const [values, setValues] = useState<BillingFormValues | null>(null);
  /** What was loaded. Save is offered only while `values` differs from this. */
  const [baseline, setBaseline] = useState<BillingFormValues | null>(null);

  useEffect(() => {
    const billing = policyQuery.data?.policy?.billing;
    if (!billing) return;
    const loaded = policyToFormValues(billing);
    setValues(loaded);
    setBaseline(loaded);
  }, [policyQuery.data]);

  const set = <K extends keyof BillingFormValues>(key: K, value: BillingFormValues[K]) =>
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));

  if (policyQuery.isLoading || !values) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
        {sections.map((key) => (
          <div key={key} className="h-32 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }

  const livePolicy = {
    enabled: values.allowPartial,
    minimumAmount: values.minAmount,
    minimumPercentage: values.minPercentage,
  };

  const autoFillRoomRent = policyQuery.data?.policy?.billing?.invite_defaults?.auto_fill_room_rent !== false;
  const preview = depositPreview({
    enabled: values.depositEnabled,
    mode: values.depositMode,
    flatAmount: values.depositAmount,
    months: values.depositMonths,
    rents,
    autoFillRoomRent,
  });

  const dirty = hasChanges(baseline, values);

  const save = () => {
    if (!hostelId) return;
    updateMutation.mutate(buildBillingPatch(values, sections), {
      onSuccess: () => {
        stayoToast.success(`${title} saved`);
        // Back to wherever this was opened from — these screens are reached
        // from a hostel's Settings tab now, not from one fixed hub.
        if (backTo) navigate(backTo);
        else navigate(-1);
      },
      onError: (error: any) =>
        stayoToast.error(error?.response?.data?.error?.message || `Could not save ${title.toLowerCase()}`),
    });
  };

  return (
    <div className={`flex flex-col gap-6 px-4 pt-6 sm:px-6 ${dirty ? 'pb-44' : 'pb-24'}`}>
      <MoreScreenHeader backTo={backTo} backLabel={backLabel} title={title} subtitle={subtitle} />

      {shown('schedule') && (
        <div className="flex flex-col gap-2">
          {sections.length > 1 && <span className={sectionLabel}>Rent schedule</span>}
          <div className={card}>
            <div className={`${rowBase} border-b border-border/60`}>
              <span className="flex-1 text-[13.5px] text-foreground/80">
                Generation day
                <span className="mt-0.5 block text-[11px] text-muted-foreground">Rent is raised on this day each month</span>
              </span>
              <Stepper value={values.generationDay} onChange={(v) => set('generationDay', v)} min={1} max={28} />
            </div>
            <div className={`${rowBase} border-b border-border/60`}>
              <span className="flex-1 text-[13.5px] text-foreground/80">
                Due day
                <span className="mt-0.5 block text-[11px] text-muted-foreground">Payment is expected by this day</span>
              </span>
              <Stepper value={values.dueDay} onChange={(v) => set('dueDay', v)} min={1} max={28} />
            </div>
            <div className={rowBase}>
              <span className="flex-1 text-[13.5px] text-foreground/80">
                Grace period
                <span className="mt-0.5 block text-[11px] text-muted-foreground">Days after the due day before it counts as late</span>
              </span>
              <Stepper value={values.graceDays} onChange={(v) => set('graceDays', v)} min={0} max={28} />
            </div>
          </div>
          {/*
            The three numbers above are each clear and together are not: an
            owner had to hold "raised on the 1st", "due on the 5th" and "late
            after 0 more days" in their head and imagine a month to see what it
            meant for a tenant. Here is the month.
          */}
          <RentMonthPreview
            generationDay={values.generationDay}
            dueDay={values.dueDay}
            graceDays={values.graceDays}
          />
        </div>
      )}

      {shown('collection') && (
        <div className="flex flex-col gap-2">
          {sections.length > 1 && <span className={sectionLabel}>Rent collection</span>}
          <div className={card}>
            <div className="border-b border-border/60 px-4 pb-1 pt-3.5">
              <Toggle
                checked={values.allowPartial}
                onChange={() => set('allowPartial', !values.allowPartial)}
                label="Accept part payments"
                sub="Let a tenant pay a due in instalments"
              />
            </div>

            {values.allowPartial ? (
              <>
                <div className={`${rowBase} border-b border-border/60`}>
                  <span className="flex-1 text-[13.5px] text-foreground/80">
                    Minimum amount
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">0 for no minimum</span>
                  </span>
                  <NumberField
                    value={values.minAmount}
                    onChange={(v) => set('minAmount', v)}
                    prefix="₹"
                    ariaLabel="Minimum part payment amount"
                  />
                </div>
                <div className={rowBase}>
                  <span className="flex-1 text-[13.5px] text-foreground/80">
                    Minimum percentage
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">Of what the tenant owes. 0 for none</span>
                  </span>
                  <NumberField
                    value={values.minPercentage}
                    onChange={(v) => set('minPercentage', v)}
                    suffix="%"
                    ariaLabel="Minimum part payment percentage"
                  />
                </div>
              </>
            ) : null}
          </div>

          <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
            <div className="font-display text-[12.5px] font-bold text-foreground">{policyHeadline(livePolicy)}</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{policyDetail(livePolicy)}</p>
            {values.allowPartial && (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                Anything left unpaid stays outstanding against the tenant, and they keep showing as partly
                unpaid until it&apos;s collected.
              </p>
            )}
          </div>
        </div>
      )}

      {shown('deposit') && (
        <div className="flex flex-col gap-2">
          {sections.length > 1 && <span className={sectionLabel}>Security deposit</span>}
          <div className={card}>
            <div className="px-4 pb-1 pt-3.5">
              <Toggle
                checked={values.depositEnabled}
                onChange={() => set('depositEnabled', !values.depositEnabled)}
                label="Collect a deposit"
                sub="Taken from the tenant at move-in"
              />
            </div>

            {values.depositEnabled && (
              <>
                <div className={`${rowBase} border-y border-border/60`}>
                  <span className="flex-1 text-[13.5px] text-foreground/80">
                    How it&apos;s worked out
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      A fixed amount, or a multiple of the room&apos;s rent
                    </span>
                  </span>
                  <Segmented
                    value={values.depositMode}
                    options={DEPOSIT_MODES}
                    onChange={(v) => set('depositMode', v)}
                    ariaLabel="Deposit calculation mode"
                  />
                </div>

                {values.depositMode === 'FLAT' ? (
                  <div className={`${rowBase} border-b border-border/60`}>
                    <span className="flex-1 text-[13.5px] text-foreground/80">
                      Amount
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">The same for every tenant</span>
                    </span>
                    <NumberField
                      value={values.depositAmount}
                      onChange={(v) => set('depositAmount', v)}
                      prefix="₹"
                      ariaLabel="Deposit amount"
                    />
                  </div>
                ) : (
                  <div className={`${rowBase} border-b border-border/60`}>
                    <span className="flex-1 text-[13.5px] text-foreground/80">
                      Months of rent
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Multiplied by each room&apos;s rent when you invite a tenant
                      </span>
                    </span>
                    <Stepper value={values.depositMonths} onChange={(v) => set('depositMonths', v)} min={1} max={12} />
                  </div>
                )}

                <div className="px-4 pb-3.5 pt-2.5">
                  <Toggle
                    checked={values.depositRefundable}
                    onChange={() => set('depositRefundable', !values.depositRefundable)}
                    label="Refundable at move-out"
                    sub="Returned in the move-out settlement, less any deductions"
                  />
                </div>
              </>
            )}
          </div>

          {/* The consequence, before saving: the stored policy is a mode and a
              number, but what a tenant actually pays is only computed later,
              per room, at invite time. */}
          <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              What each tenant pays
            </div>
            <div className="mt-1 font-display text-[19px] font-bold leading-tight text-foreground tabular-nums">
              {preview.headline}
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{preview.detail}</p>
            {preview.warning && (
              <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11.5px] font-medium leading-relaxed text-destructive">
                {preview.warning}
              </p>
            )}
          </div>
        </div>
      )}

      {shown('lateFee') && (
        <div className="flex flex-col gap-2">
          {sections.length > 1 && <span className={sectionLabel}>Late fee</span>}
          <div className={card}>
            <div className="px-4 pb-1 pt-3.5">
              <Toggle
                checked={values.lateFeeEnabled}
                onChange={() => set('lateFeeEnabled', !values.lateFeeEnabled)}
                label="Charge a late fee"
                sub="Applied once the grace period ends"
              />
            </div>

            {values.lateFeeEnabled && (
              <>
                <div className={`${rowBase} border-y border-border/60`}>
                  <span className="flex-1 text-[13.5px] text-foreground/80">Charge type</span>
                  <Segmented
                    value={values.chargeType}
                    options={CHARGE_TYPES}
                    onChange={(v) => set('chargeType', v)}
                    ariaLabel="Late fee charge type"
                  />
                </div>
                <div className={`${rowBase} border-b border-border/60`}>
                  <span className="flex-1 text-[13.5px] text-foreground/80">Amount</span>
                  <NumberField
                    value={values.lateFeeAmount}
                    onChange={(v) => set('lateFeeAmount', v)}
                    prefix={values.chargeType === 'PERCENTAGE' ? undefined : '₹'}
                    suffix={values.chargeType === 'PERCENTAGE' ? '%' : undefined}
                    ariaLabel="Late fee amount"
                  />
                </div>
                <div className={rowBase}>
                  <span className="flex-1 text-[13.5px] text-foreground/80">
                    Maximum cap
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">0 for no cap</span>
                  </span>
                  <NumberField
                    value={values.maxLateFee}
                    onChange={(v) => set('maxLateFee', v)}
                    prefix="₹"
                    ariaLabel="Maximum late fee"
                  />
                </div>
              </>
            )}
          </div>
          {/* Grace days live in the Rent schedule section, so say where the
              threshold comes from rather than leaving it implicit. */}
          {values.lateFeeEnabled && sections.length === 1 && (
            <p className={sectionNote}>
              Applies after the {values.graceDays}-day grace period set in Rent schedule.
            </p>
          )}
        </div>
      )}

      {shown('agreement') && (
        <div className="flex flex-col gap-2">
          {sections.length > 1 && <span className={sectionLabel}>Agreement</span>}
          <div className={`${card} flex items-center justify-between gap-3 px-4 py-3.5`}>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-foreground">Duration (months)</div>
              <div className="text-[11px] text-muted-foreground">Default lease length offered to new tenants</div>
            </div>
            <Stepper value={values.agreementMonths} onChange={(v) => set('agreementMonths', v)} min={1} max={120} />
          </div>
        </div>
      )}

      <SaveBar
        visible={dirty}
        pending={updateMutation.isPending}
        onSave={save}
        onDiscard={() => setValues(baseline)}
        label={`Save ${title.toLowerCase()}`}
      />
    </div>
  );
}

const ROLE_STYLE: Record<string, { dot: string; cell: string }> = {
  raised: { dot: 'bg-[#3F7D58]', cell: 'bg-[#E6F0E8] text-[#2F5B41] font-bold' },
  due: { dot: 'bg-primary', cell: 'bg-primary text-primary-foreground font-bold' },
  grace: { dot: 'bg-[#D9A94E]', cell: 'bg-[#F8EFDC] text-[#7A5510] font-semibold' },
  late: { dot: 'bg-[#B3402F]', cell: 'bg-[#F7E4DF] text-[#8E3122] font-semibold' },
  plain: { dot: 'bg-border', cell: 'text-muted-foreground' },
};

/**
 * One rent month, drawn.
 *
 * Colour alone would not carry this — the same information is in the timeline
 * beneath, which names each day and says what happens on it, so the calendar
 * is the fast read and the list is the accessible one.
 */
function RentMonthPreview({
  generationDay,
  dueDay,
  graceDays,
}: {
  generationDay: number;
  dueDay: number;
  graceDays: number;
}) {
  const schedule = { generationDay, dueDay, graceDays };
  const days = monthDays(schedule);
  const milestones = scheduleMilestones(schedule);

  return (
    <div className={`${card} flex flex-col gap-3.5 p-4`}>
      <div className="grid grid-cols-7 gap-1">
        {days.map(({ day, role }) => (
          <span
            key={day}
            className={`flex h-8 items-center justify-center rounded-lg text-[12px] tabular-nums ${ROLE_STYLE[role].cell}`}
          >
            {day}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        {milestones.map((m) => (
          <div key={m.role} className="flex items-start gap-2.5">
            <span className={`mt-[5px] h-2 w-2 flex-none rounded-full ${ROLE_STYLE[m.role].dot}`} />
            <span className="min-w-0 flex-1">
              <span className="text-[12.5px] font-semibold text-foreground">
                {m.label} · day {m.day}
              </span>
              <span className="mt-0.5 block text-[11px] leading-[1.45] text-muted-foreground">{m.detail}</span>
            </span>
          </div>
        ))}
      </div>

      <p className="border-t border-border/60 pt-3 text-[12px] font-medium text-foreground">
        {describeSchedule(schedule)}
      </p>

      {crossesMonthEnd(schedule) && (
        <p className="text-[11px] leading-[1.45] text-muted-foreground">
          This schedule runs into the next month, so the days above are not all in the same one.
        </p>
      )}
    </div>
  );
}
