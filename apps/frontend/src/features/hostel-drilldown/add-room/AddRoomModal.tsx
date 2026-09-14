import { useEffect, useState } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { Floor } from '@shared/mocks/rooms';

export interface AddRoomDefaults {
  floorId: string;
  roomNo: string;
  capacity: number;
  rent: number | null;
}

interface AddRoomModalProps {
  open: boolean;
  floors: Floor[];
  /**
   * What the form opens with — guessed from the floor's other rooms by
   * `suggestRoomDefaults`, so adding a room is usually one tap.
   */
  defaults: AddRoomDefaults;
  /** The number to offer next after `roomNo` was added, for "Add another". */
  nextAfter: (roomNo: string, floorId: string) => string;
  isSubmitting?: boolean;
  onClose: () => void;
  onAddFloor: () => void;
  /**
   * Saves the room. Throw (after telling the owner why) to keep the sheet
   * open; on success the sheet closes itself, or stays for "Add another".
   */
  onSubmit: (data: { room_no: string; floor_id?: string; capacity: number; base_rent?: number }) => void | Promise<void>;
}

/** The backend refuses a room with more beds than this (`property-service`). */
const MAX_BEDS = 20;

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/**
 * Add Room. Submits to the real `POST /api/rooms` via `useHostelRooms`.
 *
 * Opened from the "+" under a floor on the building, it arrives with that
 * floor chosen and the next number and the neighbours' beds and rent filled
 * in. It resets to those defaults every time it opens — it used to keep
 * whatever was last typed, including the floor. "Add another" keeps it open
 * with the following number, for an owner entering a whole floor.
 */
export function AddRoomModal({ open, floors, defaults, nextAfter, isSubmitting, onClose, onAddFloor, onSubmit }: AddRoomModalProps) {
  const [number, setNumber] = useState(defaults.roomNo);
  const [floorId, setFloorId] = useState(defaults.floorId);
  const [beds, setBeds] = useState(defaults.capacity);
  const [rent, setRent] = useState(defaults.rent ? String(defaults.rent) : '');
  const [addAnother, setAddAnother] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNumber(defaults.roomNo);
    setFloorId(defaults.floorId);
    setBeds(defaults.capacity);
    setRent(defaults.rent ? String(defaults.rent) : '');
    // Only on opening: `defaults` changes as rooms are added, and the form
    // must not be yanked out from under an owner mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const floorName = floors.find((f) => f.id === floorId)?.name;
  const roomNo = number.trim();
  const canSubmit = roomNo.length > 0 && !isSubmitting;

  const submit = async () => {
    try {
      await onSubmit({ room_no: roomNo, floor_id: floorId || undefined, capacity: beds, base_rent: Number(rent) || undefined });
    } catch {
      return; // the caller has already said why
    }
    stayoToast.success(`Room ${roomNo} added`);
    if (addAnother) setNumber(nextAfter(roomNo, floorId));
    else onClose();
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={floorName ? `Add a room to ${floorName}` : 'Add room'}
      footer={
        <div className="flex flex-col gap-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
            <input type="checkbox" checked={addAnother} onChange={(e) => setAddAnother(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Add another after this one
          </label>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {isSubmitting ? 'Adding…' : roomNo ? `Add room ${roomNo}` : 'Add room'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4.5">
        <p className="-mt-1 text-[12px] text-muted-foreground">Filled in from the rooms already on this floor — change anything.</p>
        <label className="block">
          <span className={labelStyle}>Room name / number</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 106" className="w-full rounded-[11px] border-[1.5px] border-primary bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none" />
        </label>
        <div>
          <span className={labelStyle}>Floor</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {floors.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFloorId(f.id)}
                className={`rounded-lg px-3.5 py-2 font-display text-[12.5px] font-bold ${floorId === f.id ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'}`}
              >
                {f.name}
              </button>
            ))}
            <button type="button" onClick={onAddFloor} className="rounded-lg border border-dashed border-primary/50 px-3.5 py-2 font-display text-[12.5px] font-bold text-primary">
              + New
            </button>
          </div>
        </div>
        <div>
          <span className={labelStyle}>Beds in this room</span>
          <div className="mt-1.5 flex items-center justify-between rounded-[11px] border border-border bg-card p-2">
            <button type="button" aria-label="One bed fewer" onClick={() => setBeds((b) => Math.max(1, b - 1))} className="flex h-9.5 w-9.5 items-center justify-center rounded-lg bg-muted font-display text-xl font-bold text-primary">
              −
            </button>
            <span className="font-display text-2xl font-extrabold tabular-nums text-foreground">{beds}</span>
            <button type="button" aria-label="One more bed" onClick={() => setBeds((b) => Math.min(MAX_BEDS, b + 1))} className="flex h-9.5 w-9.5 items-center justify-center rounded-lg bg-foreground font-display text-xl font-bold text-background">
              +
            </button>
          </div>
        </div>
        <label className="block">
          <span className={labelStyle}>Monthly rent (per bed)</span>
          <div className="flex items-center rounded-[11px] border border-border bg-card px-3.5">
            <span className="text-sm font-semibold text-muted-foreground">₹</span>
            <input value={rent} onChange={(e) => setRent(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="8000" className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm font-semibold text-foreground focus:outline-none" />
          </div>
        </label>
      </div>
    </BottomSheet>
  );
}
