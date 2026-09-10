import { describeRoomOccupancy, type SeatGridFloor, type SeatState } from '@shared/ui-patterns/roomSeatGrid';

/** One person already in a room — a live resident, or an invitee holding a bed. */
export interface RoomOccupant {
  key: string;
  name: string;
  /** True for someone invited but not yet activated: the bed is held, not lived in. */
  invited: boolean;
  /** Monthly rent, when the room's data carries one. */
  rent: number;
}

interface RoomSeatGridProps {
  floors: SeatGridFloor[];
  activeFloorId: string | null;
  onSelectFloor: (floorId: string) => void;
  onSelectRoom: (roomId: string) => void;
  /** Who is already in each room, keyed by room id. Absent = nothing to show. */
  occupantsByRoomId?: Record<string, RoomOccupant[]>;
}

const SQUARE_CLASS: Record<SeatState, string> = {
  available: 'border border-border bg-card text-foreground',
  selected: 'border-[1.5px] border-primary bg-primary/10 text-primary',
  unavailable: 'border border-border bg-muted text-muted-foreground cursor-not-allowed',
};

const COUNT_CLASS: Record<SeatState, string> = {
  available: 'text-success',
  selected: 'text-primary',
  unavailable: 'text-muted-foreground',
};

/**
 * The owner's room-assignment picker — a grid of rooms, one tile each, grouped
 * by floor.
 *
 * Every tile carries its own free-bed count. That count was in the rooms
 * response all along and was thrown away before it reached the screen, so an
 * owner assigning a room could see only its number: "which rooms have space"
 * — a question you answer by scanning a floor, not by inspecting one room —
 * could only be answered by tapping rooms until one refused. Making it visible
 * is also what keeps the owner from browsing rooms they don't want, which
 * matters because selecting a room fills in that room's rent.
 *
 * Selecting a room opens a strip beneath naming who is already in it, so the
 * owner can tell a room with one free bed apart from a room with one free bed
 * *and a tenant they'd rather not pair someone with*.
 */
export function RoomSeatGrid({
  floors,
  activeFloorId,
  onSelectFloor,
  onSelectRoom,
  occupantsByRoomId,
}: RoomSeatGridProps) {
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? floors[0] ?? null;
  const selectedRoom = activeFloor?.rooms.find((room) => room.state === 'selected') ?? null;
  const occupants = selectedRoom ? occupantsByRoomId?.[selectedRoom.id] ?? [] : [];

  if (floors.length === 0) return null;

  return (
    <div>
      <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {floors.map((floor) => {
          const active = floor.id === activeFloor?.id;
          const freeBeds = floor.rooms.reduce((sum, room) => sum + room.available, 0);
          return (
            <button
              key={floor.id}
              type="button"
              onClick={() => onSelectFloor(floor.id)}
              aria-pressed={active}
              className={`flex-none rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold ${
                active ? 'bg-foreground text-background' : 'border border-border bg-card text-foreground'
              }`}
            >
              {floor.name}
              {/* A floor that is entirely full is worth knowing before you open it. */}
              {freeBeds === 0 && <span className="ml-1.5 text-[11px] font-medium opacity-60">full</span>}
            </button>
          );
        })}
      </div>

      {activeFloor && (
        <div className="flex flex-wrap gap-2">
          {activeFloor.rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              disabled={room.state === 'unavailable'}
              onClick={() => onSelectRoom(room.id)}
              aria-pressed={room.state === 'selected'}
              aria-label={
                room.occupancyLabel
                  ? `Room ${room.roomNo}, ${describeRoomOccupancy(room.capacity, room.available)}`
                  : `Room ${room.roomNo}`
              }
              className={`flex h-[52px] w-[62px] flex-none flex-col items-center justify-center gap-0.5 rounded-[10px] ${SQUARE_CLASS[room.state]}`}
            >
              <span className="font-display text-[13px] font-bold leading-none tabular-nums">{room.roomNo}</span>
              {room.occupancyLabel && (
                <span className={`text-[9.5px] font-semibold leading-none ${COUNT_CLASS[room.state]}`}>
                  {room.occupancyLabel}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-4 text-[10.5px] text-muted-foreground">
        <Legend swatchClass={SQUARE_CLASS.available} label="Available" />
        <Legend swatchClass={SQUARE_CLASS.selected} label="Selected" />
        <Legend swatchClass={SQUARE_CLASS.unavailable} label="Full" />
      </div>

      {selectedRoom && (
        <div className="mt-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[13px] font-bold text-foreground">Room {selectedRoom.roomNo}</span>
            <span className="text-[11.5px] font-semibold text-muted-foreground">
              {describeRoomOccupancy(selectedRoom.capacity, selectedRoom.available) ?? 'Capacity not set'}
            </span>
          </div>
          {occupants.length === 0 ? (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {selectedRoom.capacity > 0 ? 'Nobody in this room yet.' : 'No occupancy recorded for this room.'}
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {occupants.map((occupant) => (
                <li key={occupant.key} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {occupant.name}
                    {occupant.invited && (
                      /* A held bed is not a lived-in one — an owner reading a
                         count of 2 deserves to know one of them has not turned
                         up yet. */
                      <span className="ml-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-[9.5px] font-bold text-warning">
                        Invited
                      </span>
                    )}
                  </span>
                  {occupant.rent > 0 && (
                    <span className="flex-none tabular-nums text-muted-foreground">
                      ₹{occupant.rent.toLocaleString('en-IN')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-[3px] ${swatchClass}`} />
      {label}
    </span>
  );
}
