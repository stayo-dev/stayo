import { useState } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import type { Floor } from '@shared/mocks/rooms';

interface AddRoomModalProps {
  open: boolean;
  floors: Floor[];
  isSubmitting?: boolean;
  onClose: () => void;
  onAddFloor: () => void;
  onSubmit: (data: { room_no: string; floor_id?: string; capacity: number; base_rent?: number }) => void | Promise<void>;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/** Add Room, per Stayo App.dc.html. Submits to the real `POST /api/rooms` via `useHostelRooms`. */
export function AddRoomModal({ open, floors, isSubmitting, onClose, onAddFloor, onSubmit }: AddRoomModalProps) {
  const [number, setNumber] = useState('');
  const [floorId, setFloorId] = useState(floors[0]?.id ?? '');
  const [beds, setBeds] = useState(4);
  const [rent, setRent] = useState('8000');

  const canSubmit = number.trim().length > 0 && !isSubmitting;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Add room"
      footer={
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit({ room_no: number.trim(), floor_id: floorId || undefined, capacity: beds, base_rent: Number(rent) || undefined })}
          className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? 'Adding…' : 'Add room'}
        </button>
      }
    >
      <div className="flex flex-col gap-4.5">
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
            <button type="button" onClick={() => setBeds((b) => Math.max(1, b - 1))} className="flex h-9.5 w-9.5 items-center justify-center rounded-lg bg-muted font-display text-xl font-bold text-primary">
              −
            </button>
            <span className="font-display text-2xl font-extrabold tabular-nums text-foreground">{beds}</span>
            <button type="button" onClick={() => setBeds((b) => Math.min(8, b + 1))} className="flex h-9.5 w-9.5 items-center justify-center rounded-lg bg-foreground font-display text-xl font-bold text-background">
              +
            </button>
          </div>
        </div>
        <label className="block">
          <span className={labelStyle}>Monthly rent (per bed)</span>
          <div className="flex items-center rounded-[11px] border border-border bg-card px-3.5">
            <span className="text-sm font-semibold text-muted-foreground">₹</span>
            <input value={rent} onChange={(e) => setRent(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm font-semibold text-foreground focus:outline-none" />
          </div>
        </label>
      </div>
    </BottomSheet>
  );
}
