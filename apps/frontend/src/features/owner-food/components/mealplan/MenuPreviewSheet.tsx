import { useState } from 'react';
import { Download, Loader2, Printer } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { foodService } from '@features/food/api';
import { titleCaseText } from '@shared/lib/textFormat';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import { DAY_ORDER, type DayKey } from '../../hooks/useFoodSchedule';
import { cellAt, formatCellItems, type WeekGrid } from '../../weekGrid';

interface MenuPreviewSheetProps {
  open: boolean;
  onClose: () => void;
  grid: WeekGrid;
  hostelId: string | undefined;
  hostelName: string;
  /** `YYYY-MM`. */
  month: string;
  monthLabel: string;
  isDraft: boolean;
}

const DAY_LABEL: Record<DayKey, string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday',
  FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
};

/** Matches `EMPTY_CELL` in the backend's `menu-content.ts`. */
const EMPTY = '—';

/**
 * The week as it will print, before it prints.
 *
 * The owner is about to take this to a shop, print it and tape it to a wall,
 * so the point of this screen is that nothing on the paper is a surprise —
 * which days are still empty, how long a dish list runs, whether it is still
 * a draft. The layout deliberately mirrors the PDF rather than the editor.
 *
 * It is a *preview*, not the artifact: the PDF is rendered by the backend from
 * the live schedule, so what downloads is never a screenshot of this. See
 * ADR-144.
 */
export function MenuPreviewSheet({
  open,
  onClose,
  grid,
  hostelId,
  hostelName,
  month,
  monthLabel,
  isDraft,
}: MenuPreviewSheetProps) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!hostelId || downloading) return;
    setDownloading(true);
    try {
      const { blob, filename } = await foodService.downloadMenuPdf(hostelId, month);
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
    <BottomSheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Menu preview"
      footer={
        <button
          type="button"
          onClick={download}
          disabled={!hostelId || downloading}
          className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-display text-[13.5px] font-bold text-primary-foreground disabled:opacity-50"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloading ? 'Preparing…' : 'Download to print'}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-[15px] font-extrabold text-foreground">{hostelName}</p>
            <p className="text-[12px] text-muted-foreground">Weekly menu · {monthLabel}</p>
          </div>
          {isDraft && (
            <span className="flex-none rounded-full border border-primary/40 bg-primary/[0.06] px-2.5 py-1 text-[10.5px] font-bold text-primary">
              Draft
            </span>
          )}
        </div>

        {/* Wide on a phone by nature — seven days against four meals. Scrolls
            inside its own box rather than making the sheet scroll sideways. */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="bg-muted/60">
                <th className="border-b border-border px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  Day
                </th>
                {FOOD_SLOTS.map((slot) => (
                  <th
                    key={slot.key}
                    className="border-b border-l border-border px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-foreground"
                  >
                    {slot.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_ORDER.map((day, index) => (
                <tr key={day} className={index % 2 === 1 ? 'bg-muted/25' : undefined}>
                  <td className="border-b border-border px-3 py-2.5 align-top text-[12.5px] font-bold text-foreground">
                    {DAY_LABEL[day]}
                  </td>
                  {FOOD_SLOTS.map((slot) => {
                    const cell = cellAt(grid, day, slot.key as MealSlotKey);
                    const text = formatCellItems(cell, ', ');
                    return (
                      <td
                        key={slot.key}
                        className={`border-b border-l border-border px-3 py-2.5 align-top text-[12.5px] leading-snug ${
                          text ? 'text-foreground' : 'text-muted-foreground'
                        }`}
                      >
                        {text ? titleCaseText(text) : EMPTY}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <Printer className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={1.8} />
          Prints as one A4 landscape sheet with your hostel's name, serving times and a QR to your
          Stayo page. Meant for the kitchen and canteen wall.
        </p>
      </div>
    </BottomSheet>
  );
}
