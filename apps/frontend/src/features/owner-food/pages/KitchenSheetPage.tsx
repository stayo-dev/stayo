import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Loader2, Share2 } from 'lucide-react';
import { MEAL_CATEGORY_META } from '@shared/mocks/food';
import { titleCaseText } from '@shared/lib/textFormat';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { foodService } from '@features/food/api';
import { formatTimeRange } from '@features/food/mealTimings';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { useFoodSchedule } from '../hooks/useFoodSchedule';
import { useMealTimings } from '../hooks/useMealTimings';
import { buildKitchenMessage, whatsappShareUrl } from '../kitchenSheet';
import { cellAt, dayKeyFor, DAY_ORDER, formatCellItems, isFilled, slotsInUse, type WeekGridCell } from '../weekGrid';

/** A gap in a meal the hostel does serve. See `slotsInUse` and ADR-147. */
const GAP = '—';

/**
 * Dish names as they should read, and a dash where a meal is unplanned.
 *
 * "Not set" describes the app; a cook reading this off a wall wants the
 * kitchen's language. Display only — see ADR-142.
 */
function dishes(cell: WeekGridCell | null | undefined): string {
  return isFilled(cell) ? titleCaseText(formatCellItems(cell)) || GAP : GAP;
}

/**
 * The cook's and kitchen staff's only surface. Deliberately the dumbest screen
 * in the product: no navigation, large type, high contrast, survives a kitchen
 * wall.
 *
 * The hostel comes from `?hostelId=`, carried over by the Food tab's link, and
 * falls back to the primary hostel only when the screen is reached directly.
 * It never picks "the first hostel": a multi-property owner reading Sri
 * Lakshmi's week and tapping Send to kitchen must not get Sunrise Residency's menu
 * pre-filled into a WhatsApp share. The switcher is here too, so this screen is
 * not a dead end for the other properties.
 */
export function KitchenSheetPage() {
  const session = useOwnerSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostelId = searchParams.get('hostelId') ?? session.primaryHostelId;
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const schedule = useFoodSchedule(hostelId ?? undefined, currentMonth);
  const { mealTimings } = useMealTimings(hostelId ?? undefined);
  const [downloading, setDownloading] = useState(false);

  const now = new Date();
  const today = dayKeyFor(now);
  const tomorrow = DAY_ORDER[(DAY_ORDER.indexOf(today) + 1) % DAY_ORDER.length];
  const hostelName = session.hostels.find((h) => h.id === hostelId)?.name ?? 'Hostel';

  // Meals this kitchen actually runs. One it never runs is dropped rather
  // than shown as a dash every day — see ADR-147.
  const served = slotsInUse(schedule.weekGrid);

  const message = buildKitchenMessage({ grid: schedule.weekGrid, now, hostelName, timings: mealTimings });

  /**
   * Downloads the designed A4 sheet rather than calling `window.print()`.
   *
   * That printed the *screen* — app chrome stripped by `print:hidden` classes,
   * at whatever size the browser chose — through a phone print dialog that is
   * unreliable on exactly the devices these owners use. The real menu sheet
   * already exists, in the brand fonts, and is what belongs on a wall. See
   * ADR-144.
   */
  const download = async () => {
    if (!hostelId || downloading) return;
    setDownloading(true);
    try {
      const { blob, filename } = await foodService.downloadMenuPdf(hostelId, currentMonth);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      stayoToast.error("Couldn't build the menu sheet just now. Try again in a moment.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-8 print:px-0 print:py-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-foreground">
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h1>
          <p className="text-[13px] font-medium text-muted-foreground">{hostelName}</p>
        </div>
        <div className="print:hidden">
          <HostelSwitcher
            hostels={session.hostels}
            selectedId={hostelId}
            onSelect={(id) => setSearchParams({ hostelId: id }, { replace: true })}
          />
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border border-y border-border">
        {served.map((slot) => {
          const cell = cellAt(schedule.weekGrid, today, slot);
          return (
            <div key={slot} className="flex items-baseline gap-4 py-4">
              <span className="w-[110px] flex-none">
                <span className="block text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                  {MEAL_CATEGORY_META[slot].label}
                </span>
                {/* The cook is the person who most needs the serving window,
                    and the paper charts this replaces never carry it. */}
                {mealTimings[slot]?.enabled && (
                  <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground/80">
                    {formatTimeRange(mealTimings[slot])}
                  </span>
                )}
              </span>
              <span className={`font-display text-[24px] font-extrabold tracking-tight ${isFilled(cell) ? 'text-foreground' : 'italic text-muted-foreground/60'}`}>
                {dishes(cell)}
              </span>
            </div>
          );
        })}
      </div>

      {/* One labelled row per meal. This was all four joined by "·" into a
          single run, so nothing marked where breakfast ended and lunch began —
          on the block whose entire job is telling a cook what to prep tonight. */}
      <div className="rounded-2xl bg-muted/50 p-4">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Tomorrow — prep tonight</span>
        <dl className="mt-2 flex flex-col gap-1.5">
          {served.map((slot) => {
            const cell = cellAt(schedule.weekGrid, tomorrow, slot);
            return (
              <div key={slot} className="flex items-baseline gap-3">
                <dt className="w-[86px] flex-none text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  {MEAL_CATEGORY_META[slot].label}
                </dt>
                <dd className={`text-[14px] font-semibold ${isFilled(cell) ? 'text-foreground' : 'italic text-muted-foreground/60'}`}>
                  {dishes(cell)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      <div className="flex gap-2.5 print:hidden">
        <button
          type="button"
          onClick={download}
          disabled={!hostelId || downloading}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-border py-3 font-display text-[13.5px] font-bold text-foreground disabled:opacity-50"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloading ? 'Preparing…' : 'Print the week'}
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
