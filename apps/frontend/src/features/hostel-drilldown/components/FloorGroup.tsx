import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { Floor } from '@shared/mocks/rooms';
import type { RoomWithOccupants } from '../types';
import { canDeleteFloor } from '../propertyRemoval';
import { RoomRow } from './RoomRow';

interface FloorGroupProps {
  floor: Floor;
  rooms: RoomWithOccupants[];
  expanded: boolean;
  onToggle: () => void;
  onOpenRoom: (room: RoomWithOccupants) => void;
  onAssignRoom: (room: RoomWithOccupants) => void;
  /**
   * Delete this floor. `DELETE /api/floors/:id` is a real delete and refuses
   * a floor that still has rooms, so it only ever appears on an empty one.
   * Had no caller anywhere in the app until 2026-08-24.
   */
  onDelete?: () => Promise<void>;
  isDeleting?: boolean;
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
  onDelete,
  isDeleting,
}: FloorGroupProps) {
  const vacantCount = rooms.filter((r) => r.beds.every((b) => b.status === 'vacant')).length;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteBlocker = canDeleteFloor({ roomCount: rooms.length }).reason;

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
          {rooms.length === 0 && (
            <p className="px-3.5 py-4 text-[12.5px] text-muted-foreground">
              No rooms on this floor yet.
            </p>
          )}
        </div>
      )}

      {/* Only on an empty floor: the backend refuses to delete one that still
          has rooms, and deleting a floor should never be a way to delete
          rooms nobody looked at. Emptying it first is the point. */}
      {expanded && onDelete && !deleteBlocker && (
        <div className="border-t border-border px-3.5 py-3">
          {confirmingDelete ? (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 font-display text-[12.5px] font-bold text-foreground"
              >
                Keep it
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void onDelete()}
                className="flex-1 rounded-xl bg-destructive px-4 py-2.5 font-display text-[12.5px] font-bold text-destructive-foreground disabled:opacity-50"
              >
                {isDeleting ? 'Deleting…' : `Delete ${floor.name}`}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-lg px-2 font-display text-[12.5px] font-bold text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Delete this empty floor
            </button>
          )}
        </div>
      )}
    </div>
  );
}
