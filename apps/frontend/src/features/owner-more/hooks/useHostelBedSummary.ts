import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { roomService } from '@features/rooms/api';

interface BackendRoom {
  capacity: number;
  /** Present on the same grouped response; used by the deposit preview. */
  base_rent?: number | string | null;
}

interface BackendFloorGroup {
  rooms: BackendRoom[];
}

/**
 * Read-only bed-count summary for the Configuration hub — same grouped-rooms
 * call useHostelRooms makes (roomService.getAll(hostelId, { grouped: true })),
 * without the drag/drop/create machinery that hook also carries.
 */
export function useHostelBedSummary(hostelId: string | null) {
  const query = useQuery({
    queryKey: ['hostel', hostelId, 'rooms', 'grouped'],
    queryFn: () => roomService.getAll(hostelId!, { grouped: true }) as Promise<BackendFloorGroup[]>,
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });

  // Rooms and floors come free from the same grouped response the bed count is
  // already summing — the Configuration screens need all three, and refetching
  // the same payload through another hook would be wasteful.
  const totals = useMemo(() => {
    const floors = query.data ?? [];
    const rooms = floors.flatMap((floor) => floor.rooms);
    return {
      bedsTotal: rooms.reduce((sum, r) => sum + (r.capacity || 0), 0),
      roomsTotal: rooms.length,
      floorsTotal: floors.length,
      // Every room's rent, for the deposit preview: "2 months of rent" means a
      // different number per room, so the screen shows an exact figure only when
      // they all agree, and a range otherwise.
      rents: rooms.map((r) => Number(r.base_rent ?? 0)).filter((rent) => Number.isFinite(rent) && rent > 0),
    };
  }, [query.data]);

  return { ...totals, isLoading: query.isLoading };
}
