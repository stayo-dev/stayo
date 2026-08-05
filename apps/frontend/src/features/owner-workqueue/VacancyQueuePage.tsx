import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BedDouble, DoorOpen, UserPlus, ChevronRight } from 'lucide-react';
import { roomService } from '@features/rooms/api';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { InviteTenantWizard } from '@features/owner-tenants/invite/InviteTenantWizard';
import { WorkQueue, type WorkQueueSection, type WorkQueueItem } from './WorkQueue';

/**
 * Fill Vacant Beds queue (ADR-046).
 *
 * Composed from the existing hostel-scoped `GET /api/rooms`, fanned out across
 * every hostel the owner has — the same pattern `useRealTenantList` uses, and
 * for the same reason: `/api/rooms` requires a hostel, and the queue must
 * never assume one (the no-`hostels[0]` invariant).
 *
 * Priority is **emptiest room first**: a fully empty room is the biggest
 * single revenue gap and the easiest to fill as a unit, so it outranks a room
 * missing one bed.
 */

interface VacantRoom {
  id: string;
  roomNo: string;
  hostelId: string;
  hostelName: string;
  capacity: number;
  occupied: number;
  vacant: number;
  rent: number | null;
}

function readOccupancy(room: any): { capacity: number; occupied: number } {
  const capacity = Number(room.capacity ?? 0);
  // Different room payloads expose occupancy differently; prefer an explicit
  // count, fall back to counting active allocations.
  const occupied =
    room.occupied_beds != null
      ? Number(room.occupied_beds)
      : Array.isArray(room.room_allocations)
        ? room.room_allocations.filter((a: any) => a.is_active && !a.end_date).length
        : Array.isArray(room.occupants)
          ? room.occupants.length
          : 0;
  return { capacity, occupied };
}

export function VacancyQueuePage() {
  const navigate = useNavigate();
  const session = useOwnerSession();
  const [inviteOpen, setInviteOpen] = useState(false);

  const hostels = session.hostels ?? [];

  const query = useQuery({
    queryKey: ['owner', 'vacancy-queue', [...hostels.map((h: any) => h.id)].sort()],
    queryFn: async () => {
      const perHostel = await Promise.all(
        hostels.map(async (h: any) => {
          const raw = (await roomService.getAll(h.id, {})) as any;
          const rooms: any[] = Array.isArray(raw) ? raw : (raw?.rooms ?? []);
          return rooms.map((r) => {
            const { capacity, occupied } = readOccupancy(r);
            return {
              id: r.id,
              roomNo: r.room_no ?? r.roomNo ?? '',
              hostelId: h.id,
              hostelName: h.name ?? '',
              capacity,
              occupied,
              vacant: Math.max(capacity - occupied, 0),
              rent: r.base_rent != null ? Number(r.base_rent) : null,
            } as VacantRoom;
          });
        }),
      );
      return perHostel.flat().filter((r) => r.vacant > 0);
    },
    enabled: session.isAuthenticated && hostels.length > 0,
    staleTime: 60_000,
  });

  const rooms = query.data ?? [];

  const sections: WorkQueueSection[] = useMemo(() => {
    const empty = rooms.filter((r) => r.occupied === 0);
    const partial = rooms.filter((r) => r.occupied > 0);

    const toItem = (r: VacantRoom): WorkQueueItem => ({
      id: r.id,
      title: `Room ${r.roomNo}`,
      subtitle: [r.hostelName, `${r.occupied}/${r.capacity} beds filled`].filter(Boolean).join(' · '),
      headline: `${r.vacant} bed${r.vacant === 1 ? '' : 's'} free`,
      headlineTone: 'success',
      urgency: r.rent ? `₹${r.rent.toLocaleString('en-IN')}/mo each` : undefined,
      onOpen: () => navigate(`/owner/hostels/${r.hostelId}/rooms?room=${r.id}`),
      actions: [
        { id: 'invite', label: 'Invite tenant', Icon: UserPlus, primary: true, onClick: () => setInviteOpen(true) },
        {
          id: 'room',
          label: 'Open room',
          Icon: ChevronRight,
          onClick: () => navigate(`/owner/hostels/${r.hostelId}/rooms?room=${r.id}`),
        },
      ],
    });

    // Emptiest first within each section — the largest gap is the best use of
    // the owner's next call.
    const byVacancy = (a: VacantRoom, b: VacantRoom) => b.vacant - a.vacant || a.roomNo.localeCompare(b.roomNo);

    const out: WorkQueueSection[] = [];
    if (empty.length) {
      out.push({
        id: 'EMPTY',
        label: 'Completely empty rooms',
        Icon: DoorOpen,
        tone: 'text-destructive',
        summary: `${empty.length} · ${empty.reduce((n, r) => n + r.vacant, 0)} beds`,
        items: [...empty].sort(byVacancy).map(toItem),
      });
    }
    if (partial.length) {
      out.push({
        id: 'PARTIAL',
        label: 'Rooms with spare beds',
        Icon: BedDouble,
        tone: 'text-warning',
        summary: `${partial.length} · ${partial.reduce((n, r) => n + r.vacant, 0)} beds`,
        items: [...partial].sort(byVacancy).map(toItem),
      });
    }
    return out;
  }, [rooms, navigate]);

  const totalBeds = rooms.reduce((n, r) => n + r.vacant, 0);
  const state = query.isLoading ? 'loading' : query.isError ? 'error' : rooms.length === 0 ? 'empty' : 'ready';

  return (
    <WorkQueue
      title="Vacant beds"
      subtitle={`${totalBeds} bed${totalBeds === 1 ? '' : 's'} free across ${rooms.length} room${rooms.length === 1 ? '' : 's'}`}
      state={state}
      sections={sections}
      emptyTitle="Every bed is filled"
      emptyBody="No room in your portfolio has a free bed right now."
      onRetry={() => query.refetch()}
    >
      <InviteTenantWizard open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </WorkQueue>
  );
}
