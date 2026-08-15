import { Check, Pencil } from 'lucide-react';
import { eyebrow, h1, sub } from '@features/owner-onboarding/components/stepStyles';
import { floorTally, type DraftFloor } from '../hostelBuilder';

/**
 * The finished building.
 *
 * Rooms and beds only — deliberately no monthly income figure. `base_rent` is
 * an invite default that tenants routinely differ from, and no bed is let
 * yet, so any revenue number here would be invented.
 */
export function ReviewStep({
  hostelName,
  floors,
  onEditFloor,
}: {
  hostelName: string;
  floors: DraftFloor[];
  onEditFloor: (index: number) => void;
}) {
  const totals = floors.reduce(
    (acc, floor) => {
      const tally = floorTally(floor);
      return { rooms: acc.rooms + tally.rooms, beds: acc.beds + tally.beds };
    },
    { rooms: 0, beds: 0 },
  );

  return (
    <div>
      <div className={eyebrow}>YOUR HOSTEL</div>
      <h1 className={h1}>{hostelName || 'Your hostel'} is ready.</h1>
      <p className={sub}>
        {floors.length} {floors.length === 1 ? 'floor' : 'floors'} · {totals.rooms} rooms · {totals.beds} beds.
        Everything here stays editable from the Rooms tab.
      </p>

      <ul className="flex max-w-[460px] flex-col gap-2">
        {floors.map((floor, i) => {
          const tally = floorTally(floor);
          const sizes = [...new Set(floor.rooms.map((room) => room.capacity))].sort((a, b) => a - b);
          return (
            <li key={floor.id || i}>
              <button
                type="button"
                onClick={() => onEditFloor(i)}
                style={{ animation: 'stayoRiseIn .4s ease both', animationDelay: `${i * 70}ms` }}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3.5 text-left hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-display text-[14.5px] font-bold text-foreground">
                    {floor.saved && <Check className="h-3.5 w-3.5 text-success" strokeWidth={3} />}
                    {floor.name}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] font-medium text-muted-foreground">
                    {tally.rooms} rooms · {tally.beds} beds
                    {sizes.length > 0 && ` · ${sizes.map((s) => `${s}-sharing`).join(', ')}`}
                  </span>
                </span>
                <Pencil className="h-4 w-4 flex-none text-muted-foreground/60" strokeWidth={2} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
