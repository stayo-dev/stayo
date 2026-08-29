import { useEffect, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { CalendarDays, Check, ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon } from 'lucide-react';

import { C, FONT } from './discoverTheme';

/**
 * Move-in date picker.
 *
 * Replaces a fixed row of five offset buttons (Today/Tomorrow/+7/+15/+30)
 * that had no way to reach any other date. Unlike DateOfBirthField's
 * day/month/year columns (right for a birth date, where the current month is
 * never the answer), a move-in date is near-future — a single month-grid
 * calendar reaches the likely answer in one glance, so react-day-picker's
 * month view is used instead of the column-scroller pattern.
 */

/**
 * Local Y-M-D, not `toISOString().slice(0, 10)` — that's UTC-based and
 * disagrees with the local "today" used for the disabled-dates boundary
 * below in timezones ahead of UTC (e.g. IST just after local midnight),
 * which would otherwise mark today itself as disabled.
 */
function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const dayClassNames = {
  root: 'p-0 font-sans',
  months: 'flex flex-col',
  month: 'space-y-3',
  caption: 'flex items-center justify-between px-1',
  caption_label: 'text-[13.5px] font-bold',
  nav: 'flex items-center gap-1',
  nav_button: 'flex h-7 w-7 items-center justify-center rounded-full',
  nav_button_previous: '',
  nav_button_next: '',
  table: 'w-full border-collapse',
  head_row: 'flex',
  head_cell: 'w-[14.2857%] pb-1.5 text-center text-[10px] font-bold uppercase tracking-[.08em]',
  row: 'flex w-full',
  cell: 'w-[14.2857%] p-0.5 text-center',
  day: 'flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold mx-auto',
  day_today: 'font-extrabold',
  day_selected: '',
  day_outside: 'opacity-0 pointer-events-none',
  day_disabled: 'opacity-30',
  day_hidden: 'invisible',
};

export default function MoveInDateField({
  value,
  onChange,
  today = new Date(),
}: {
  /** `YYYY-MM-DD` */
  value: string;
  onChange: (iso: string) => void;
  /** Injectable so the surrounding logic stays testable and deterministic. */
  today?: Date;
}) {
  const [open, setOpen] = useState(false);
  const committed = value ? parseISODate(value) : undefined;
  const [draft, setDraft] = useState<Date | undefined>(committed);

  useEffect(() => {
    if (open) setDraft(committed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = () => {
    if (!draft) return;
    onChange(toISODate(draft));
    setOpen(false);
  };

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-[13px] border bg-white px-3.5 py-3 text-left"
        style={{ borderColor: C.lineInput }}
      >
        <CalendarDays className="h-4 w-4 flex-none" style={{ color: C.clay }} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold" style={{ color: committed ? C.inkSoft : C.textMuted }}>
          {committed ? formatDisplayDate(committed) : 'Select a move-in date'}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'rgba(20,16,13,.45)' }}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-[440px] rounded-t-[20px]"
            style={{ background: C.cardWarm, padding: '16px 14px calc(16px + env(safe-area-inset-bottom))' }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Select move-in date"
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full" style={{ background: C.line }} />

            <div className="mb-3 font-display text-[16px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
              Move-in date
            </div>

            <DayPicker
              mode="single"
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft ?? startOfToday}
              disabled={{ before: startOfToday }}
              showOutsideDays={false}
              className="mx-auto"
              classNames={dayClassNames}
              modifiersStyles={{
                selected: { background: C.ink, color: '#fff' },
                today: { color: C.clay },
                disabled: { color: C.textFaint },
              }}
              styles={{
                caption_label: { fontFamily: FONT.display, color: C.text },
                head_cell: { color: C.textMuted },
                day: { color: C.inkSoft },
                nav_button: { color: C.textMuted },
              }}
              components={{
                IconLeft: () => <ChevronLeftIcon className="h-4 w-4" />,
                IconRight: () => <ChevronRightIcon className="h-4 w-4" />,
              }}
            />

            <button
              type="button"
              onClick={commit}
              disabled={!draft}
              className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
              style={{ background: C.clay, boxShadow: '0 6px 16px rgba(180,106,85,.3)' }}
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
