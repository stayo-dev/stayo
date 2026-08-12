import { Reorder, useDragControls } from 'motion/react';
import { DragHandle } from '@shared/ui-patterns/DragHandle';
import type { Floor } from '@shared/mocks/rooms';
import type { RoomWithOccupants } from '../types';
import { BedStatusDots } from './BedStatusDots';

interface RoomsReorderPanelProps {
  floors: Floor[];
  roomsByFloor: Map<string, RoomWithOccupants[]>;
  onFloorsChange: (floors: Floor[]) => void;
  onRoomsChange: (floorId: string, rooms: RoomWithOccupants[]) => void;
}

function ReorderableRoom({ room }: { room: RoomWithOccupants }) {
  const controls = useDragControls();
  const occupied = room.beds.filter((b) => b.status === 'occupied').length;
  const allVacant = room.beds.every((b) => b.status === 'vacant');
  const summary = allVacant
    ? `${room.beds.length} vacant · ₹${room.rent.toLocaleString('en-IN')}`
    : `${occupied}/${room.beds.length} · ₹${room.rent.toLocaleString('en-IN')}`;

  return (
    <Reorder.Item
      value={room}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, zIndex: 20, boxShadow: '0 8px 20px rgba(40,30,20,0.16)' }}
      className="bg-card"
    >
      <div className="flex items-center gap-3 p-3">
        <DragHandle onDragStart={(e) => controls.start(e)} label={`Reorder room ${room.number}`} />
        <span className="w-8.5 flex-none font-display text-sm font-bold tabular-nums text-foreground">{room.number}</span>
        <BedStatusDots beds={room.beds} />
        <span className={`flex-1 text-right text-xs tabular-nums ${allVacant ? 'text-muted-foreground' : 'text-foreground/70'}`}>{summary}</span>
      </div>
    </Reorder.Item>
  );
}

function ReorderableFloor({
  floor,
  rooms,
  onRoomsChange,
}: {
  floor: Floor;
  rooms: RoomWithOccupants[];
  onRoomsChange: (rooms: RoomWithOccupants[]) => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={floor}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.01, zIndex: 30, boxShadow: '0 10px 24px rgba(40,30,20,0.18)' }}
      className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
    >
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <DragHandle onDragStart={(e) => controls.start(e)} label={`Reorder ${floor.name}`} />
        <span className="flex-1 text-left font-display text-[13.5px] font-bold text-foreground">{floor.name}</span>
        <span className="text-[11.5px] text-muted-foreground">{rooms.length} rooms</span>
      </div>
      {rooms.length === 0 ? (
        <p className="border-t border-border px-3.5 py-3 text-[12px] text-muted-foreground">No rooms on this floor yet.</p>
      ) : (
        <Reorder.Group
          as="ul"
          axis="y"
          values={rooms}
          onReorder={onRoomsChange}
          className="list-none divide-y divide-border border-t border-border"
        >
          {rooms.map((room) => (
            <ReorderableRoom key={room.id} room={room} />
          ))}
        </Reorder.Group>
      )}
    </Reorder.Item>
  );
}

/**
 * Rooms tab "Reorder" mode: drag floors, and within each floor drag its
 * rooms — both via the `⠿` handle only (ADR-042's touch-safe pattern).
 * Nothing is written to the server while dragging; `HostelRoomsPage` stages
 * `floors`/`roomsByFloor` locally here and only persists on an explicit Save
 * (ADR-064) — unlike the Home property list, which auto-saves per drag.
 */
export function RoomsReorderPanel({ floors, roomsByFloor, onFloorsChange, onRoomsChange }: RoomsReorderPanelProps) {
  return (
    <Reorder.Group as="ul" axis="y" values={floors} onReorder={onFloorsChange} className="flex list-none flex-col gap-3">
      {floors.map((floor) => (
        <ReorderableFloor
          key={floor.id}
          floor={floor}
          rooms={roomsByFloor.get(floor.id) ?? []}
          onRoomsChange={(rooms) => onRoomsChange(floor.id, rooms)}
        />
      ))}
    </Reorder.Group>
  );
}
