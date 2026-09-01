import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { roomService } from '@features/rooms/api';
import type { OwnerSessionHostel } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { applyInviteDefaults, inviteDefaults } from '../inviteDefaults';
import { groupRoomsByFloor, type SeatGridSourceRoom } from '@shared/ui-patterns/roomSeatGrid';
import { clampAgreementMonths, describeAgreementEnd } from '../agreementTerm';
import { DurationRing } from './DurationRing';
import { RoomSeatGrid, type RoomOccupant } from './RoomSeatGrid';
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

  /**
   * An owner with one hostel is not making a choice, so they are not asked to
   * make one: the hostel is selected for them and the picker is replaced by a
   * line stating which hostel this is. A select with a single option is a
   * required field that can only be answered one way — pure friction on the
   * step where the owner most wants to get to the room grid.
   *
   * Deliberately keyed on "exactly one", never on "the first one" — picking
   * `hostels[0]` for a multi-hostel owner is precisely the silent-wrong-hostel
   * bug the backend has an invariant check against.
   */
  const soleHostel = hostels.length === 1 ? hostels[0] : null;
  useEffect(() => {
    if (soleHostel && !data.hostelId) setD({ hostelId: soleHostel.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleHostel?.id, data.hostelId]);

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
      // `capacity` and `used` were in this response all along and dropped here,
      // which is why the grid could show a room number and nothing else.
      capacity: Number(r.capacity ?? 0),
      used: Number(r.used ?? 0),
    })),
  );

  /** Who is already in each room — residents first, then invitees holding a bed. */
  const occupantsByRoomId: Record<string, RoomOccupant[]> = {};
  for (const floor of roomsQuery.data ?? []) {
    for (const room of (floor as any).rooms ?? []) {
      occupantsByRoomId[room.id] = ((room.tenants ?? []) as any[]).map((t, i) => ({
        key: String(t.tenant_id ?? `${room.id}-${i}`),
        name: String(t.name ?? 'Tenant'),
        invited: String(t.status ?? '') === 'INVITED',
        rent: Number(t.rent ?? 0),
      }));
    }
  }

  /**
   * The seat grid only needs a room's number and how many beds are free, so
   * its mapping drops `base_rent`. Keep it here: it is what
   * `auto_fill_room_rent` fills the invite's rent from.
   */
  const policyQuery = useHostelPolicy(data.hostelId || null);

  const rentByRoomId = new Map<string, number>(
    (roomsQuery.data ?? []).flatMap((floor: any) =>
      (floor.rooms ?? []).map((r: any) => [r.id, Number(r.base_rent ?? 0)] as [string, number]),
    ),
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
    // Choosing a room is the first moment both halves of the hostel's invite
    // defaults are known — its policy, and this room's rent. `applyInviteDefaults`
    // fills only what the owner has left blank, so an agreed rent already
    // typed for this tenant survives.
    const suggested = applyInviteDefaults(
      data,
      inviteDefaults(policyQuery.data?.policy, { baseRent: rentByRoomId.get(roomId) }),
    );
    setD({ roomId, roomLabel: room?.roomNo ?? '', ...suggested });
  };

  const months = Number(data.agreementMonths) || 0;
  const endsOn = data.joiningDate && months > 0 ? describeAgreementEnd(data.joiningDate, months) : null;

  return (
    <div className="flex flex-col gap-4.5 rounded-2xl border border-border bg-muted p-4">
      {soleHostel ? (
        <div>
          <span className={labelStyle}>Hostel</span>
          <p className="text-sm font-bold text-foreground">{soleHostel.name}</p>
        </div>
      ) : (
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
      )}

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
            <RoomSeatGrid
              floors={floors}
              activeFloorId={activeFloorId}
              onSelectFloor={setActiveFloorId}
              onSelectRoom={selectRoom}
              occupantsByRoomId={occupantsByRoomId}
            />
          </>
        )}
      </div>

      {/*
        When they move in and for how long, read as one thing — because the
        answer an owner is really after is the pair: the date the stay ends.
        These used to be two stacked fields with no stated consequence, the
        second of them a free-text box.
      */}
      <div className="rounded-[14px] border border-border bg-card p-3.5">
        <div className="flex items-start gap-3">
          <label className="block min-w-0 flex-1">
            <span className={labelStyle}>Joining date</span>
            <input
              type="date"
              value={data.joiningDate}
              onChange={(e) => setD({ joiningDate: e.target.value })}
              className="w-full rounded-[11px] border border-border bg-card px-3 py-2.5 text-[13px] font-semibold text-foreground focus:border-primary focus:outline-none"
            />
          </label>
          <div className="w-[92px] flex-none text-center">
            <span className={labelStyle}>Agreement</span>
            <p className="font-display text-2xl font-extrabold leading-none tabular-nums text-foreground">
              {months > 0 ? months : '—'}
            </p>
            <p className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {months === 1 ? 'month' : 'months'}
            </p>
          </div>
        </div>

        <div className="mt-2">
          <DurationRing
            value={data.agreementMonths}
            onChange={(next) => setD({ agreementMonths: String(clampAgreementMonths(next)) })}
          />
        </div>

        <p className="mt-2 border-t border-border pt-2 text-[12px] font-semibold text-foreground">
          {endsOn ?? (
            <span className="font-medium text-muted-foreground">
              {data.joiningDate ? 'Pick a length to see when this ends.' : 'Pick a joining date to see when this ends.'}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
