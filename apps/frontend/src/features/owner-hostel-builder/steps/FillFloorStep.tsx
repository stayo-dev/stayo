import { useState } from 'react';
import { Copy, Info, Pencil } from 'lucide-react';
import { eyebrow, h1, sub, fieldLabel, stepBtn } from '@features/owner-onboarding/components/stepStyles';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { floorTally, previewNumbering, type DraftFloor, type DraftRoom, type NumberingPattern } from '../hostelBuilder';

const SHARING_OPTIONS = [1, 2, 3, 4, 6];
const PATTERNS: Array<{ value: NumberingPattern; label: string }> = [
  { value: 'NUMERIC', label: previewNumbering('NUMERIC') },
  { value: 'FLOOR_PREFIX', label: previewNumbering('FLOOR_PREFIX') },
  { value: 'BLOCK', label: previewNumbering('BLOCK') },
];

const money = (value: number | null) => (value === null ? '—' : `₹${value.toLocaleString('en-IN')}`);

/**
 * Fill one floor.
 *
 * The floor-level default generates the rooms; tapping a room overrides it.
 * That ordering matters — a real floor is "four rooms, mostly 4-sharing, one
 * of them a 2-sharing", not four independent decisions — and it is why this
 * screen does not ask for anything per room until the owner wants to differ.
 */
export function FillFloorStep({
  floor,
  floorIndex,
  floorCount,
  pattern,
  onPatternChange,
  onRoomCountChange,
  onDefaultsChange,
  onRoomChange,
  onCloneToNext,
  blocker,
}: {
  floor: DraftFloor;
  floorIndex: number;
  floorCount: number;
  pattern: NumberingPattern;
  onPatternChange: (pattern: NumberingPattern) => void;
  onRoomCountChange: (count: number) => void;
  onDefaultsChange: (defaults: { capacity?: number; rent?: number | null }) => void;
  onRoomChange: (key: string, patch: Partial<Pick<DraftRoom, 'roomNo' | 'capacity' | 'rent'>>) => void;
  onCloneToNext: () => void;
  blocker: string | null;
}) {
  const [editingRoom, setEditingRoom] = useState<DraftRoom | null>(null);
  const tally = floorTally(floor);
  const hasNextFloor = floorIndex + 1 < floorCount;

  return (
    <div>
      <div className={eyebrow}>
        {floor.name.toUpperCase()} · FLOOR {floorIndex + 1} OF {floorCount}
      </div>
      <h1 className={h1}>What&apos;s on this floor?</h1>
      <p className={sub}>Set the usual room for this floor, then change the ones that differ.</p>

      <div className="flex max-w-[460px] flex-col gap-5">
        <div>
          <span className={fieldLabel}>HOW MANY ROOMS</span>
          <div className="mt-2 flex items-center gap-3.5">
            <button
              type="button"
              aria-label="Fewer rooms"
              onClick={() => onRoomCountChange(Math.max(0, floor.rooms.length - 1))}
              className={stepBtn}
            >
              −
            </button>
            <span className="min-w-[46px] text-center font-display text-3xl font-extrabold text-foreground">
              {floor.rooms.length}
            </span>
            <button
              type="button"
              aria-label="More rooms"
              onClick={() => onRoomCountChange(Math.min(40, floor.rooms.length + 1))}
              className={stepBtn}
            >
              +
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/90 p-4">
          <span className={fieldLabel}>DEFAULT FOR THESE ROOMS</span>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {SHARING_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onDefaultsChange({ capacity: size })}
                className={`min-h-[40px] rounded-xl px-3.5 font-display text-[13.5px] font-bold transition-colors ${
                  floor.defaultCapacity === size
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card text-foreground hover:bg-muted'
                }`}
              >
                {size}-sharing
              </button>
            ))}
          </div>

          <label className="mt-4 flex items-center gap-3">
            <span className="text-[13px] font-semibold text-muted-foreground">Rent</span>
            <span className="flex flex-1 items-center gap-1 border-b-2 border-border focus-within:border-primary">
              <span className="font-display text-lg font-bold text-muted-foreground">₹</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={floor.defaultRent ?? ''}
                onChange={(e) => onDefaultsChange({ rent: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="6,000"
                className="w-full bg-transparent py-1.5 font-display text-lg font-bold text-foreground focus:outline-none"
              />
              <span className="text-[12.5px] font-semibold text-muted-foreground">/mo</span>
            </span>
          </label>

          {/* Stated plainly because the old wizard's single "monthly rent"
              implied a price list. It is a prefill for invites; the tenant's
              real rent is set per tenant. */}
          <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={2} />
            A starting figure. You set each tenant&apos;s actual rent when you invite them.
          </p>
        </div>

        <div>
          <span className={fieldLabel}>ROOM NUMBERING</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PATTERNS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onPatternChange(option.value)}
                className={`min-h-[38px] rounded-xl px-3.5 font-display text-[13px] font-bold transition-colors ${
                  pattern === option.value
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-card text-foreground hover:bg-muted'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {floor.rooms.length > 0 && (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-card/90">
            {floor.rooms.map((room, i) => (
              <li key={room.key}>
                <button
                  type="button"
                  onClick={() => setEditingRoom(room)}
                  style={{ animation: 'stayoRiseIn .35s ease both', animationDelay: `${Math.min(i, 8) * 45}ms` }}
                  className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  <span className="font-display text-[14px] font-bold text-foreground">{room.roomNo || '—'}</span>
                  <span className="flex items-center gap-2.5">
                    <span className="text-[13px] font-semibold text-muted-foreground">{room.capacity}-sharing</span>
                    <span className="font-display text-[13.5px] font-bold text-foreground">{money(room.rent)}</span>
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground/60" strokeWidth={2} />
                  </span>
                </button>
              </li>
            ))}
            <li className="flex items-center justify-between bg-muted/40 px-4 py-3">
              <span className="text-[12.5px] font-bold text-foreground">
                {tally.rooms} {tally.rooms === 1 ? 'room' : 'rooms'} · {tally.beds} beds
              </span>
            </li>
          </ul>
        )}

        {blocker && <p className="text-[13px] font-semibold text-warning">{blocker}</p>}

        {hasNextFloor && floor.rooms.length > 0 && (
          <button
            type="button"
            onClick={onCloneToNext}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 font-display text-[13px] font-bold text-foreground hover:bg-muted"
          >
            <Copy className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
            Make the next floor the same as this
          </button>
        )}
      </div>

      <RoomEditSheet
        room={editingRoom}
        onClose={() => setEditingRoom(null)}
        onSave={(patch) => {
          if (editingRoom) onRoomChange(editingRoom.key, patch);
          setEditingRoom(null);
        }}
      />
    </div>
  );
}

function RoomEditSheet({
  room,
  onClose,
  onSave,
}: {
  room: DraftRoom | null;
  onClose: () => void;
  onSave: (patch: Partial<Pick<DraftRoom, 'roomNo' | 'capacity' | 'rent'>>) => void;
}) {
  const [roomNo, setRoomNo] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [rent, setRent] = useState<string>('');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Load the tapped room's values once per opening, without an effect —
  // rendering with a different room is itself the signal.
  if (room && room.key !== loadedKey) {
    setLoadedKey(room.key);
    setRoomNo(room.roomNo);
    setCapacity(room.capacity);
    setRent(room.rent === null ? '' : String(room.rent));
  }

  return (
    <BottomSheet open={Boolean(room)} onOpenChange={(next) => !next && onClose()} title={`Room ${room?.roomNo ?? ''}`}>
      <div className="flex flex-col gap-5">
        <label className="block">
          <span className={fieldLabel}>ROOM NUMBER</span>
          <input
            value={roomNo}
            onChange={(e) => setRoomNo(e.target.value)}
            className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-[16px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>

        <div>
          <span className={fieldLabel}>SHARING</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SHARING_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setCapacity(size)}
                className={`min-h-[42px] rounded-xl px-3.5 font-display text-[13.5px] font-bold ${
                  capacity === size ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>DEFAULT RENT</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            placeholder="6000"
            className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-[16px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-xl border border-border bg-card font-display text-[14px] font-bold text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({ roomNo: roomNo.trim(), capacity, rent: rent === '' ? null : Number(rent) })
            }
            className="min-h-[48px] flex-1 rounded-xl bg-primary font-display text-[14px] font-bold text-primary-foreground"
          >
            Done
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
