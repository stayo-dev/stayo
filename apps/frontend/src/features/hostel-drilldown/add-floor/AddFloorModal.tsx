import { useEffect, useState } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

interface AddFloorModalProps {
  open: boolean;
  /** "Fourth floor" after "Third floor" — from `suggestFloorName`. */
  suggestedName: string;
  /** The hostel's usual rent per bed, so rooms made with the floor aren't ₹0. */
  defaultRent: number | null;
  /** The room numbers a floor of this name and size would get (401, 402…). */
  roomNumbersFor: (name: string, count: number) => string[];
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; roomCount?: number; bedsPerRoom?: number; rent?: number }) => void | Promise<void>;
}

/** The backend refuses a room with more beds than this (`property-service`). */
const MAX_BEDS = 20;

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

function rangeLabel(numbers: string[]): string {
  if (numbers.length === 0) return '';
  if (numbers.length === 1) return numbers[0]!;
  return `${numbers[0]}–${numbers[numbers.length - 1]}`;
}

/**
 * Add Floor. Submits to the real `POST /api/floors` (+ `POST /api/rooms` per
 * room) via `useHostelRooms`.
 *
 * Opens with the next floor's name in the owner's own style and, when
 * starting with rooms, shows the real numbers they will get. It used to
 * suggest "2th Floor" and number rooms "Four-01", and kept the last name
 * typed between openings.
 */
export function AddFloorModal({ open, suggestedName, defaultRent, roomNumbersFor, isSubmitting, onClose, onSubmit }: AddFloorModalProps) {
  const [name, setName] = useState(suggestedName);
  const [startWithRooms, setStartWithRooms] = useState(true);
  const [roomCount, setRoomCount] = useState(4);
  const [bedsPerRoom, setBedsPerRoom] = useState(4);
  const [rent, setRent] = useState(defaultRent ? String(defaultRent) : '');

  useEffect(() => {
    if (!open) return;
    setName(suggestedName);
    setRent(defaultRent ? String(defaultRent) : '');
    // Only on opening — see AddRoomModal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = name.trim();
  const numbers = startWithRooms && trimmed ? roomNumbersFor(trimmed, roomCount) : [];
  const totalBeds = roomCount * bedsPerRoom;
  const canSubmit = trimmed.length > 0 && !isSubmitting;

  const stepper = (value: number, set: (fn: (n: number) => number) => void, max: number, label: string) => (
    <div className="flex items-center gap-2.5">
      <button type="button" aria-label={`Fewer ${label}`} onClick={() => set((n) => Math.max(1, n - 1))} className="flex h-8 w-8 items-center justify-center rounded-md bg-muted font-bold text-primary">
        −
      </button>
      <span className="w-6 text-center font-display text-[17px] font-extrabold tabular-nums text-foreground">{value}</span>
      <button type="button" aria-label={`More ${label}`} onClick={() => set((n) => Math.min(max, n + 1))} className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground font-bold text-background">
        +
      </button>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Add floor"
      footer={
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              name: trimmed,
              roomCount: startWithRooms ? roomCount : undefined,
              bedsPerRoom: startWithRooms ? bedsPerRoom : undefined,
              rent: startWithRooms && Number(rent) > 0 ? Number(rent) : undefined,
            })
          }
          className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? 'Adding…' : `Add ${trimmed || 'floor'}${startWithRooms ? ` + ${roomCount} room${roomCount === 1 ? '' : 's'}` : ''}`}
        </button>
      }
    >
      <div className="flex flex-col gap-4.5">
        <label className="block">
          <span className={labelStyle}>Floor name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-[11px] border-[1.5px] border-primary bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none" />
        </label>

        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <button type="button" onClick={() => setStartWithRooms((v) => !v)} aria-pressed={startWithRooms} className="flex w-full items-center justify-between p-3.5 text-left">
            <div>
              <div className="font-display text-[13px] font-bold text-foreground">Start this floor with rooms</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">Create rooms now — edit any later</div>
            </div>
            <span className={`relative h-6 w-10.5 flex-none rounded-full transition-colors ${startWithRooms ? 'bg-primary' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${startWithRooms ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
            </span>
          </button>
          {startWithRooms && (
            <div className="flex flex-col gap-3.5 border-t border-border p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-foreground/80">Number of rooms</span>
                {stepper(roomCount, setRoomCount, 30, 'rooms')}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-foreground/80">Beds per room</span>
                {stepper(bedsPerRoom, setBedsPerRoom, MAX_BEDS, 'beds')}
              </div>
              <label className="flex items-center justify-between gap-3">
                <span className="text-[12.5px] font-medium text-foreground/80">Rent per bed</span>
                <span className="flex w-32 items-center rounded-[10px] border border-border bg-card px-2.5">
                  <span className="text-sm font-semibold text-muted-foreground">₹</span>
                  <input value={rent} onChange={(e) => setRent(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="8000" className="min-w-0 flex-1 bg-transparent px-1.5 py-2 text-sm font-semibold text-foreground focus:outline-none" />
                </span>
              </label>
            </div>
          )}
        </div>

        {startWithRooms && numbers.length > 0 && (
          <div className="rounded-xl border border-warning/25 bg-warning/10 p-3.5 text-[12.5px] leading-relaxed text-warning">
            Creates <b>{trimmed}</b> with rooms <b>{rangeLabel(numbers)}</b>, {bedsPerRoom} bed{bedsPerRoom === 1 ? '' : 's'} each — <b>{totalBeds} beds</b> added.
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
