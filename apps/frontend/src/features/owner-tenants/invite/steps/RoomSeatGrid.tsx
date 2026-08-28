import type { SeatGridFloor, SeatState } from '@shared/ui-patterns/roomSeatGrid';

interface RoomSeatGridProps {
  floors: SeatGridFloor[];
  activeFloorId: string | null;
  onSelectFloor: (floorId: string) => void;
  onSelectRoom: (roomId: string) => void;
}

const SQUARE_CLASS: Record<SeatState, string> = {
  available: 'border border-border bg-card text-foreground',
  selected: 'border-[1.5px] border-primary bg-primary/10 text-primary',
  unavailable: 'border border-border bg-muted text-muted-foreground cursor-not-allowed',
};

/**
 * The owner's room-assignment picker — a compact grid of small squares, one
 * per real room, in the spirit of a seat-selection interaction (tap a floor,
 * then tap a square) without cinema visuals: no seat icons, no rows, no
 * "screen this way" framing, just the real room number on each square. Same
 * grouping logic as the tenant-facing picker (`roomSeatGrid.ts`), styled with
 * this app's own Tailwind theme tokens rather than Discover's hex palette.
 */
export function RoomSeatGrid({ floors, activeFloorId, onSelectFloor, onSelectRoom }: RoomSeatGridProps) {
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? floors[0] ?? null;

  if (floors.length === 0) return null;

  return (
    <div>
      <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {floors.map((floor) => {
          const active = floor.id === activeFloor?.id;
          return (
            <button
              key={floor.id}
              type="button"
              onClick={() => onSelectFloor(floor.id)}
              aria-pressed={active}
              className={`flex-none rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold ${
                active ? 'bg-foreground text-background' : 'border border-border bg-card text-foreground'
              }`}
            >
              {floor.name}
            </button>
          );
        })}
      </div>

      {activeFloor && (
        <div className="flex flex-wrap gap-1.5">
          {activeFloor.rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              disabled={room.state === 'unavailable'}
              onClick={() => onSelectRoom(room.id)}
              aria-pressed={room.state === 'selected'}
              className={`flex h-9 w-9 flex-none items-center justify-center rounded-[6px] text-[10px] font-bold leading-none ${SQUARE_CLASS[room.state]}`}
            >
              {room.roomNo}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-[10.5px] text-muted-foreground">
        <Legend swatchClass={SQUARE_CLASS.available} label="Available" />
        <Legend swatchClass={SQUARE_CLASS.selected} label="Selected" />
        <Legend swatchClass={SQUARE_CLASS.unavailable} label="Unavailable" />
      </div>
    </div>
  );
}

function Legend({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-[3px] ${swatchClass}`} />
      {label}
    </span>
  );
}
