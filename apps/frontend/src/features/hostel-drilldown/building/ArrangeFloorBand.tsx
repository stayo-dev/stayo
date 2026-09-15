import { useCallback, useMemo, useRef, useState, type Ref } from 'react';
import { GripVertical } from 'lucide-react';
import type { Floor, RoomWithOccupants } from '../types';
import { BedFace } from './BedFace';
import { countRooms, floorPlate, roomBedSlots, tileColumns, tileMinWidthPx, TILE_FACE_PX } from './buildingModel';
import { dropIndex, keyboardTarget, moveItem, type TileBox } from './arrangeModel';
import { useLiftDrag } from './useLiftDrag';

interface ArrangeFloorBandProps {
  floor: Floor;
  rooms: RoomWithOccupants[];
  isTop: boolean;
  /** True while this band is the one being carried. */
  carried: boolean;
  bandRef?: Ref<HTMLElement>;
  onRoomsChange: (rooms: RoomWithOccupants[]) => void;
  /**
   * The whole pointer stream for moving this floor, bound to its plate. All
   * four go on the same element: `useLiftDrag` captures the pointer there, so
   * move and release keep firing on the plate even once the finger has left it.
   */
  floorHandlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
  };
  /** Keyboard move on the floor handle: a signed number of places. */
  onMoveFloor: (delta: number) => void;
}

/**
 * One storey in arrange mode (ADR-206).
 *
 * The same band the owner already reads — plate, free count, rooms in their
 * wrapping grid — with two things added and one taken away: the plate becomes
 * a grip for moving the whole floor, each room can be picked up and put down
 * among its neighbours, and nothing opens. A tile shows its faces because
 * "the room with Arjun and Ravi in it" is how an owner knows which room they
 * are moving; the faces are not interactive here.
 */
export function ArrangeFloorBand({
  floor,
  rooms,
  isTop,
  carried,
  bandRef,
  onRoomsChange,
  floorHandlers,
  onMoveFloor,
}: ArrangeFloorBandProps) {
  const counts = useMemo(() => countRooms(rooms), [rooms]);
  const widest = rooms.reduce((max, r) => Math.max(max, r.beds.length, r.occupants.length), 1);
  const grid = useRef<HTMLDivElement>(null);

  /** Index of the room being carried, and the slot it would land in. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  /** Resting rectangles, measured once at lift — they move as the grid reflows. */
  const boxes = useRef<TileBox[]>([]);

  const measure = useCallback(() => {
    const node = grid.current;
    if (!node) return;
    boxes.current = Array.from(node.querySelectorAll<HTMLElement>('[data-arrange-tile]')).map((el) => {
      const rect = el.getBoundingClientRect();
      return { id: el.dataset.roomId ?? '', left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
  }, []);

  const commit = useCallback(
    (from: number, to: number) => {
      if (from !== to) onRoomsChange(moveItem(rooms, from, to));
    },
    [onRoomsChange, rooms],
  );

  const moveByKeyboard = useCallback(
    (index: number, key: string) => {
      const to = keyboardTarget(key, index, rooms.length, tileColumns(widest));
      if (to == null) return false;
      commit(index, to);
      return true;
    },
    [commit, rooms.length, widest],
  );

  return (
    <section
      ref={bandRef}
      data-floor-id={floor.id}
      aria-label={`${floor.name}, ${rooms.length} room${rooms.length === 1 ? '' : 's'}`}
      className={`flex gap-[6px] px-[6px] pb-2 pt-2 transition-[opacity,box-shadow] ${
        isTop ? '' : 'border-t-[3px] border-accent'
      } ${carried ? 'relative z-20 rounded-[12px] bg-card opacity-95 shadow-[0_12px_28px_rgba(40,30,20,0.22)]' : ''}`}
    >
      <div className="flex w-[30px] flex-none flex-col items-center gap-1">
        <button
          type="button"
          {...floorHandlers}
          onKeyDown={(e) => {
            const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
            if (!delta) return;
            e.preventDefault();
            onMoveFloor(delta);
          }}
          aria-label={`Move ${floor.name}. Press the up and down arrow keys to move this floor.`}
          className="relative flex h-[30px] w-[30px] cursor-grab touch-none items-center justify-center rounded-[9px] bg-foreground font-display text-[12px] font-extrabold text-background active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {floorPlate(floor.name)}
          <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
            <GripVertical className="h-2.5 w-2.5" strokeWidth={2.5} />
          </span>
        </button>
        <span className="text-center text-[9px] leading-[1.15] text-muted-foreground">
          <b className="font-display text-[10.5px] font-extrabold text-foreground">{counts.free}</b>
          <br />
          free
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-1 truncate text-[10.5px] font-semibold text-muted-foreground">{floor.name}</p>
        {rooms.length === 0 ? (
          <p className="rounded-[11px] border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
            No rooms on this floor.
          </p>
        ) : (
          <div
            ref={grid}
            className="grid gap-[5px]"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileMinWidthPx(widest)}px, 1fr))` }}
          >
            {rooms.map((room, index) => (
              <ArrangeRoomTile
                key={room.id}
                room={room}
                index={index}
                total={rooms.length}
                dragging={dragging === index}
                /** The slot a carried tile is about to take. */
                highlighted={dragging != null && target === index && dragging !== index}
                onLift={() => {
                  measure();
                  setDragging(index);
                  setTarget(index);
                }}
                onMove={(x, y) => setTarget(dropIndex(boxes.current, index, x, y))}
                onDrop={() => {
                  if (target != null) commit(index, target);
                  setDragging(null);
                  setTarget(null);
                }}
                onCancel={() => {
                  setDragging(null);
                  setTarget(null);
                }}
                onKeyMove={(key) => moveByKeyboard(index, key)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface ArrangeRoomTileProps {
  room: RoomWithOccupants;
  index: number;
  total: number;
  dragging: boolean;
  highlighted: boolean;
  onLift: () => void;
  onMove: (x: number, y: number) => void;
  onDrop: () => void;
  onCancel: () => void;
  onKeyMove: (key: string) => boolean;
}

/**
 * A room being arranged. Visually the building's `RoomTile` — same faces, same
 * grid — but it is a drag source rather than a way into the room sheet, and it
 * answers the arrow keys so the order is reachable without a pointer at all
 * (the gap ADR-062 left open).
 */
function ArrangeRoomTile({
  room,
  index,
  total,
  dragging,
  highlighted,
  onLift,
  onMove,
  onDrop,
  onCancel,
  onKeyMove,
}: ArrangeRoomTileProps) {
  const slots = useMemo(() => roomBedSlots(room), [room]);
  const columns = tileColumns(slots.length);
  const { lifted, handlers } = useLiftDrag({ onLift, onMove, onDrop, onCancel });

  return (
    <button
      type="button"
      data-arrange-tile=""
      data-room-id={room.id}
      data-lifted={lifted ? 'true' : undefined}
      {...handlers}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onCancel();
          return;
        }
        if (onKeyMove(e.key)) e.preventDefault();
      }}
      aria-label={`Room ${room.number}, ${index + 1} of ${total}. Press the arrow keys to move it.`}
      className={`flex min-h-[56px] min-w-0 cursor-grab flex-col rounded-[11px] border bg-card px-[4px] pb-[5px] pt-[4px] text-left transition-[box-shadow,transform,border-color,opacity] duration-150 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none ${
        dragging || lifted
          ? 'z-20 scale-[1.06] border-primary opacity-95 shadow-[0_10px_22px_rgba(40,30,20,0.24)]'
          : 'shadow-[0_1px_2px_rgba(40,30,20,0.05)]'
      } ${highlighted ? 'border-primary bg-primary/10 ring-2 ring-primary/50' : 'border-border'}`}
      style={{ touchAction: lifted ? 'none' : 'manipulation' }}
    >
      <span className="mb-[3px] ml-[2px] flex items-center gap-[2px] truncate font-display text-[10px] font-extrabold tabular-nums leading-[1.2] text-foreground">
        <GripVertical className="h-2.5 w-2.5 flex-none text-muted-foreground" strokeWidth={2.5} aria-hidden="true" />
        {room.number}
      </span>
      <span
        aria-hidden="true"
        className="grid justify-center gap-[4px]"
        style={{ gridTemplateColumns: `repeat(${columns}, ${TILE_FACE_PX}px)` }}
      >
        {slots.map((slot) => (
          <BedFace key={slot.key} slot={slot} emphasis="normal" />
        ))}
      </span>
    </button>
  );
}
