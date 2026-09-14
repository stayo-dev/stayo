import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Floor, RoomWithOccupants } from '../types';
import { BuildingLegend } from './BuildingLegend';
import { BuildingSkeleton } from './BuildingSkeleton';
import { EmptyBuilding } from './EmptyBuilding';
import { FloorBand } from './FloorBand';
import { LiftStrip, type LiftStop } from './LiftStrip';
import { countRooms, floorPlate, roomMatches, stackFloors, type Lens } from './buildingModel';
import { activeFloorId, showLiftStrip } from './liftStrip';

interface HostelBuildingProps {
  floors: Floor[];
  roomsByFloor: Map<string, RoomWithOccupants[]>;
  lens: Lens | null;
  query: string;
  isLoading: boolean;
  onOpenRoom: (room: RoomWithOccupants) => void;
  onAddRoom: (floorId: string) => void;
  onEditFloor: (floorId: string) => void;
  onAddFloor: () => void;
}

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * The hostel, drawn as the building it is (ADR-199): a roof with the totals,
 * floors stacked top to bottom, every room a tile of the faces that live in
 * it, and the ground with its entrance. Tall buildings get the lift strip.
 *
 * Draws only. What goes where is decided in `buildingModel`; what a tap does
 * is decided by the page.
 */
export function HostelBuilding({ floors, roomsByFloor, lens, query, isLoading, onOpenRoom, onAddRoom, onEditFloor, onAddFloor }: HostelBuildingProps) {
  const { stacked, unassigned } = useMemo(() => stackFloors(floors), [floors]);
  const allRooms = useMemo(() => Array.from(roomsByFloor.values()).flat(), [roomsByFloor]);
  const totals = useMemo(() => countRooms(allRooms), [allRooms]);
  const withStrip = showLiftStrip(stacked.length);

  const bands = useRef(new Map<string, HTMLElement>());
  const strip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);

  const bandRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) bands.current.set(id, el);
      else bands.current.delete(id);
    },
    [],
  );

  // Which floor is on screen, for the lift strip. `capture` catches the
  // desktop pane's own scroll container as well as the window's.
  useEffect(() => {
    if (!withStrip) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = (strip.current?.getBoundingClientRect().bottom ?? 0) + 12;
      const tops = stacked.flatMap((f) => {
        const el = bands.current.get(f.id);
        return el ? [{ id: f.id, top: el.getBoundingClientRect().top }] : [];
      });
      setActive(activeFloorId(tops, line));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [withStrip, stacked]);

  const jump = (id: string) => {
    bands.current.get(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  // A search that finds someone scrolls them into view — the point of
  // searching the building is to see *where* they are.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = window.setTimeout(() => {
      const ordered = [...stacked, ...(unassigned ? [unassigned] : [])];
      for (const floor of ordered) {
        const hit = (roomsByFloor.get(floor.id) ?? []).find((room) => roomMatches(room, q));
        if (hit) {
          document
            .querySelector(`[data-room-id="${CSS.escape(hit.id)}"]`)
            ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
          return;
        }
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, stacked, unassigned, roomsByFloor]);

  if (isLoading) return <BuildingSkeleton />;
  if (stacked.length === 0 && !unassigned) return <EmptyBuilding onAddFloor={onAddFloor} />;

  const stops: LiftStop[] = [...stacked].reverse().map((floor) => {
    const c = countRooms(roomsByFloor.get(floor.id) ?? []);
    return { id: floor.id, name: floor.name, plate: floorPlate(floor.name), free: c.free, overdue: c.overdue };
  });

  return (
    <div className="flex flex-col gap-3">
      {withStrip && <LiftStrip stops={stops} activeId={active} onJump={jump} stripRef={strip} />}

      <section aria-label="Your hostel, floor by floor" className="pt-3">
        <div className="relative">
          <button
            type="button"
            onClick={onAddFloor}
            className="absolute -top-3 left-1/2 z-[1] flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-primary/60 bg-card px-2.5 py-[3px] font-display text-[10.5px] font-bold text-primary shadow-sm hover:bg-primary/5"
          >
            <Plus className="h-3 w-3" strokeWidth={2.6} /> Add floor
          </button>
          <div className="mx-3 flex h-9 items-end justify-center bg-primary pb-1.5 text-primary-foreground [clip-path:polygon(7%_0,93%_0,100%_100%,0_100%)]">
            <span className="font-display text-[11px] font-extrabold tracking-[0.02em]">
              {totals.tenants} of {totals.beds} beds filled
            </span>
          </div>
        </div>

        <div className="border-x border-accent bg-card/70">
          {stacked.map((floor, i) => (
            <FloorBand
              key={floor.id}
              floor={floor}
              rooms={roomsByFloor.get(floor.id) ?? []}
              lens={lens}
              query={query}
              isTop={i === 0}
              bandRef={bandRef(floor.id)}
              onOpenRoom={onOpenRoom}
              onAddRoom={() => onAddRoom(floor.id)}
              onEditFloor={() => onEditFloor(floor.id)}
            />
          ))}
        </div>

        {/* The ground, with the way in. */}
        <div aria-hidden="true" className="relative flex h-3.5 justify-center bg-accent">
          <span className="h-full w-7 rounded-t-[6px] bg-primary/80" />
        </div>
        <div aria-hidden="true" className="-mx-1.5 h-1 rounded-full bg-border" />
      </section>

      {unassigned && (roomsByFloor.get(unassigned.id) ?? []).length > 0 && (
        <section aria-label="Rooms not on a floor" className="overflow-hidden rounded-[16px] border border-dashed border-border bg-card/70">
          <p className="px-3 pt-2.5 text-[11.5px] leading-[1.5] text-muted-foreground">
            <b className="font-display text-foreground">Not on a floor.</b> Open a room and pick its floor to put it in the building.
          </p>
          <FloorBand
            floor={{ ...unassigned, name: 'No floor' }}
            rooms={roomsByFloor.get(unassigned.id) ?? []}
            lens={lens}
            query={query}
            isTop
            unassigned
            onOpenRoom={onOpenRoom}
          />
        </section>
      )}

      <BuildingLegend />
    </div>
  );
}
