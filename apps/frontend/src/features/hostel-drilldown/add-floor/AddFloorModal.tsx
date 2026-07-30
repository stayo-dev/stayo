import { useState } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';

interface AddFloorModalProps {
  open: boolean;
  nextFloorLabel: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; roomCount?: number; bedsPerRoom?: number }) => void | Promise<void>;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/** Add Floor, per Stayo App.dc.html. Submits to the real `POST /api/floors` (+ `POST /api/rooms` per room) via `useHostelRooms`. */
export function AddFloorModal({ open, nextFloorLabel, isSubmitting, onClose, onSubmit }: AddFloorModalProps) {
  const [name, setName] = useState(nextFloorLabel);
  const [startWithRooms, setStartWithRooms] = useState(true);
  const [roomCount, setRoomCount] = useState(5);
  const [bedsPerRoom, setBedsPerRoom] = useState(4);

  const firstRoom = 1;
  const lastRoom = roomCount;
  const totalBeds = roomCount * bedsPerRoom;
  const canSubmit = name.trim().length > 0 && !isSubmitting;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Add floor"
      footer={
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit({ name: name.trim(), roomCount: startWithRooms ? roomCount : undefined, bedsPerRoom: startWithRooms ? bedsPerRoom : undefined })}
          className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? 'Adding…' : `Add floor${startWithRooms ? ` + ${roomCount} rooms` : ''}`}
        </button>
      }
    >
      <div className="flex flex-col gap-4.5">
        <label className="block">
          <span className={labelStyle}>Floor name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-[11px] border-[1.5px] border-primary bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none" />
        </label>

        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <button type="button" onClick={() => setStartWithRooms((v) => !v)} className="flex w-full items-center justify-between p-3.5 text-left">
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
                <div className="flex items-center gap-2.5">
                  <button type="button" onClick={() => setRoomCount((n) => Math.max(1, n - 1))} className="flex h-7 w-7 items-center justify-center rounded-md bg-muted font-bold text-primary">
                    −
                  </button>
                  <span className="w-6 text-center font-display text-[17px] font-extrabold tabular-nums text-foreground">{roomCount}</span>
                  <button type="button" onClick={() => setRoomCount((n) => Math.min(20, n + 1))} className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground font-bold text-background">
                    +
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-foreground/80">Beds per room</span>
                <div className="flex items-center gap-2.5">
                  <button type="button" onClick={() => setBedsPerRoom((n) => Math.max(1, n - 1))} className="flex h-7 w-7 items-center justify-center rounded-md bg-muted font-bold text-primary">
                    −
                  </button>
                  <span className="w-6 text-center font-display text-[17px] font-extrabold tabular-nums text-foreground">{bedsPerRoom}</span>
                  <button type="button" onClick={() => setBedsPerRoom((n) => Math.min(8, n + 1))} className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground font-bold text-background">
                    +
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {startWithRooms && (
          <div className="rounded-xl border border-warning/25 bg-warning/10 p-3.5 text-[12.5px] leading-relaxed text-warning">
            Creates <b>{name}</b> with rooms <b>{firstRoom}–{lastRoom}</b>, {bedsPerRoom} beds each — <b>{totalBeds} beds</b> added.
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
