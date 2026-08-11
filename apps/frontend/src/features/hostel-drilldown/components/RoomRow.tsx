import type { PointerEvent as ReactPointerEvent } from 'react';
import { DragHandle } from '@shared/ui-patterns/DragHandle';
import { BedStatusDots } from './BedStatusDots';
import type { RoomWithOccupants } from '../types';

interface RoomRowProps {
  room: RoomWithOccupants;
  onOpen: () => void;
  onAssign: () => void;
  /** Supply to render a drag handle wired to `useDragControls().start` (Reorder.Item in FloorGroup). */
  onDragStart?: (event: ReactPointerEvent) => void;
}

/** Browse-mode room row, per Stayo App.dc.html's Rooms tab. Drag handle reorders within the floor. */
export function RoomRow({ room, onOpen, onAssign, onDragStart }: RoomRowProps) {
  const occupied = room.beds.filter((b) => b.status === 'occupied').length;
  const allVacant = room.beds.every((b) => b.status === 'vacant');
  const summary = allVacant ? `${room.beds.length} vacant · ₹${room.rent.toLocaleString('en-IN')}` : `${occupied}/${room.beds.length} · ₹${room.rent.toLocaleString('en-IN')}`;

  const handle = onDragStart && <DragHandle onDragStart={onDragStart} label={`Reorder room ${room.number}`} />;

  const content = (
    <>
      {handle}
      <span className="w-8.5 flex-none font-display text-sm font-bold tabular-nums text-foreground">{room.number}</span>
      <BedStatusDots beds={room.beds} />
      <span className={`flex-1 text-right text-xs tabular-nums ${allVacant ? 'text-muted-foreground' : 'text-foreground/70'}`}>{summary}</span>
    </>
  );

  if (allVacant) {
    return (
      <div className="flex items-center gap-3 p-3">
        {content}
        <button type="button" onClick={onAssign} className="flex-none rounded-lg bg-primary px-3 py-1.5 font-display text-[11.5px] font-bold text-primary-foreground">
          Assign
        </button>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className="flex w-full cursor-pointer items-center gap-3 p-3 text-left"
    >
      {content}
      <span className="flex-none text-muted-foreground">›</span>
    </div>
  );
}
