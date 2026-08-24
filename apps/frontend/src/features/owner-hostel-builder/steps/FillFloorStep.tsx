import { useState } from 'react';
import { Copy, Info, Pencil, Trash2 } from 'lucide-react';
import {
  eyebrow,
  h1,
  sub,
  fieldLabel,
  fieldHint,
  stepBtn,
  textInput,
} from '@features/owner-onboarding/components/stepStyles';
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
 * Read a rupee amount out of whatever the owner typed.
 *
 * The rent fields accept text rather than `type="number"`, so "6,000" — the
 * shape the placeholder itself shows, and the shape Indian owners write — has
 * to survive. Anything with no digits left in it means "no rent decided",
 * which is a real state: `base_rent` is nullable and an unpriced room reads
 * "Price on request" rather than ₹0.
 */
function parseRupees(input: string): number | null {
  const digits = input.replace(/[^\d]/g, '');
  if (digits === '') return null;
  return Number(digits);
}

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
  onRoomRemove,
  onCloneToNext,
}: {
  floor: DraftFloor;
  floorIndex: number;
  floorCount: number;
  pattern: NumberingPattern;
  onPatternChange: (pattern: NumberingPattern) => void;
  onRoomCountChange: (count: number) => void;
  onDefaultsChange: (defaults: { capacity?: number; rent?: number | null }) => void;
  onRoomChange: (key: string, patch: Partial<Pick<DraftRoom, 'roomNo' | 'capacity' | 'rent'>>) => void;
  /** Remove one room. Without it, `−` could only lop rooms off the end. */
  onRoomRemove?: (key: string) => void;
  onCloneToNext: () => void;
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
            <span className="text-[12px] font-medium text-muted-foreground">
              {floor.rooms.length === 1 ? 'room' : 'rooms'}
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
          {floor.rooms.length === 0 && (
            <span className={fieldHint}>
              Tap + for each room on {floor.name.toLowerCase()}. We&apos;ll number them for you.
            </span>
          )}
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
            {/* `type="text"` with a numeric keypad, not `type="number"`: the
                number input silently changed the rent on a stray scroll while
                focused, and rejected the very "6,000" its placeholder showed. */}
            <span className="flex flex-1 items-center gap-1 rounded-xl border-[1.5px] border-field-border bg-input-background px-3 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15">
              <span className="font-display text-lg font-bold text-muted-foreground">₹</span>
              <input
                type="text"
                inputMode="numeric"
                value={floor.defaultRent ?? ''}
                onChange={(e) => onDefaultsChange({ rent: parseRupees(e.target.value) })}
                placeholder="6,000"
                aria-label="Default monthly rent for these rooms"
                className="w-full bg-transparent py-2 font-display text-lg font-bold text-foreground placeholder:font-normal placeholder:text-muted-foreground/70 focus:outline-none"
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
        onRemove={
          onRoomRemove
            ? () => {
                if (editingRoom) onRoomRemove(editingRoom.key);
                setEditingRoom(null);
              }
            : undefined
        }
      />
    </div>
  );
}

function RoomEditSheet({
  room,
  onClose,
  onSave,
  onRemove,
}: {
  room: DraftRoom | null;
  onClose: () => void;
  onSave: (patch: Partial<Pick<DraftRoom, 'roomNo' | 'capacity' | 'rent'>>) => void;
  onRemove?: () => void;
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
            placeholder="101"
            className={textInput}
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
            type="text"
            inputMode="numeric"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            placeholder="6,000"
            className={textInput}
          />
          <span className={fieldHint}>Leave it empty if this room has no set price yet.</span>
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
            onClick={() => onSave({ roomNo: roomNo.trim(), capacity, rent: parseRupees(rent) })}
            className="min-h-[48px] flex-1 rounded-xl bg-primary font-display text-[14px] font-bold text-primary-foreground"
          >
            Done
          </button>
        </div>

        {/* `−` on the floor only ever removed the last room, so deleting the
            odd store cupboard in the middle meant deleting everything after
            it and typing it all back. */}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl font-display text-[13px] font-bold text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} />
            Remove this room
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
