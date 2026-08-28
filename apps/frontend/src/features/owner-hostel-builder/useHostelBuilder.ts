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
  renumberBuilding,
  resizeFloorRooms,
  resumeStage,
  toRoomsPayload,
  type DraftFloor,
  type DraftRoom,
  type NumberingPattern,
  type RentMemory,
} from './hostelBuilder';
import { primaryFloorAction, sweepBlocker, unsavedFloorIndexes } from './floorStrip';

export type BuilderStage = 'name' | 'floors' | 'fill' | 'review' | 'agreement';

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
  // Resuming does NOT assume a stage. It used to start at 'fill' the moment an
  // id was present — decided before any data loaded — which dropped an owner
  // who had only named their hostel onto "What's on ground floor?" with no
  // floors to fill. `resuming` holds the screen until the real answer is known;
  // see resumeStage.
  const [stage, setStage] = useState<BuilderStage>('name');
  const [floors, setFloors] = useState<DraftFloor[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pattern, setPattern] = useState<NumberingPattern>('NUMERIC');
  const [rentMemory, setRentMemory] = useState<RentMemory>({});
  const [hydrated, setHydrated] = useState(false);
  /** True while a resumed build is still loading — the step is not known yet. */
  const resuming = Boolean(existingHostelId) && !hydrated;
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

  /**
   * The resume read (`roomService.getAll`) returns floors and rooms, not the
   * hostel itself — so the name was never restored and stepping back to the
   * Name step showed an empty field on a hostel that plainly had one. The
   * owner's hostel list is the cheapest source and is usually already cached by
   * the dashboard that linked here.
   */
  const existingHostel = useQuery({
    queryKey: ['owner', 'hostels'],
    queryFn: () => ownerService.getHostels(),
    enabled: Boolean(existingHostelId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!existingHostelId || hostelName) return;
    const list: any[] = Array.isArray(existingHostel.data)
      ? existingHostel.data
      : Array.isArray((existingHostel.data as any)?.hostels)
        ? (existingHostel.data as any).hostels
        : [];
    const match = list.find((row) => String(row?.id) === String(existingHostelId));
    if (match?.name) setHostelName(String(match.name));
  }, [existingHostel.data, existingHostelId, hostelName]);

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

    // Derived in every case, including zero floors — the old code only set a
    // stage inside `if (restored.length > 0)`, so a hostel with no floors kept
    // the assumed 'fill' and showed a floor-filling screen with nothing to fill.
    const resumed = resumeStage(restored.map((f) => ({ name: f.name, roomCount: f.rooms.length })));
    setStage(resumed.stage);
    setActiveIndex(resumed.activeIndex);

    if (restored.length > 0) {
      setFloors(restored);
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

  /**
   * Save the current floor, then move to the next one that still needs rooms
   * — or finish, sweeping up everything left unsaved.
   *
   * Both halves changed when the floor switcher arrived. It used to step to
   * `activeIndex + 1`, which with free navigation marches past floors already
   * filled and stops short of ones that were skipped. And it used to be the
   * *only* way past a floor, so every floor was necessarily written on the way
   * through; now an owner can fill the ground floor, tap across to the second,
   * and finish — so finishing has to write whatever the walk missed.
   *
   * The sweep is validated in full before it writes anything (`sweepBlocker`):
   * writing two floors and then failing on a third is the worst outcome, and
   * the owner would be looking at a screen that says neither.
   */
  const advance = useCallback(async () => {
    const blocker = sweepBlocker(floors);
    const action = primaryFloorAction(floors, activeIndex);

    if (action.kind === 'continue') {
      await saveFloor.mutateAsync(activeIndex);
      setActiveIndex(action.nextIndex);
      return;
    }

    if (blocker) {
      setActiveIndex(blocker.index);
      throw new Error(blocker.reason);
    }

    // Sequential, not parallel: each save is its own request and a failure
    // half-way should leave the earlier floors written rather than racing.
    // Re-saving an already-saved floor is a no-op (ADR-097), so the active
    // floor being in this list too is harmless.
    for (const index of unsavedFloorIndexes(floors)) {
      await saveFloor.mutateAsync(index);
    }
    setStage('review');
  }, [activeIndex, floors, saveFloor]);

  /**
   * Change the numbering scheme, and actually apply it.
   *
   * `setPattern` was wired to the picker directly, so changing the scheme
   * highlighted a chip and renumbered nothing: the pattern only ever reached
   * `resizeFloorRooms`, which numbers rooms as it creates them. An owner who
   * set the room count before picking a scheme saw a control that did not
   * work.
   *
   * Applied across **every** floor, because the scheme is one decision for the
   * property rather than a per-floor setting — changing it on the second floor
   * used to leave the first on the old scheme, one building numbered two ways.
   * Rooms the owner named by hand keep their names; see `renumberFloor`.
   */
  const changePattern = useCallback(
    (next: NumberingPattern) => {
      if (next === pattern) return;
      // Read from the closure rather than a `setPattern` updater: a side
      // effect inside an updater runs twice under StrictMode. `renumberBuilding`
      // happens to be idempotent, but a state setter is not the place to find
      // that out.
      setFloors((prev) => renumberBuilding(prev, pattern, next));
      setPattern(next);
    },
    [pattern],
  );

  /** Jump straight to a floor. Purely local — nothing is written on a switch. */
  const goToFloor = useCallback(
    (index: number) => {
      if (index >= 0 && index < floors.length) setActiveIndex(index);
    },
    [floors.length],
  );

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
    setPattern: changePattern,
    progress,
    tally: buildingTally(floors),
    blocker: activeFloor ? floorBlocker(activeFloor) : null,
    defaultFloorName,
    // Not just `existing.isLoading`: that goes false one render *before* the
    // hydration effect runs, and the old code rendered its assumed 'fill' stage
    // in that gap. `resuming` stays true until the stage has actually been
    // derived from the data.
    isRestoring: resuming || existing.isLoading,
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
    goToFloor,
  };
}

export type HostelBuilderApi = ReturnType<typeof useHostelBuilder>;
