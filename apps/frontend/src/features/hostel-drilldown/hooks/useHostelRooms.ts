import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { floorService, roomService } from '@features/rooms/api';
import type { RoomWithOccupants, RoomOccupant } from '../types';

interface BackendRoom {
  id: string;
  room_no: string;
  capacity: number;
  base_rent: number | null;
  floor_id: string | null;
  occupied: number;
  reserved: number;
  tenants: Array<{ tenant_id: string; name: string; rent: number; pending_dues: number; status: string }>;
}

interface BackendFloorGroup {
  id: string;
  name: string;
  sort_order: number;
  rooms: BackendRoom[];
}

function mapRoom(hostelId: string, floorId: string, room: BackendRoom): RoomWithOccupants {
  const occupants: RoomOccupant[] = room.tenants.map((t) => ({
    tenant_id: t.tenant_id,
    name: t.name,
    rent: t.rent,
    pending_dues: t.pending_dues,
    status: t.status,
  }));
  const beds: RoomWithOccupants['beds'] = [];
  for (let i = 0; i < room.occupied; i++) beds.push({ id: `${room.id}-o${i}`, status: 'occupied', tenantId: occupants[i]?.tenant_id });
  for (let i = 0; i < room.reserved; i++) beds.push({ id: `${room.id}-r${i}`, status: 'reserved' });
  const filled = beds.length;
  for (let i = filled; i < room.capacity; i++) beds.push({ id: `${room.id}-v${i}`, status: 'vacant' });

  return {
    id: room.id,
    number: room.room_no,
    floorId,
    hostelId,
    rent: Number(room.base_rent ?? 0),
    beds,
    occupants,
    space: (room as any).space ?? null,
  };
}

/**
 * Real floor/room data for the Rooms tab, replacing `useRoomsLayout`'s mock
 * source. Per-bed identity isn't a real backend concept (see the backend
 * readiness audit) — `beds[]` is synthesized from the real `occupied`/
 * `reserved`/`capacity` counts the backend already computes, in the same
 * shape `RoomRow`/`FloorGroup`/`RoomLayoutCard` already expect, so none of
 * those presentational components needed to change.
 */
export function useHostelRooms(hostelId: string) {
  const queryClient = useQueryClient();

  const queryKey = ['hostel', hostelId, 'rooms', 'grouped'];

  const roomsQuery = useQuery({
    queryKey,
    queryFn: () => roomService.getAll(hostelId, { grouped: true }) as Promise<BackendFloorGroup[]>,
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const floors = useMemo(
    () => (roomsQuery.data ?? []).map((f) => ({ id: f.id, hostelId, name: f.name, order: f.sort_order })),
    [roomsQuery.data, hostelId],
  );

  const roomsByFloor = useMemo(() => {
    const map = new Map<string, RoomWithOccupants[]>();
    for (const f of roomsQuery.data ?? []) {
      map.set(f.id, f.rooms.map((r) => mapRoom(hostelId, f.id, r)));
    }
    return map;
  }, [roomsQuery.data, hostelId]);

  const allRooms = useMemo(() => Array.from(roomsByFloor.values()).flat(), [roomsByFloor]);

  const stats = useMemo(() => {
    let bedsOccupied = 0;
    let bedsTotal = 0;
    let vacantRooms = 0;
    let reservedRooms = 0;
    for (const room of allRooms) {
      bedsTotal += room.beds.length;
      bedsOccupied += room.beds.filter((b) => b.status === 'occupied').length;
      if (room.beds.every((b) => b.status === 'vacant')) vacantRooms++;
      if (room.beds.some((b) => b.status === 'reserved')) reservedRooms++;
    }
    return { bedsOccupied, bedsTotal, vacantRooms, reservedRooms };
  }, [allRooms]);

  /**
   * Persists a floor's room order, staged locally in `RoomsReorderPanel` and
   * committed here only when the owner taps Save on the Rooms tab's Reorder
   * mode (ADR-064). Optimistic: the cache is updated immediately so the list
   * doesn't snap back while the request is in flight. `floorId` is the
   * frontend's `"__unassigned"` sentinel for rooms with no floor_id — mapped
   * to `null` for the API, matched back against `f.id` for the cache write.
   */
  const reorderMutation = useMutation({
    mutationFn: ({ floorId, order }: { floorId: string; order: string[] }) =>
      roomService.reorder({ hostelId, floorId: floorId === '__unassigned' ? null : floorId, order }),

    onMutate: async ({ floorId, order }: { floorId: string; order: string[] }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BackendFloorGroup[]>(queryKey);

      if (previous) {
        const position = new Map(order.map((id, i) => [id, i]));
        queryClient.setQueryData<BackendFloorGroup[]>(
          queryKey,
          previous.map((f) =>
            f.id === floorId
              ? { ...f, rooms: [...f.rooms].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0)) }
              : f,
          ),
        );
      }

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: invalidate,
  });

  const reorderRooms = (floorId: string, order: string[]) => reorderMutation.mutateAsync({ floorId, order });

  /**
   * Persists a hostel's floor order (Rooms tab Reorder mode, ADR-064).
   * There's no bulk floor-reorder endpoint, so this writes each floor's
   * `sort_order` via the existing per-floor `PATCH /floors/:id` — same
   * optimistic-then-invalidate shape as `reorderMutation` above.
   */
  const reorderFloorsMutation = useMutation({
    mutationFn: (order: string[]) => Promise.all(order.map((id, index) => floorService.update(id, { sort_order: index }))),

    onMutate: async (order: string[]) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BackendFloorGroup[]>(queryKey);

      if (previous) {
        const position = new Map(order.map((id, i) => [id, i]));
        queryClient.setQueryData<BackendFloorGroup[]>(
          queryKey,
          [...previous].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0)),
        );
      }

      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: invalidate,
  });

  const reorderFloors = (order: string[]) => reorderFloorsMutation.mutateAsync(order);

  const createFloorMutation = useMutation({
    mutationFn: (data: { name: string; sort_order?: number }) => floorService.create(hostelId, data),
    onSuccess: invalidate,
  });

  const createRoomMutation = useMutation({
    mutationFn: (data: { room_no: string; floor_id?: string; capacity: number; base_rent?: number }) => roomService.create(hostelId, data),
    onSuccess: invalidate,
  });

  const updateRoomMutation = useMutation({
    mutationFn: ({ roomId, data }: { roomId: string; data: { room_no?: string; capacity?: number; base_rent?: number; floor_id?: string } }) =>
      roomService.update(roomId, data),
    onSuccess: invalidate,
  });

  /**
   * Real deletes, not archives — unlike a hostel, which is archived.
   *
   * Both endpoints existed with no caller anywhere in the app until
   * 2026-08-24, so a room or floor added by mistake could never be removed.
   * Both refuse rather than cascade: a room with a tenant or a live invitation
   * reservation, and a floor with any active room, are rejected server-side —
   * `propertyRemoval.ts` states those reasons in the UI first.
   */
  const deleteRoomMutation = useMutation({
    mutationFn: (roomId: string) => roomService.delete(roomId),
    onSuccess: invalidate,
  });

  const deleteFloorMutation = useMutation({
    mutationFn: (floorId: string) => floorService.delete(floorId),
    onSuccess: invalidate,
  });

  return {
    floors,
    roomsByFloor,
    stats,
    reorderRooms,
    isReordering: reorderMutation.isPending,
    reorderFloors,
    isReorderingFloors: reorderFloorsMutation.isPending,
    isLoading: roomsQuery.isLoading,
    isError: roomsQuery.isError,
    error: roomsQuery.error,
    refetch: roomsQuery.refetch,
    createFloor: createFloorMutation.mutateAsync,
    isCreatingFloor: createFloorMutation.isPending,
    createRoom: createRoomMutation.mutateAsync,
    isCreatingRoom: createRoomMutation.isPending,
    updateRoom: updateRoomMutation.mutateAsync,
    isUpdatingRoom: updateRoomMutation.isPending,
    deleteRoom: deleteRoomMutation.mutateAsync,
    isDeletingRoom: deleteRoomMutation.isPending,
    deleteFloor: deleteFloorMutation.mutateAsync,
    isDeletingFloor: deleteFloorMutation.isPending,
  };
}
