import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerService } from '@features/owners/api';
import { floorService, roomService } from '@features/rooms/api';
import { queryKeys } from '@lib/queryKeys';
import {
  applyFloorDefaults,
  buildProgress,
  buildingTally,
  cloneFloorShape,
  defaultFloorName,
  editRoom as editRoomIn,
  floorBlocker,
  rememberRent,
  resizeFloorRooms,
  toRoomsPayload,
  type DraftFloor,
  type DraftRoom,
  type NumberingPattern,
  type RentMemory,
} from './hostelBuilder';

export type BuilderStage = 'name' | 'floors' | 'fill' | 'review';

/**
 * Drives the Add Hostel builder.
 *
 * Writes are incremental by design: the `hostels` row exists from the moment
 * it is named, floors are created when their count is set, and each floor's
 * rooms are saved on leaving that floor. So "finish later" needs no local
 * draft — the partly-built hostel is already the owner's, resuming is a read,
 * and progress is derived from which floors have rooms rather than from a
 * stored step counter that could disagree with the data.
 */
export function useHostelBuilder(existingHostelId?: string) {
  const queryClient = useQueryClient();

  const [hostelId, setHostelId] = useState(existingHostelId ?? '');
  const [hostelName, setHostelName] = useState('');
  const [stage, setStage] = useState<BuilderStage>(existingHostelId ? 'fill' : 'name');
  const [floors, setFloors] = useState<DraftFloor[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pattern, setPattern] = useState<NumberingPattern>('NUMERIC');
  const [rentMemory, setRentMemory] = useState<RentMemory>({});
  const [hydrated, setHydrated] = useState(false);

  // ── Resume ───────────────────────────────────────────────────────────────
  const existing = useQuery({
    queryKey: ['owner', 'hostel-builder', hostelId],
    queryFn: () => roomService.getAll(hostelId, { grouped: true }),
    enabled: Boolean(hostelId) && Boolean(existingHostelId),
    staleTime: 0,
  });

  useEffect(() => {
    if (hydrated || !existingHostelId || !existing.data) return;
    const groups: Record<string, any>[] = Array.isArray(existing.data)
      ? existing.data
      : Array.isArray((existing.data as any)?.floors)
        ? (existing.data as any).floors
        : [];

    const restored: DraftFloor[] = groups
      .filter((group) => group.id)
      .map((group) => {
        const rooms: DraftRoom[] = (Array.isArray(group.rooms) ? group.rooms : []).map((room: any, i: number) => ({
          key: `s${room.id ?? i}`,
          roomNo: String(room.room_no ?? ''),
          capacity: Number(room.capacity ?? 0),
          rent: room.base_rent === null || room.base_rent === undefined ? null : Number(room.base_rent),
          customised: true,
        }));
        return {
          id: String(group.id),
          name: String(group.name ?? ''),
          defaultCapacity: rooms[0]?.capacity ?? 4,
          defaultRent: rooms[0]?.rent ?? null,
          rooms,
          saved: rooms.length > 0,
        };
      });

    if (restored.length > 0) {
      setFloors(restored);
      const progress = buildProgress(restored.map((f) => ({ name: f.name, roomCount: f.rooms.length })));
      setActiveIndex(progress.nextFloorIndex ?? 0);
      setStage(progress.isComplete ? 'review' : 'fill');
      // Seed the rent memory from what is already priced, so continuing a
      // build behaves like never having left it.
      setRentMemory(
        restored.reduce<RentMemory>(
          (memory, floor) => floor.rooms.reduce((acc, room) => rememberRent(acc, room.capacity, room.rent), memory),
          {},
        ),
      );
    }
    setHydrated(true);
  }, [existing.data, existingHostelId, hydrated]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.summary() });
    queryClient.invalidateQueries({ queryKey: ['owner', 'hostels'] });
    if (hostelId) queryClient.invalidateQueries({ queryKey: queryKeys.rooms.list(hostelId) });
  }, [queryClient, hostelId]);

  // ── Step 0: the hostel exists as soon as it is named ─────────────────────
  const createHostel = useMutation({
    mutationFn: (input: { name: string; city?: string }) =>
      ownerService.createHostel({ name: input.name.trim(), city: input.city?.trim() ?? '' }),
    onSuccess: (result: any) => {
      const created = result?.data ?? result;
      setHostelId(String(created?.id ?? ''));
      invalidate();
      setStage('floors');
    },
  });

  // ── Step 1: floors are real rows, created empty ──────────────────────────
  const createFloors = useMutation({
    mutationFn: async (names: string[]) => {
      const created: DraftFloor[] = [];
      // Sequential on purpose: `sort_order` must match the order the owner
      // arranged, and the endpoint takes one floor at a time.
      for (let i = 0; i < names.length; i += 1) {
        const row: any = await floorService.create(hostelId, { name: names[i], sort_order: i + 1 });
        const floorRow = row?.data ?? row;
        created.push({
          id: String(floorRow?.id ?? ''),
          name: names[i],
          defaultCapacity: 4,
          defaultRent: null,
          rooms: [],
          saved: false,
        });
      }
      return created;
    },
    onSuccess: (created) => {
      setFloors(created);
      setActiveIndex(0);
      setStage('fill');
      invalidate();
    },
  });

  // ── Step 2: one request per floor ────────────────────────────────────────
  const saveFloor = useMutation({
    mutationFn: async (index: number) => {
      const floor = floors[index];
      const blocker = floorBlocker(floor);
      if (blocker) throw new Error(blocker);
      await roomService.bulkCreateForFloor(floor.id, toRoomsPayload(floor));
      return index;
    },
    onSuccess: (index) => {
      setFloors((prev) => prev.map((floor, i) => (i === index ? { ...floor, saved: true } : floor)));
      invalidate();
    },
  });

  // ── Editing ──────────────────────────────────────────────────────────────
  const activeFloor = floors[activeIndex];

  const setRoomCount = useCallback(
    (count: number) =>
      setFloors((prev) =>
        prev.map((floor, i) =>
          i === activeIndex
            ? { ...floor, rooms: resizeFloorRooms(floor, count, { pattern, floorIndex: i, rentMemory }) }
            : floor,
        ),
      ),
    [activeIndex, pattern, rentMemory],
  );

  const setFloorDefaults = useCallback(
    (defaults: { capacity?: number; rent?: number | null }) => {
      setFloors((prev) => prev.map((floor, i) => (i === activeIndex ? applyFloorDefaults(floor, defaults, rentMemory) : floor)));
      if (defaults.rent !== undefined && defaults.rent !== null) {
        setRentMemory((memory) =>
          rememberRent(memory, defaults.capacity ?? floors[activeIndex]?.defaultCapacity ?? 0, defaults.rent!),
        );
      }
    },
    [activeIndex, rentMemory, floors],
  );

  const updateRoom = useCallback(
    (key: string, patch: Partial<Pick<DraftRoom, 'roomNo' | 'capacity' | 'rent'>>) => {
      setFloors((prev) => prev.map((floor, i) => (i === activeIndex ? editRoomIn(floor, key, patch) : floor)));
      if (patch.rent !== undefined && patch.rent !== null) {
        const room = floors[activeIndex]?.rooms.find((r) => r.key === key);
        const capacity = patch.capacity ?? room?.capacity;
        if (capacity) setRentMemory((memory) => rememberRent(memory, capacity, patch.rent!));
      }
    },
    [activeIndex, floors],
  );

  const renameFloor = useCallback((index: number, name: string) => {
    setFloors((prev) => prev.map((floor, i) => (i === index ? { ...floor, name } : floor)));
  }, []);

  /** "Same as this" — carry this floor's shape onto the next one. */
  const cloneToNext = useCallback(() => {
    const nextIndex = activeIndex + 1;
    if (nextIndex >= floors.length) return;
    setFloors((prev) =>
      prev.map((floor, i) =>
        i === nextIndex ? cloneFloorShape(prev[activeIndex], floor, { pattern, floorIndex: nextIndex }) : floor,
      ),
    );
  }, [activeIndex, floors.length, pattern]);

  /** Save the current floor, then move on — or finish. */
  const advance = useCallback(async () => {
    await saveFloor.mutateAsync(activeIndex);
    if (activeIndex + 1 < floors.length) {
      setActiveIndex(activeIndex + 1);
    } else {
      setStage('review');
    }
  }, [activeIndex, floors.length, saveFloor]);

  const progress = useMemo(
    () => buildProgress(floors.map((floor) => ({ name: floor.name, roomCount: floor.rooms.length }))),
    [floors],
  );

  return {
    stage,
    setStage,
    hostelId,
    hostelName,
    setHostelName,
    floors,
    activeIndex,
    setActiveIndex,
    activeFloor,
    pattern,
    setPattern,
    progress,
    tally: buildingTally(floors),
    blocker: activeFloor ? floorBlocker(activeFloor) : null,
    defaultFloorName,
    isRestoring: existing.isLoading,
    createHostel,
    createFloors,
    saveFloor,
    setRoomCount,
    setFloorDefaults,
    updateRoom,
    renameFloor,
    cloneToNext,
    advance,
  };
}

export type HostelBuilderApi = ReturnType<typeof useHostelBuilder>;
