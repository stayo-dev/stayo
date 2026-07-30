import { DragHandle } from '@shared/ui-patterns/DragHandle';
import type { Room } from '@shared/mocks/rooms';
import { BedStatusDots } from './BedStatusDots';

interface RoomLayoutCardProps {
  room: Room;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** Draggable room chip for layout/reorder mode, per Stayo App.dc.html. */
export function RoomLayoutCard({ room, dragging, onDragStart, onDragEnd }: RoomLayoutCardProps) {
  const occupied = room.beds.filter((b) => b.status === 'occupied').length;
  const summary = `${occupied}/${room.beds.length} · ₹${room.rent.toLocaleString('en-IN')}`;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`flex cursor-grab items-center gap-2.5 p-3 active:cursor-grabbing ${dragging ? 'opacity-40' : ''}`}
    >
      <DragHandle />
      <span className="w-8.5 flex-none font-display text-sm font-bold tabular-nums text-foreground">{room.number}</span>
      <BedStatusDots beds={room.beds} />
      <span className="flex-1 text-right text-xs tabular-nums text-foreground/70">{summary}</span>
    </div>
  );
}
