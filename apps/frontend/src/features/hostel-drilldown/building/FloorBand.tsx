import { useMemo, type Ref } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { Floor, RoomWithOccupants } from '../types';
import { RoomTile } from './RoomTile';
import { countRooms, floorPlate, roomMatches, tileMinWidthPx, type Lens } from './buildingModel';

interface FloorBandProps {
  floor: Floor;
  rooms: RoomWithOccupants[];
  lens: Lens | null;
  query: string;
  /** The top floor has no slab above it — the roof sits there. */
  isTop: boolean;
  /** Rooms with no floor: no plate to edit, and nowhere to add to. */
  unassigned?: boolean;
  bandRef?: Ref<HTMLElement>;
  onOpenRoom: (room: RoomWithOccupants) => void;
  onAddRoom?: () => void;
  onEditFloor?: () => void;
}

/**
 * One storey. On the left, the plate column: the floor's lift-button label
 * (tap to rename or remove the floor), how many beds are free, and a dashed
 * "+" that adds a room to this floor. On the right, its rooms — a grid that
 * wraps onto more rows rather than shrinking anyone's face.
 */
export function FloorBand({ floor, rooms, lens, query, isTop, unassigned, bandRef, onOpenRoom, onAddRoom, onEditFloor }: FloorBandProps) {
  const counts = useMemo(() => countRooms(rooms), [rooms]);
  const widest = rooms.reduce((max, r) => Math.max(max, r.beds.length, r.occupants.length), 1);
  const searching = query.trim().length > 0;
  const plate = unassigned ? '–' : floorPlate(floor.name);

  return (
    <section
      ref={bandRef}
      data-floor-id={floor.id}
      aria-label={`${floor.name}: ${counts.free} free bed${counts.free === 1 ? '' : 's'}`}
      className={`flex scroll-mt-[84px] gap-[6px] px-[6px] pb-2 pt-2 lg:scroll-mt-[128px] ${isTop ? '' : 'border-t-[3px] border-accent'}`}
    >
      <div className="flex w-[30px] flex-none flex-col items-center gap-1">
        {onEditFloor && !unassigned ? (
          <button
            type="button"
            onClick={onEditFloor}
            aria-label={`Edit ${floor.name}`}
            className="relative flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-foreground font-display text-[12px] font-extrabold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {plate}
            <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
              <Pencil className="h-2 w-2" strokeWidth={2.5} />
            </span>
          </button>
        ) : (
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-muted font-display text-[12px] font-extrabold text-muted-foreground">
            {plate}
          </span>
        )}
        <span className="text-center text-[9px] leading-[1.15] text-muted-foreground">
          <b className="font-display text-[10.5px] font-extrabold text-foreground">{counts.free}</b>
          <br />
          free
        </span>
        {onAddRoom && !unassigned && (
          <button
            type="button"
            onClick={onAddRoom}
            aria-label={`Add a room to ${floor.name}`}
            className="mt-auto flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border-[1.5px] border-dashed border-primary/60 bg-card text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-1 truncate text-[10.5px] font-semibold text-muted-foreground">{floor.name}</p>
        {rooms.length === 0 ? (
          <p className="rounded-[11px] border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
            No rooms yet{onAddRoom && !unassigned ? ' — tap + to add one.' : '.'}
          </p>
        ) : (
          <div
            className="grid gap-[5px]"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileMinWidthPx(widest)}px, 1fr))` }}
          >
            {rooms.map((room) => (
              <RoomTile
                key={room.id}
                room={room}
                lens={lens}
                searching={searching}
                matched={roomMatches(room, query)}
                onOpen={() => onOpenRoom(room)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
