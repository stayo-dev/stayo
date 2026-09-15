import { useCallback, useMemo, useRef, useState } from 'react';
import type { Floor, RoomWithOccupants } from '../types';
import { ArrangeFloorBand } from './ArrangeFloorBand';
import { floorDropIndex, moveItem } from './arrangeModel';
import { useLiftDrag, useSuppressScrollWhileLifted } from './useLiftDrag';

interface ArrangeBuildingProps {
  /** Floors as the owner is staging them, top of the building first. */
  stacked: Floor[];
  roomsByFloor: Map<string, RoomWithOccupants[]>;
  onStackChange: (stacked: Floor[]) => void;
  onRoomsChange: (floorId: string, rooms: RoomWithOccupants[]) => void;
}

/**
 * Arrange mode: the building, rearranged in place (ADR-206).
 *
 * This replaces `RoomsReorderPanel`, which drew a flat list of cards running
 * ground-floor-first while the building runs top-floor-first — so tapping
 * "Arrange" turned the hostel upside down, and an owner dragging the top card
 * to the bottom was moving the floor they least expected. The mode is now the
 * same picture as the tab it came from, stacked by the same `stackFloors`, so
 * the two cannot disagree about which way a hostel points.
 *
 * Nothing is written while dragging. `HostelRoomsPage` stages the order and
 * persists it on an explicit Save (ADR-064); `floorOrderForSave` does the one
 * reversal the ascending `sort_order` column needs.
 */
export function ArrangeBuilding({ stacked, roomsByFloor, onStackChange, onRoomsChange }: ArrangeBuildingProps) {
  const root = useRef<HTMLDivElement>(null);
  const bands = useRef(new Map<string, HTMLElement>());

  /** Index of the floor being carried, and where it would land. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const heights = useRef<number[]>([]);
  const originY = useRef<number | null>(null);

  /**
   * Nothing carried may take the page with it. Floors and rooms both mark
   * themselves `data-lifted` while held, so one listener on the container
   * covers every gesture without threading state back up through the bands.
   */
  useSuppressScrollWhileLifted(
    root,
    useCallback(() => Boolean(root.current?.querySelector('[data-lifted="true"]')), []),
  );

  const bandRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) bands.current.set(id, el);
      else bands.current.delete(id);
    },
    [],
  );

  const commitFloor = useCallback(
    (from: number, to: number) => {
      if (from !== to) onStackChange(moveItem(stacked, from, to));
    },
    [onStackChange, stacked],
  );

  const liftFloor = useCallback(
    (index: number) => {
      heights.current = stacked.map((f) => bands.current.get(f.id)?.getBoundingClientRect().height ?? 0);
      originY.current = null;
      setDragging(index);
      setTarget(index);
    },
    [stacked],
  );

  const totals = useMemo(() => {
    let rooms = 0;
    for (const floor of stacked) rooms += (roomsByFloor.get(floor.id) ?? []).length;
    return { floors: stacked.length, rooms };
  }, [stacked, roomsByFloor]);

  return (
    <div ref={root} className="flex flex-col gap-3">
      <section aria-label="Arrange your hostel, floor by floor" className="pt-3">
        {/* The same roof, saying what this mode is for instead of the bed count. */}
        <div className="mx-3 flex h-9 items-end justify-center bg-primary pb-1.5 text-primary-foreground [clip-path:polygon(7%_0,93%_0,100%_100%,0_100%)]">
          <span className="font-display text-[11px] font-extrabold tracking-[0.02em]">
            {totals.floors} floor{totals.floors === 1 ? '' : 's'} · {totals.rooms} room{totals.rooms === 1 ? '' : 's'}
          </span>
        </div>

        <div className="border-x border-accent bg-card/70">
          {stacked.map((floor, index) => (
            <ArrangeBand
              key={floor.id}
              floor={floor}
              rooms={roomsByFloor.get(floor.id) ?? []}
              index={index}
              isTop={index === 0}
              carried={dragging === index}
              /** Where the carried floor would land, drawn as a gap. */
              highlighted={dragging != null && target === index && dragging !== index}
              bandRef={bandRef(floor.id)}
              onRoomsChange={(rooms) => onRoomsChange(floor.id, rooms)}
              onLiftFloor={() => liftFloor(index)}
              onMoveFloorPointer={(y) => {
                // The press point is the first move after the lift — close
                // enough to where the finger went down, and it avoids threading
                // the pointer event through two components to get it.
                if (originY.current == null) originY.current = y;
                setTarget(floorDropIndex(heights.current, index, y - originY.current));
              }}
              onDropFloor={() => {
                if (target != null) commitFloor(index, target);
                setDragging(null);
                setTarget(null);
              }}
              onCancelFloor={() => {
                setDragging(null);
                setTarget(null);
              }}
              onMoveFloorByKey={(delta) => commitFloor(index, Math.min(stacked.length - 1, Math.max(0, index + delta)))}
            />
          ))}
        </div>

        {/* The ground, with the way in — unchanged, so the building still stands on something. */}
        <div aria-hidden="true" className="relative flex h-3.5 justify-center bg-accent">
          <span className="h-full w-7 rounded-t-[6px] bg-primary/80" />
        </div>
        <div aria-hidden="true" className="-mx-1.5 h-1 rounded-full bg-border" />
      </section>

      <p className="px-1 text-[11.5px] leading-[1.5] text-muted-foreground">
        Press and hold a room to pick it up, or the floor's plate to move a whole floor. With a keyboard, tab to one and
        use the arrow keys. Rooms stay on their floor — to move a room to a different floor, open it and change its floor.
      </p>
    </div>
  );
}

interface ArrangeBandProps {
  floor: Floor;
  rooms: RoomWithOccupants[];
  index: number;
  isTop: boolean;
  carried: boolean;
  highlighted: boolean;
  bandRef: (el: HTMLElement | null) => void;
  onRoomsChange: (rooms: RoomWithOccupants[]) => void;
  onLiftFloor: () => void;
  onMoveFloorPointer: (clientY: number) => void;
  onDropFloor: () => void;
  onCancelFloor: () => void;
  onMoveFloorByKey: (delta: number) => void;
}

/**
 * Wires one band's floor-level gesture. It sits here rather than inside
 * `ArrangeFloorBand` so that component stays about drawing a storey and
 * arranging the rooms in it.
 */
function ArrangeBand({
  floor,
  rooms,
  index,
  isTop,
  carried,
  highlighted,
  bandRef,
  onRoomsChange,
  onLiftFloor,
  onMoveFloorPointer,
  onDropFloor,
  onCancelFloor,
  onMoveFloorByKey,
}: ArrangeBandProps) {
  const { handlers } = useLiftDrag({
    onLift: onLiftFloor,
    onMove: (_x, y) => onMoveFloorPointer(y),
    onDrop: onDropFloor,
    onCancel: onCancelFloor,
  });

  return (
    <div
      data-arrange-band={index}
      data-lifted={carried ? 'true' : undefined}
      className={highlighted ? 'border-y-2 border-dashed border-primary/70 bg-primary/5' : ''}
    >
      <ArrangeFloorBand
        floor={floor}
        rooms={rooms}
        isTop={isTop}
        carried={carried}
        bandRef={bandRef}
        onRoomsChange={onRoomsChange}
        floorHandlers={handlers}
        onMoveFloor={onMoveFloorByKey}
      />
    </div>
  );
}
