import { useEffect, useMemo, useRef } from 'react';
import {
  MONTH_NAMES,
  buildDayOptions,
  buildMonthOptions,
  buildYearOptions,
  clampToRange,
  formatDateParts,
  parseIso,
  toIso,
  type DateParts,
} from '@shared/lib/dateDial';

interface DateDialPickerProps {
  /** `YYYY-MM-DD`, or empty for nothing chosen yet. */
  value: string;
  onChange: (value: string) => void;
  /** `YYYY-MM-DD`, inclusive. */
  min?: string;
  max?: string;
  /** Where the dials start when nothing is chosen. Defaults to today. */
  defaultDate?: string;
  label?: string;
}

const ITEM_H = 40;

/**
 * Three dials — day, month, year — instead of a calendar.
 *
 * `<input type="date">` hands an owner on a phone a `mm/dd/yyyy` placeholder
 * whose field order follows the *browser's* locale, so someone entering
 * 5 August is shown `mm/dd/yyyy` and reasonably types 5/8, producing 8 May.
 * That date then drives a tenancy's start, its rent months and its agreement.
 * Naming the month removes the ambiguity entirely: there is no order to get
 * wrong when the middle dial says "August".
 *
 * Bounds are honoured by *offering less*, not by rejecting afterwards — with
 * `max` set to today, next month simply is not on the dial, so an owner
 * recording an existing tenant cannot pick a future move-in and be told off
 * for it. The chosen date is echoed underneath in words, because a dial that
 * has scrolled a little is easy to misread. See ADR-146.
 */
export function DateDialPicker({
  value,
  onChange,
  min,
  max,
  defaultDate,
  label,
}: DateDialPickerProps) {
  const minParts = useMemo(() => parseIso(min), [min]);
  const maxParts = useMemo(() => parseIso(max), [max]);

  const fallback = useMemo(() => {
    const parsed = parseIso(defaultDate) ?? parseIso(new Date().toISOString().slice(0, 10));
    return clampToRange(parsed ?? { year: 2026, month: 1, day: 1 }, minParts, maxParts);
  }, [defaultDate, minParts, maxParts]);

  const selected: DateParts = useMemo(
    () => clampToRange(parseIso(value) ?? fallback, minParts, maxParts),
    [value, fallback, minParts, maxParts],
  );

  const years = useMemo(
    () => buildYearOptions(minParts, maxParts, fallback.year),
    [minParts, maxParts, fallback.year],
  );
  const months = useMemo(
    () => buildMonthOptions(selected.year, minParts, maxParts),
    [selected.year, minParts, maxParts],
  );
  const days = useMemo(
    () => buildDayOptions(selected.year, selected.month, minParts, maxParts),
    [selected.year, selected.month, minParts, maxParts],
  );

  /**
   * Every change re-clamps the whole date rather than the moved dial alone —
   * turning the year from 2028 to 2026 with 29 February selected has to land
   * on the 28th, not on an impossible date the form would later reject.
   */
  const commit = (patch: Partial<DateParts>) => {
    onChange(toIso(clampToRange({ ...selected, ...patch }, minParts, maxParts)));
  };

  // An empty field should not look like a chosen date, but the dials still
  // have to start somewhere. Publishing the fallback on mount means what the
  // owner sees and what the form holds are the same thing.
  useEffect(() => {
    if (!parseIso(value)) onChange(toIso(fallback));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {label && (
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}

      <div className="relative overflow-hidden rounded-[14px] border border-border bg-card">
        {/* The selected row, marked once behind all three dials rather than
            per column, so the eye reads one line across. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 border-y border-primary/30 bg-primary/[0.06]"
          style={{ height: ITEM_H }}
        />
        <div className="relative flex" style={{ height: ITEM_H * 5 }}>
          <Dial
            options={days}
            value={selected.day}
            onSelect={(day) => commit({ day })}
            render={(day) => String(day)}
            ariaLabel="Day"
          />
          <Dial
            options={months}
            value={selected.month}
            onSelect={(month) => commit({ month })}
            render={(month) => MONTH_NAMES[month - 1]}
            ariaLabel="Month"
            wide
          />
          <Dial
            options={years}
            value={selected.year}
            onSelect={(year) => commit({ year })}
            render={(year) => String(year)}
            ariaLabel="Year"
          />
        </div>
      </div>

      <p className="mt-1.5 text-[12.5px] font-semibold text-foreground">{formatDateParts(selected)}</p>
    </div>
  );
}

function Dial<T extends number>({
  options,
  value,
  onSelect,
  render,
  ariaLabel,
  wide,
}: {
  options: T[];
  value: T;
  onSelect: (value: T) => void;
  render: (value: T) => string;
  ariaLabel: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const index = Math.max(0, options.indexOf(value));

  // Keep the wheel showing what the form holds — including when another dial
  // clamped this one, which the owner never touched.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const target = index * ITEM_H;
    if (Math.abs(node.scrollTop - target) > 1) node.scrollTop = target;
  }, [index, options.length]);

  /**
   * Committed after scrolling settles rather than on every frame: firing per
   * pixel would re-render the other two dials mid-flick and fight the scroll.
   */
  const onScroll = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const node = ref.current;
      if (!node) return;
      const next = options[Math.round(node.scrollTop / ITEM_H)];
      if (next !== undefined && next !== value) onSelect(next);
    }, 120);
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={ariaLabel}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(e) => {
        // A wheel is pointer-first, so without this it is unusable by keyboard.
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const next = options[index + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next !== undefined) onSelect(next);
      }}
      className={`h-full snap-y snap-mandatory overflow-y-auto scrollbar-hide outline-none focus-visible:bg-muted/40 ${
        wide ? 'flex-[1.4]' : 'flex-1'
      }`}
      // Half a dial's height of padding above and below, so the first and last
      // options can reach the centre line like any other.
      style={{ scrollSnapType: 'y mandatory', paddingBlock: ITEM_H * 2 }}
    >
      {options.map((option) => (
        <div
          key={option}
          role="option"
          aria-selected={option === value}
          onClick={() => onSelect(option)}
          className={`flex cursor-pointer snap-center items-center justify-center text-[14px] transition-colors ${
            option === value ? 'font-bold text-foreground' : 'text-muted-foreground'
          }`}
          style={{ height: ITEM_H }}
        >
          {render(option)}
        </div>
      ))}
    </div>
  );
}
