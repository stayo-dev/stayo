import { useMemo } from 'react';
import type { RoomWithOccupants } from '../types';
import { BedFace } from './BedFace';
import { roomAriaLabel, roomBedSlots, slotEmphasis, TILE_FACE_PX, tileColumns, type Lens } from './buildingModel';

interface RoomTileProps {
  room: RoomWithOccupants;
  lens: Lens | null;
  /** True while a search is typed — tiles that don't match it fade. */
  searching: boolean;
  matched: boolean;
  onOpen: () => void;
}

/**
 * One room on the building: its number and a face per bed. The whole tile is
 * one button — the faces inside are far too small to be tap targets of their
 * own, and "tap the room, then choose" keeps every action one step away
 * without asking anyone to hit a 23px square.
 */
export function RoomTile({ room, lens, searching, matched, onOpen }: RoomTileProps) {
  const slots = useMemo(() => roomBedSlots(room), [room]);
  const columns = tileColumns(slots.length);
  const faded = searching && !matched;
  const found = searching && matched;

  return (
    <button
      type="button"
      data-room-id={room.id}
      onClick={onOpen}
      aria-label={roomAriaLabel(room.number, slots)}
      className={`flex min-h-[56px] min-w-0 flex-col rounded-[11px] border bg-card px-[4px] pb-[5px] pt-[4px] text-left shadow-[0_1px_2px_rgba(40,30,20,0.05)] transition-[opacity,box-shadow,transform] duration-200 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.97] motion-reduce:transition-none ${
        found ? 'border-primary ring-2 ring-primary/70' : 'border-border'
      } ${faded ? 'opacity-30' : ''}`}
    >
      <span className="mb-[3px] ml-[2px] truncate font-display text-[10px] font-extrabold tabular-nums leading-[1.2] text-foreground">
        {room.number}
      </span>
      <span
        className="grid justify-center gap-[4px]"
        style={{ gridTemplateColumns: `repeat(${columns}, ${TILE_FACE_PX}px)` }}
      >
        {slots.map((slot) => (
          <BedFace key={slot.key} slot={slot} emphasis={slotEmphasis(slot, lens)} />
        ))}
      </span>
    </button>
  );
}
