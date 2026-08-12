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
}

/**
 * One floor as a collapsible section — collapsed by default, tap to expand,
 * per the Food Library accordion pattern. Browsing only: dragging floors and
 * rooms into a new order happens in the Rooms tab's dedicated "Reorder" mode
 * (`RoomsReorderPanel`), not here — see ADR-064.
 */
export function FloorGroup({ floor, rooms, expanded, onToggle, onOpenRoom, onAssignRoom }: FloorGroupProps) {
  const vacantCount = rooms.filter((r) => r.beds.every((b) => b.status === 'vacant')).length;

  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2.5 px-3.5 py-3">
        <span className="flex-1 text-left font-display text-[13.5px] font-bold text-foreground">{floor.name}</span>
        <span className="text-[11.5px] text-muted-foreground">
          {rooms.length} rooms · {vacantCount} vacant
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="divide-y divide-border border-t border-border">
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} onOpen={() => onOpenRoom(room)} onAssign={() => onAssignRoom(room)} />
          ))}
        </div>
      )}
    </div>
  );
}
