import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { floorService, roomService } from '@features/rooms/api';
import type { RoomsViewMode, RoomWithOccupants, RoomOccupant } from '../types';

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
  const [mode, setMode] = useState<RoomsViewMode>('browse');
  const [dragRoomId, setDragRoomId] = useState<string | null>(null);
  const [dragOverFloorId, setDragOverFloorId] = useState<string | null>(null);

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

  const startDrag = (roomId: string) => setDragRoomId(roomId);
  const dragOverFloor = (floorId: string) => setDragOverFloorId(floorId);
  const endDrag = () => {
    setDragRoomId(null);
    setDragOverFloorId(null);
  };

  const moveRoomMutation = useMutation({
    mutationFn: ({ roomId, floorId }: { roomId: string; floorId: string }) => roomService.update(roomId, { floor_id: floorId }),
    onSuccess: invalidate,
  });

  const dropOnFloor = (floorId: string) => {
    if (!dragRoomId) return;
    moveRoomMutation.mutate({ roomId: dragRoomId, floorId });
    endDrag();
  };

  const createFloorMutation = useMutation({
    mutationFn: (data: { name: string; sort_order?: number }) => floorService.create(hostelId, data),
    onSuccess: invalidate,
  });

  const createRoomMutation = useMutation({
    mutationFn: (data: { room_no: string; floor_id?: string; capacity: number; base_rent?: number }) => roomService.create(hostelId, data),
    onSuccess: invalidate,
  });

  return {
    floors,
    roomsByFloor,
    stats,
    mode,
    setMode,
    dragRoomId,
    dragOverFloorId,
    startDrag,
    dragOverFloor,
    dropOnFloor,
    endDrag,
    isLoading: roomsQuery.isLoading,
    createFloor: createFloorMutation.mutateAsync,
    isCreatingFloor: createFloorMutation.isPending,
    createRoom: createRoomMutation.mutateAsync,
    isCreatingRoom: createRoomMutation.isPending,
  };
}
