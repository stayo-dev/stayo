import { ChevronDown, ChevronUp, Pencil } from 'lucide-react';
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
  /**
   * Opens the floor's edit sheet — rename, summary, and delete when empty.
   * Delete used to sit alone at the foot of an expanded floor, and a floor
   * could not be renamed at all.
   */
  onEdit?: () => void;
}

/**
 * One floor as a collapsible section — collapsed by default, tap to expand,
 * per the Food Library accordion pattern. Browsing only: dragging floors and
 * rooms into a new order happens in the Rooms tab's dedicated "Reorder" mode
 * (`RoomsReorderPanel`), not here — see ADR-064.
 */
export function FloorGroup({
  floor,
  rooms,
  expanded,
  onToggle,
  onOpenRoom,
  onAssignRoom,
  onEdit,
}: FloorGroupProps) {
  const vacantCount = rooms.filter((r) => r.beds.every((b) => b.status === 'vacant')).length;

  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      {/* Two buttons side by side, not one inside the other: the row toggles
          the floor, the pencil edits it, and a nested button is invalid HTML
          that swallows one of the two taps. */}
      <div className="flex items-center">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 py-3 pl-3.5 pr-2">
          <span className="min-w-0 flex-1 truncate text-left font-display text-[13.5px] font-bold text-foreground">{floor.name}</span>
          <span className="flex-none text-[11.5px] text-muted-foreground">
            {rooms.length} rooms · {vacantCount} vacant
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 flex-none text-muted-foreground" /> : <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" />}
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${floor.name}`}
            className="mr-1.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="divide-y divide-border border-t border-border">
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} onOpen={() => onOpenRoom(room)} onAssign={() => onAssignRoom(room)} />
          ))}
          {rooms.length === 0 && (
            <p className="px-3.5 py-4 text-[12.5px] text-muted-foreground">
              No rooms on this floor yet.
            </p>
          )}
        </div>
      )}

    </div>
  );
}
