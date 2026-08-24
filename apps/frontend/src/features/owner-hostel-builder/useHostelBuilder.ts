import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerService } from '@features/owners/api';
import { identityService } from '@features/auth/api';
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
  /**
   * Set when the server asks for a password before creating this hostel.
   * Step-up applies from the owner's *second* hostel onward, so this cannot
   * be known up front without an extra request — the 403 is the signal, and
   * the Name step reveals a password field in response.
   */
  const [needsPassword, setNeedsPassword] = useState(false);

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
    mutationFn: async (input: { name: string; city?: string; password?: string }) => {
      // An owner adding their second hostel must re-confirm their password.
      // The token is minted only when one is offered, so a first hostel — the
      // common case — never sees a password prompt at all.
      let identityToken: string | undefined;
      if (input.password) {
        const identity = await identityService.confirmIdentity(input.password, 'CREATE_HOSTEL');
        identityToken = identity?.identity_token;
        if (!identityToken) throw new Error('That password did not match. Try again.');
      }
      return ownerService.createHostel({
        name: input.name.trim(),
        city: input.city?.trim() ?? '',
        ...(identityToken ? { identity_token: identityToken } : {}),
      });
    },
    onSuccess: (result: any) => {
      const created = result?.data ?? result;
      setHostelId(String(created?.id ?? ''));
      setNeedsPassword(false);
      invalidate();
      setStage('floors');
    },
    onError: (error: any) => {
      const code = error?.response?.data?.error?.code;
      if (code === 'IDENTITY_REQUIRED' || code === 'IDENTITY_EXPIRED') setNeedsPassword(true);
    },
  });

  // ── Step 1: floors are real rows, created empty ──────────────────────────
  /**
   * Idempotent, because Back exists.
   *
   * This used to create every floor in the list on every press, so an owner
   * who stepped back from Rooms to Floors and continued got a *second* set of
   * floors. It now creates only the ones missing, renames the ones already
   * there, and refuses to silently drop floors that exist — deleting a floor
   * is the Rooms tab's job, where the consequences are visible.
   */
  const createFloors = useMutation({
    mutationFn: async (names: string[]) => {
      if (names.length < floors.length) {
        throw new Error(
          `This hostel already has ${floors.length} floors. You can remove one from the Rooms tab.`,
        );
      }

      const created: DraftFloor[] = [];

      // Sequential on purpose: `sort_order` must match the order the owner
      // arranged, and the endpoint takes one floor at a time.
      for (let i = 0; i < names.length; i += 1) {
        const existingFloor = floors[i];
        if (existingFloor) {
          // Already a row — carry it through, renaming only if it changed.
          if (existingFloor.name !== names[i]) {
            await floorService.update(existingFloor.id, { name: names[i] });
          }
          created.push({ ...existingFloor, name: names[i] });
          continue;
        }
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
      // Land on the first floor still needing rooms rather than always the
      // ground floor — coming back from Floors mid-build should not send the
      // owner through work they have already done.
      const next = buildProgress(created.map((f) => ({ name: f.name, roomCount: f.rooms.length })));
      setActiveIndex(next.nextFloorIndex ?? 0);
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

  /**
   * Drop one room from the active floor.
   *
   * The `−` stepper resizes from the end (`resizeFloorRooms`), so removing a
   * room in the middle used to mean deleting every room after it and entering
   * them again. Numbers are deliberately *not* regenerated: renumbering the
   * survivors would rename rooms the owner has already labelled, and on a
   * floor that has been saved once those numbers are now real rooms.
   */
  const removeRoom = useCallback(
    (key: string) =>
      setFloors((prev) =>
        prev.map((floor, i) =>
          i === activeIndex ? { ...floor, rooms: floor.rooms.filter((room) => room.key !== key) } : floor,
        ),
      ),
    [activeIndex],
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
    needsPassword,
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
    removeRoom,
    renameFloor,
    cloneToNext,
    advance,
  };
}

export type HostelBuilderApi = ReturnType<typeof useHostelBuilder>;
