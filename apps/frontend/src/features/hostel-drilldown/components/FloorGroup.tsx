import { useEffect, useState } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Floor } from '@shared/mocks/rooms';
import type { RoomWithOccupants } from '../types';
import { RoomRow } from './RoomRow';

interface FloorGroupProps {
  floor: Floor;
  rooms: RoomWithOccupants[];
  expanded: boolean;
  onToggle: () => void;
  onOpenRoom: (room: RoomWithOccupants) => void;
  onAssignRoom: (room: RoomWithOccupants) => void;
  onReorder: (order: string[]) => void;
  /** True while a search filter hides some of the floor's rooms — dragging a
   * partial list can't produce a valid full-floor order, so drag is disabled. */
  reorderDisabled?: boolean;
}

function DraggableRoomRow({
  room,
  onOpen,
  onAssign,
}: {
  room: RoomWithOccupants;
  onOpen: () => void;
  onAssign: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={room}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, zIndex: 20, boxShadow: '0 8px 20px rgba(40,30,20,0.16)' }}
      className="bg-card"
    >
      <RoomRow room={room} onOpen={onOpen} onAssign={onAssign} onDragStart={(e) => controls.start(e)} />
    </Reorder.Item>
  );
}

/**
 * One floor as a collapsible section — collapsed by default, tap to expand,
 * per the Food Library accordion pattern. Expanded rooms drag-reorder via
 * `motion/react`'s `Reorder` (pointer-based, works on touch — the plain HTML5
 * `draggable` this replaced didn't, see `DragHandle`'s doc comment).
 */
export function FloorGroup({ floor, rooms, expanded, onToggle, onOpenRoom, onAssignRoom, onReorder, reorderDisabled }: FloorGroupProps) {
  const vacantCount = rooms.filter((r) => r.beds.every((b) => b.status === 'vacant')).length;

  // Local copy so the list follows the finger during a drag; resynced whenever
  // the floor's room list changes (refetch, search, add/delete).
  const [items, setItems] = useState(rooms);
  useEffect(() => setItems(rooms), [rooms]);

  const draggable = expanded && !reorderDisabled && rooms.length > 1;

  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2.5 px-3.5 py-3">
        <span className="flex-1 text-left font-display text-[13.5px] font-bold text-foreground">{floor.name}</span>
        <span className="text-[11.5px] text-muted-foreground">
          {rooms.length} rooms · {vacantCount} vacant
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded &&
        (draggable ? (
          <Reorder.Group
            as="ul"
            axis="y"
            values={items}
            onReorder={setItems}
            // Commit on release, not on every crossover — a single drag past
            // two rows would otherwise fire two writes.
            onPointerUp={() => {
              const ids = items.map((r) => r.id);
              console.log('DEBUG onPointerUp fired', ids, rooms.map((r) => r.id));
              if (ids.join() !== rooms.map((r) => r.id).join()) onReorder(ids);
            }}
            className="list-none divide-y divide-border border-t border-border"
          >
            {items.map((room) => (
              <DraggableRoomRow key={room.id} room={room} onOpen={() => onOpenRoom(room)} onAssign={() => onAssignRoom(room)} />
            ))}
          </Reorder.Group>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {rooms.map((room) => (
              <RoomRow key={room.id} room={room} onOpen={() => onOpenRoom(room)} onAssign={() => onAssignRoom(room)} />
            ))}
          </div>
        ))}
    </div>
  );
}
