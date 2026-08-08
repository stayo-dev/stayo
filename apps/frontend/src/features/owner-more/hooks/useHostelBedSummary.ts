import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { roomService } from '@features/rooms/api';

interface BackendRoom {
  capacity: number;
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
    return {
      bedsTotal: floors.reduce((sum, floor) => sum + floor.rooms.reduce((s, r) => s + (r.capacity || 0), 0), 0),
      roomsTotal: floors.reduce((sum, floor) => sum + floor.rooms.length, 0),
      floorsTotal: floors.length,
    };
  }, [query.data]);

  return { ...totals, isLoading: query.isLoading };
}
