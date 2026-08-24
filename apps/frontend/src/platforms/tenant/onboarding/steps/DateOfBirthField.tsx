import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check } from 'lucide-react';
import {
  clampToMonth,
  daysInMonth,
  defaultSelection,
  formatDisplayDate,
  parseISODate,
  selectableYears,
  toISODate,
  validateDateOfBirth,
  MONTHS,
  type DateParts,
} from './dateOfBirth';

/**
 * Date-of-birth picker.
 *
 * Replaces an `<input type="date">` whose calendar affordance was hidden with
 * `[&::-webkit-calendar-picker-indicator]:opacity-0`, leaving a dead-looking
 * `mm/dd/yyyy` with nothing to tap and month-first ordering that is wrong here.
 *
 * Three columns rather than a calendar: for a birth date the current month is
 * never the answer, so a month-paging calendar opens roughly 240 taps from
 * where anyone needs to be. Day/month/year reaches any date in three gestures.
 *
 * The sheet paints its own opaque surface instead of inheriting the onboarding
 * sky gradient, so it reads identically at every hour — a picker is a modal
 * decision and should not get harder to read at night.
 */

const SURFACE = '#FBF7F1';
const INK = '#2A2521';
const MUTED = '#8A7F75';
const ACCENT = '#B46A55';

function Column({
  label,
  values,
  selected,
  format,
  onSelect,
}: {
  label: string;
  values: number[];
  selected: number;
  format?: (value: number) => string;
  onSelect: (value: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Bring the current value into view when the sheet opens, so the list starts
  // where the person already is rather than at the top.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <div className="min-w-0 flex-1">
      <div
        className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-[.12em]"
        style={{ color: MUTED }}
      >
        {label}
      </div>
      <div
        ref={listRef}
        className="h-[188px] overflow-y-auto rounded-xl"
        style={{ background: '#F1EAE0', border: '1px solid #E7DDCE', scrollbarWidth: 'thin' }}
      >
        {values.map((value) => {
          const isSelected = value === selected;
          return (
            <button
              key={value}
              ref={isSelected ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(value)}
              aria-pressed={isSelected}
              className="w-full px-1 py-2 text-center text-[13.5px] font-semibold"
              style={{
                background: isSelected ? ACCENT : 'transparent',
                color: isSelected ? '#fff' : INK,
              }}
            >
              {format ? format(value) : value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateOfBirthField({
  value,
  onChange,
  today = new Date(),
}: {
  /** `YYYY-MM-DD`, or '' when nothing has been chosen. */
  value: string;
  onChange: (iso: string) => void;
  /** Injectable so the surrounding logic stays testable and deterministic. */
  today?: Date;
}) {
  const [open, setOpen] = useState(false);
  const committed = useMemo(() => parseISODate(value), [value]);
  const [draft, setDraft] = useState<DateParts>(() => committed ?? defaultSelection(today));

  // Reopening after a change should start from what is currently saved, not
  // from whatever was last abandoned in the sheet.
  useEffect(() => {
    if (open) setDraft(committed ?? defaultSelection(today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const years = useMemo(() => selectableYears(today), [today]);
  const days = useMemo(
    () => Array.from({ length: daysInMonth(draft.month, draft.year) }, (_, i) => i + 1),
    [draft.month, draft.year],
  );
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const check = validateDateOfBirth(draft, today);
  const committedCheck = validateDateOfBirth(committed, today);

  const update = (patch: Partial<DateParts>) => setDraft((prev) => clampToMonth({ ...prev, ...patch }));

  const commit = () => {
    if (!check.ok) return;
    onChange(toISODate(draft));
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-[10px] text-left"
        style={{
          background: '#F6F1EA',
          border: `1px solid ${committed ? '#E7DDCE' : '#E7DDCE'}`,
          padding: '11px 13px',
        }}
      >
        <CalendarDays className="h-4 w-4 flex-none" style={{ color: ACCENT }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: committed ? INK : MUTED }}>
          {committed ? formatDisplayDate(committed) : 'Select your date of birth'}
        </span>
        {committedCheck.ok && (
          <span className="flex-none text-[11.5px] font-bold" style={{ color: MUTED }}>
            {committedCheck.age} yrs
          </span>
        )}
      </button>

      {!committedCheck.ok && value ? (
        <div className="mt-1.5 text-[11.5px] font-medium" style={{ color: '#D0473A' }}>
          {committedCheck.message}
        </div>
      ) : null}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'rgba(20,16,13,.45)' }}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-[440px] rounded-t-[20px]"
            style={{ background: SURFACE, padding: '16px 14px calc(16px + env(safe-area-inset-bottom))' }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Select your date of birth"
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full" style={{ background: '#E0D5C6' }} />

            <div className="mb-1 font-display text-[16px] font-extrabold" style={{ color: INK }}>
              Date of birth
            </div>
            <div className="mb-3 text-[12px]" style={{ color: MUTED }}>
              {check.ok ? `${formatDisplayDate(draft)} · ${check.age} years old` : check.message}
            </div>

            <div className="flex gap-2">
              <Column label="Day" values={days} selected={draft.day} onSelect={(day) => update({ day })} />
              <Column
                label="Month"
                values={months}
                selected={draft.month}
                format={(month) => MONTHS[month - 1].slice(0, 3)}
                onSelect={(month) => update({ month })}
              />
              <Column label="Year" values={years} selected={draft.year} onSelect={(year) => update({ year })} />
            </div>

            <button
              type="button"
              onClick={commit}
              disabled={!check.ok}
              className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: ACCENT, boxShadow: '0 6px 16px rgba(180,106,85,.3)' }}
            >
              <Check className="h-4 w-4" />
              Confirm
            </button>
          </div>
        </div>
      )}
    </>
  );
}
