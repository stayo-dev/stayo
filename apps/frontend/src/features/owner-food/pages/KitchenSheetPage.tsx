import { useMemo } from 'react';
import { Printer, Share2 } from 'lucide-react';
import { MEAL_CATEGORY_META } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useFoodSchedule } from '../hooks/useFoodSchedule';
import { buildKitchenMessage, whatsappShareUrl } from '../kitchenSheet';
import { cellAt, dayKeyFor, DAY_ORDER, EMPTY_CELL_LABEL, isFilled, SLOT_ORDER } from '../weekGrid';

/**
 * The cook's and kitchen staff's only surface. Deliberately the dumbest screen
 * in the product: no navigation, no state, nothing tappable except print and
 * share. Large type, high contrast, survives a kitchen wall.
 *
 * Single-hostel for now — uses `session.primaryHostelId` directly. A hostel
 * picker (following the Food tab's `HostelSwitcher` pattern) can be added
 * here when a kitchen-sheet-per-hostel need actually shows up.
 */
export function KitchenSheetPage() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const schedule = useFoodSchedule(hostelId, currentMonth);

  const now = new Date();
  const today = dayKeyFor(now);
  const tomorrow = DAY_ORDER[(DAY_ORDER.indexOf(today) + 1) % DAY_ORDER.length];
  const hostelName = session.hostels.find((h) => h.id === hostelId)?.name ?? 'Hostel';

  const message = buildKitchenMessage({ grid: schedule.weekGrid, now, hostelName });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-8 print:px-0 print:py-0">
      <div>
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-foreground">
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h1>
        <p className="text-[13px] font-medium text-muted-foreground">{hostelName}</p>
      </div>

      <div className="flex flex-col divide-y divide-border border-y border-border">
        {SLOT_ORDER.map((slot) => {
          const cell = cellAt(schedule.weekGrid, today, slot);
          return (
            <div key={slot} className="flex items-baseline gap-4 py-4">
              <span className="w-[110px] flex-none text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                {MEAL_CATEGORY_META[slot].label}
              </span>
              <span className={`font-display text-[24px] font-extrabold tracking-tight ${isFilled(cell) ? 'text-foreground' : 'italic text-muted-foreground/60'}`}>
                {isFilled(cell) ? cell!.item_name : EMPTY_CELL_LABEL}
              </span>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl bg-muted/50 p-4">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Tomorrow — prep tonight</span>
        <p className="mt-1 text-[14px] font-semibold text-foreground">
          {SLOT_ORDER.map((slot) => {
            const cell = cellAt(schedule.weekGrid, tomorrow, slot);
            return isFilled(cell) ? cell!.item_name : EMPTY_CELL_LABEL;
          }).join(' · ')}
        </p>
      </div>

      <div className="flex gap-2.5 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-border py-3 font-display text-[13.5px] font-bold text-foreground"
        >
          <Printer className="h-4 w-4" /> Print
        </button>
        <a
          href={whatsappShareUrl(message)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[44px] flex-[1.3] items-center justify-center gap-2 rounded-xl bg-primary py-3 font-display text-[13.5px] font-bold text-primary-foreground"
        >
          <Share2 className="h-4 w-4" /> Send on WhatsApp
        </a>
      </div>
    </div>
  );
}
