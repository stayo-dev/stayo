import type { Room } from '@shared/mocks/rooms';
import { BedStatusDots } from './BedStatusDots';

interface RoomRowProps {
  room: Room;
  onOpen: () => void;
  onAssign: () => void;
}

/** Browse-mode room row, per Stayo App.dc.html's Rooms tab. */
export function RoomRow({ room, onOpen, onAssign }: RoomRowProps) {
  const occupied = room.beds.filter((b) => b.status === 'occupied').length;
  const allVacant = room.beds.every((b) => b.status === 'vacant');
  const summary = allVacant ? `${room.beds.length} vacant · ₹${room.rent.toLocaleString('en-IN')}` : `${occupied}/${room.beds.length} · ₹${room.rent.toLocaleString('en-IN')}`;

  const content = (
    <>
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
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 p-3 text-left">
      {content}
      <span className="flex-none text-muted-foreground">›</span>
    </button>
  );
}
