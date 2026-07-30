import { DragHandle } from '@shared/ui-patterns/DragHandle';
import type { Floor, Room } from '@shared/mocks/rooms';
import { RoomRow } from './RoomRow';
import { RoomLayoutCard } from './RoomLayoutCard';

interface FloorGroupProps {
  floor: Floor;
  rooms: Room[];
  mode: 'browse' | 'layout';
  onOpenRoom: (room: Room) => void;
  onAssignRoom: (room: Room) => void;
  dragRoomId: string | null;
  isDragOver: boolean;
  onDragStartRoom: (roomId: string) => void;
  onDragEndRoom: () => void;
  onDragOverFloor: () => void;
  onDropFloor: () => void;
}

/** One floor's room group — browse-mode list or layout-mode draggable/drop-target card. */
export function FloorGroup({
  floor,
  rooms,
  mode,
  onOpenRoom,
  onAssignRoom,
  dragRoomId,
  isDragOver,
  onDragStartRoom,
  onDragEndRoom,
  onDragOverFloor,
  onDropFloor,
}: FloorGroupProps) {
  const vacantCount = rooms.filter((r) => r.beds.every((b) => b.status === 'vacant')).length;

  if (mode === 'browse') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-0.5">
          <span className="font-display text-[13.5px] font-bold text-foreground">{floor.name}</span>
          <span className="text-[11.5px] text-muted-foreground">
            {rooms.length} rooms · {vacantCount} vacant
          </span>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} onOpen={() => onOpenRoom(room)} onAssign={() => onAssignRoom(room)} />
          ))}
        </div>
      </div>
    );
  }

  const isDropTarget = dragRoomId != null;

  return (
    <div
      onDragOver={(e) => {
        if (!isDropTarget) return;
        e.preventDefault();
        onDragOverFloor();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropFloor();
      }}
      className={`overflow-hidden rounded-2xl border bg-card ${isDragOver ? 'border-[1.5px] border-dashed border-primary bg-primary/5' : 'border-border'}`}
    >
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/60 px-3 py-2.5">
        <DragHandle />
        <span className="font-display text-[13.5px] font-bold text-foreground">{floor.name}</span>
        <span className="flex-1 text-right text-[11.5px] text-muted-foreground">
          {isDragOver ? <span className="font-display font-bold text-primary">drop here to move</span> : `${rooms.length} rooms · ${vacantCount} vacant`}
        </span>
      </div>
      {rooms.map((room) => (
        <RoomLayoutCard
          key={room.id}
          room={room}
          dragging={dragRoomId === room.id}
          onDragStart={() => onDragStartRoom(room.id)}
          onDragEnd={onDragEndRoom}
        />
      ))}
    </div>
  );
}
