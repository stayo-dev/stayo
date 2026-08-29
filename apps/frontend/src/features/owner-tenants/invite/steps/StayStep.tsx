import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { roomService } from '@features/rooms/api';
import type { OwnerSessionHostel } from '@features/owner-session/useOwnerSession';
import { groupRoomsByFloor, type SeatGridSourceRoom } from '@shared/ui-patterns/roomSeatGrid';
import { RoomSeatGrid } from './RoomSeatGrid';
import type { InviteWizardData } from '../../types';

interface StayStepProps {
  data: InviteWizardData;
  setD: (patch: Partial<InviteWizardData>) => void;
  hostels: OwnerSessionHostel[];
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/** Step 2/4 of the Invite Tenant wizard — which hostel, room, and when. Real hostels + real rooms (`GET /api/rooms?grouped=true`). */
export function StayStep({ data, setD, hostels }: StayStepProps) {
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);

  const roomsQuery = useQuery({
    queryKey: ['hostel', data.hostelId, 'rooms', 'grouped'],
    queryFn: () => roomService.getAll(data.hostelId, { grouped: true }),
    enabled: Boolean(data.hostelId),
    staleTime: 30_000,
  });

  const seatGridRooms: SeatGridSourceRoom[] = (roomsQuery.data ?? []).flatMap((floor: any) =>
    (floor.rooms ?? []).map((r: any) => ({
      id: r.id,
      roomNo: r.room_no,
      floorId: floor.id,
      floorName: floor.name,
      available: Number(r.available ?? 0),
    })),
  );
  const floors = groupRoomsByFloor(seatGridRooms, { selectedRoomId: data.roomId || null });

  const preferredStillAvailable =
    Boolean(data.preferredRoomId) && seatGridRooms.some((r) => r.id === data.preferredRoomId && r.available > 0);
  const preferredNoLongerAvailable = Boolean(data.preferredRoomId) && !data.roomId && !preferredStillAvailable;

  /**
   * Auto-preselects the tenant's preferred room the moment this hostel's real
   * rooms load — but only when the owner hasn't already picked something, and
   * only when the fresh capacity data confirms it's still free. Auto-assigning
   * a room the tenant merely asked for, without rechecking, is exactly the
   * "never assign an occupied room" rule this exists to respect. Runs once
   * per rooms load rather than on every render, so it never fights a manual
   * change the owner makes afterward.
   */
  useEffect(() => {
    if (!roomsQuery.data || data.roomId) return;
    if (data.preferredRoomId) {
      const room = seatGridRooms.find((r) => r.id === data.preferredRoomId);
      if (room && room.available > 0) {
        setD({ roomId: room.id, roomLabel: room.roomNo });
        setActiveFloorId(room.floorId);
        return;
      }
    }
    if (data.preferredFloorId && floors.some((f) => f.id === data.preferredFloorId)) {
      setActiveFloorId(data.preferredFloorId);
    } else if (!activeFloorId) {
      setActiveFloorId(floors[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomsQuery.data]);

  const selectHostel = (hostelId: string) => {
    setD({ hostelId, roomId: '', roomLabel: '' });
    setActiveFloorId(null);
  };
  const selectRoom = (roomId: string) => {
    const room = seatGridRooms.find((r) => r.id === roomId);
    setD({ roomId, roomLabel: room?.roomNo ?? '' });
  };

  return (
    <div className="flex flex-col gap-4.5 rounded-2xl border border-border bg-muted p-4">
      <label className="block">
        <span className={labelStyle}>Hostel</span>
        <select
          value={data.hostelId}
          onChange={(e) => selectHostel(e.target.value)}
          className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        >
          <option value="" disabled>
            Select a hostel
          </option>
          {hostels.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className={labelStyle}>Room</span>
        {!data.hostelId ? (
          <p className="text-[12.5px] text-muted-foreground">Select a hostel first</p>
        ) : roomsQuery.isLoading ? (
          <p className="text-[12.5px] text-muted-foreground">Loading rooms…</p>
        ) : floors.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No rooms set up for this hostel yet</p>
        ) : (
          <>
            {preferredNoLongerAvailable && (
              <p className="mb-2 rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2 text-[11.5px] font-semibold text-warning">
                Preferred room {data.preferredRoomNo} is no longer available — choose another.
              </p>
            )}
            <RoomSeatGrid floors={floors} activeFloorId={activeFloorId} onSelectFloor={setActiveFloorId} onSelectRoom={selectRoom} />
            {data.roomLabel && <p className="mt-2 text-[12px] font-semibold text-foreground">Selected: {data.roomLabel}</p>}
          </>
        )}
      </div>

      <label className="block">
        <span className={labelStyle}>Joining date</span>
        <input
          type="date"
          value={data.joiningDate}
          onChange={(e) => setD({ joiningDate: e.target.value })}
          className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        />
      </label>
      <label className="block">
        <span className={labelStyle}>Agreement duration (months)</span>
        <input
          value={data.agreementMonths}
          onChange={(e) => setD({ agreementMonths: e.target.value.replace(/[^0-9]/g, '') })}
          inputMode="numeric"
          placeholder="12"
          className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        />
      </label>
    </div>
  );
}
