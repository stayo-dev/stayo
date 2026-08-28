import type { SeatGridFloor, SeatState } from '@shared/ui-patterns/roomSeatGrid';
import { C, FONT } from '../discoverTheme';

interface RoomPreferenceGridProps {
  floors: SeatGridFloor[];
  activeFloorId: string | null;
  onSelectFloor: (floorId: string) => void;
  onSelectRoom: (roomId: string) => void;
}

const SQUARE_STYLE: Record<SeatState, React.CSSProperties> = {
  available: { background: '#fff', border: `1px solid ${C.lineInput}`, color: C.textBody },
  selected: { background: C.clayPaleBg, border: `1.5px solid ${C.clay}`, color: '#A4482F' },
  unavailable: { background: C.lineSoft, border: `1px solid ${C.line}`, color: C.textGhost },
};

/**
 * The tenant's floor/room preference picker — a compact grid of small
 * squares, one per real room, in the spirit of a seat-selection interaction
 * (tap a floor, then tap a square) without borrowing cinema visuals: no seat
 * icons, no rows, no "screen this way" framing. Each square just shows the
 * real room number, styled with Discover's own hex tokens (this page renders
 * outside the themed app shell — see `discoverTheme.ts`).
 */
export function RoomPreferenceGrid({ floors, activeFloorId, onSelectFloor, onSelectRoom }: RoomPreferenceGridProps) {
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
              className="flex-none rounded-[11px] px-3.5 py-2 text-[12.5px] font-semibold"
              style={{
                background: active ? C.ink : '#fff',
                border: active ? `1.5px solid ${C.ink}` : `1px solid ${C.lineInput}`,
                color: active ? '#fff' : C.textBody,
              }}
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
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[7px] text-[10px] font-bold leading-none disabled:cursor-not-allowed"
              style={{ ...SQUARE_STYLE[room.state], fontFamily: FONT.display }}
            >
              {room.roomNo}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-[10.5px]" style={{ color: C.textMuted }}>
        <Legend swatch={SQUARE_STYLE.available} label="Available" />
        <Legend swatch={SQUARE_STYLE.selected} label="Selected" />
        <Legend swatch={SQUARE_STYLE.unavailable} label="Unavailable" />
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: React.CSSProperties; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-[3px]" style={swatch} />
      {label}
    </span>
  );
}
