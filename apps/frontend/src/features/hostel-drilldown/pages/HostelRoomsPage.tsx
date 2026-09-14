import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpDown, Search, X } from 'lucide-react';
import { InviteTenantWizard } from '@features/owner-tenants/invite/InviteTenantWizard';
import { ChangeRoomSheet } from '@features/owner-tenants/profile/ChangeRoomSheet';
import type { InviteWizardData } from '@features/owner-tenants/types';
import { ErrorCard } from '@shared/ui/error/ErrorCard';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { Floor } from '@shared/mocks/rooms';
import { useHostelRooms } from '../hooks/useHostelRooms';
import { RoomsReorderPanel } from '../components/RoomsReorderPanel';
import { RoomSheetModal } from '../room-sheet/RoomSheetModal';
import { AddRoomModal, type AddRoomDefaults } from '../add-room/AddRoomModal';
import { AddFloorModal } from '../add-floor/AddFloorModal';
import { EditFloorSheet } from '../edit-floor/EditFloorSheet';
import { BuildingTip } from '../building/BuildingTip';
import { HostelBuilding } from '../building/HostelBuilding';
import { LensChips } from '../building/LensChips';
import { countRooms, floorPlate, roomMatches, stackFloors, type Lens } from '../building/buildingModel';
import { mostCommon, newFloorRoomNumbers, nextRoomNumber, suggestFloorName, suggestRoomDefaults } from '../building/roomSuggestions';
import type { RoomOccupant, RoomWithOccupants } from '../types';

/**
 * The server's reason, not a generic apology.
 *
 * Both delete endpoints refuse for reasons the owner can act on — a tenant
 * still in the room, a live invitation reservation, rooms still on the floor —
 * and those messages are worth more than "something went wrong".
 */
function removalError(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: any } })?.response?.data;
  const message = data?.error?.message ?? data?.error ?? (error as Error)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

const roomLike = (room: RoomWithOccupants) => ({ number: room.number, capacity: room.beds.length, rent: room.rent });

/**
 * Hostel Drill-down → Rooms: the hostel drawn as a building (ADR-199).
 *
 * Owners care who lives where, and recognise tenants by face, so the tab is
 * the building with every tenant's face in their room — floors top to
 * bottom, the lift strip for tall ones — and the three numbers that matter
 * (free beds, overdue, invited) as filters over it. Every add, edit, move and
 * delete of a floor, room or bed is one or two taps from that picture:
 * the roof adds a floor, the "+" under a floor adds a room there, a floor's
 * plate edits it, a room opens its sheet, a free bed invites into it.
 *
 * "Arrange" (ADR-064) still swaps the building for `RoomsReorderPanel`,
 * where floors and rooms are dragged into place and saved explicitly.
 */
export function HostelRoomsPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const layout = useHostelRooms(hostelId ?? '');
  const [search, setSearch] = useState('');
  const [lens, setLens] = useState<Lens | null>(null);
  /**
   * The open room, by id, read from live data — the sheet used to hold the
   * room it was opened with, so a changed bed count or a move didn't show
   * until it was closed and reopened.
   */
  const [roomSheetId, setRoomSheetId] = useState<string | null>(null);
  const [addRoomFloorId, setAddRoomFloorId] = useState<string | null>(null);
  const [addFloorOpen, setAddFloorOpen] = useState(false);
  const [addingFloor, setAddingFloor] = useState(false);
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [invite, setInvite] = useState<Partial<InviteWizardData> | null>(null);
  const [moving, setMoving] = useState<{ occupant: RoomOccupant; room: RoomWithOccupants } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * "Arrange" mode (ADR-064): drag floors and rooms into place, nothing
   * persists until Save. `pendingFloors`/`pendingRoomsByFloor` are a local
   * staging copy, seeded from `layout` when the mode is entered and diffed
   * against it on Save so only floors/rooms that actually moved are written.
   */
  const [reorderMode, setReorderMode] = useState(false);
  const [pendingFloors, setPendingFloors] = useState<Floor[]>([]);
  const [pendingRoomsByFloor, setPendingRoomsByFloor] = useState<Map<string, RoomWithOccupants[]>>(new Map());
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const allRooms = useMemo(() => Array.from(layout.roomsByFloor.values()).flat(), [layout.roomsByFloor]);
  const counts = useMemo(() => countRooms(allRooms), [allRooms]);
  const { stacked } = useMemo(() => stackFloors(layout.floors), [layout.floors]);
  const roomSheetRoom = roomSheetId ? (allRooms.find((r) => r.id === roomSheetId) ?? null) : null;
  const searching = Boolean(search.trim());
  const noMatch = searching && !allRooms.some((room) => roomMatches(room, search));

  const startReorder = () => {
    setPendingFloors([...layout.floors].sort((a, b) => a.order - b.order));
    setPendingRoomsByFloor(new Map(layout.roomsByFloor));
    setReorderMode(true);
  };

  const saveReorder = async () => {
    setIsSavingOrder(true);
    try {
      const tasks: Promise<unknown>[] = [];
      const originalFloorIds = [...layout.floors].sort((a, b) => a.order - b.order).map((f) => f.id);
      const newFloorIds = pendingFloors.map((f) => f.id);
      if (newFloorIds.join() !== originalFloorIds.join()) tasks.push(layout.reorderFloors(newFloorIds));
      for (const [floorId, rooms] of pendingRoomsByFloor) {
        const originalIds = (layout.roomsByFloor.get(floorId) ?? []).map((r) => r.id);
        const newIds = rooms.map((r) => r.id);
        if (newIds.join() !== originalIds.join()) tasks.push(layout.reorderRooms(floorId, newIds));
      }
      await Promise.all(tasks);
      setReorderMode(false);
    } catch {
      stayoToast.error('Could not save the new layout');
    } finally {
      setIsSavingOrder(false);
    }
  };

  /**
   * Deep link from Universal Search: `?room=<id>` opens that room's sheet
   * directly and brings its tile into view (ADR-044). The param is cleared
   * once consumed, so a later back navigation doesn't silently reopen it.
   */
  const deepLinkRoomId = searchParams.get('room');
  useEffect(() => {
    if (!deepLinkRoomId || layout.isLoading) return;
    if (allRooms.some((r) => r.id === deepLinkRoomId)) {
      setRoomSheetId(deepLinkRoomId);
      requestAnimationFrame(() =>
        document.querySelector(`[data-room-id="${CSS.escape(deepLinkRoomId)}"]`)?.scrollIntoView({ block: 'center' }),
      );
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('room');
        return next;
      },
      { replace: true },
    );
  }, [deepLinkRoomId, layout.isLoading, allRooms, setSearchParams]);

  if (!hostelId) return null;

  // ── Suggestions for the add sheets ────────────────────────────────────
  const plateOf = (floorId: string | null) => {
    const floor = layout.floors.find((f) => f.id === floorId);
    return floor ? floorPlate(floor.name) : '1';
  };
  const addRoomTarget = addRoomFloorId ?? stacked[0]?.id ?? '';
  const addRoomDefaults: AddRoomDefaults = (() => {
    const s = suggestRoomDefaults({
      floorRooms: (layout.roomsByFloor.get(addRoomTarget) ?? []).map(roomLike),
      hostelRooms: allRooms.map(roomLike),
      plate: plateOf(addRoomTarget),
    });
    return { floorId: addRoomTarget, roomNo: s.roomNo, capacity: s.capacity, rent: s.rent };
  })();
  const nextAfter = (roomNo: string, floorId: string) =>
    nextRoomNumber(
      [...(layout.roomsByFloor.get(floorId) ?? []).map((r) => r.number), roomNo],
      [...allRooms.map((r) => r.number), roomNo],
      plateOf(floorId),
    );
  const hostelRent = mostCommon(allRooms.map((r) => r.rent).filter((v) => v > 0));

  const openAddRoom = (floorId: string) => {
    if (!floorId) {
      setAddFloorOpen(true);
      return;
    }
    setAddRoomFloorId(floorId);
  };

  const openInvite = (room: RoomWithOccupants) => {
    setRoomSheetId(null);
    setInvite({ hostelId, preferredRoomId: room.id, preferredFloorId: room.floorId, preferredRoomNo: room.number });
  };

  const addFloor = async ({ name, roomCount, bedsPerRoom, rent }: { name: string; roomCount?: number; bedsPerRoom?: number; rent?: number }) => {
    setAddingFloor(true);
    try {
      const nextOrder = stacked.reduce((max, f) => Math.max(max, f.order), -1) + 1;
      const floor = (await layout.createFloor({ name, sort_order: nextOrder })) as { id: string };
      let made = 0;
      if (roomCount && bedsPerRoom) {
        const numbers = newFloorRoomNumbers(floorPlate(name), roomCount, allRooms.map((r) => r.number));
        for (const room_no of numbers) {
          await layout.createRoom({ room_no, floor_id: floor.id, capacity: bedsPerRoom, base_rent: rent });
          made++;
        }
      }
      setAddFloorOpen(false);
      stayoToast.success(made ? `${name} added with ${made} room${made === 1 ? '' : 's'}.` : `${name} added.`);
    } catch (error) {
      stayoToast.error(removalError(error, 'Could not add the floor.'));
    } finally {
      setAddingFloor(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <LensChips counts={counts} lens={lens} onChange={setLens} />

      {reorderMode ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReorderMode(false)}
            disabled={isSavingOrder}
            className="flex-none rounded-[10px] border border-border px-3.5 py-2.5 font-display text-xs font-bold text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <span className="flex-1 text-center text-[11.5px] text-muted-foreground">Drag ⠿ to reorder floors and rooms</span>
          <button
            type="button"
            onClick={saveReorder}
            disabled={isSavingOrder}
            className="flex-none rounded-[10px] bg-primary px-3.5 py-2.5 font-display text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            {isSavingOrder ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[11px] border border-border bg-card px-3 py-2.5 focus-within:border-primary">
              <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.6} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search room or tenant…"
                aria-label="Search room or tenant"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground focus:outline-none"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="-m-1 flex h-6 w-6 flex-none items-center justify-center rounded-md text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={() => openAddRoom(stacked[0]?.id ?? '')}
              className="flex-none rounded-[10px] bg-foreground px-3.5 py-2.5 font-display text-xs font-bold text-background"
            >
              + Add
            </button>
            <button
              type="button"
              onClick={startReorder}
              disabled={layout.floors.length === 0}
              className="flex flex-none items-center gap-1.5 rounded-[10px] border border-border px-3 py-2.5 font-display text-xs font-bold text-foreground disabled:opacity-50"
            >
              <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Arrange
            </button>
          </div>
          {noMatch && <p className="px-1 text-[12px] text-muted-foreground">No room or tenant matches “{search.trim()}”.</p>}
        </div>
      )}

      {layout.isError ? (
        <ErrorCard compact error={layout.error} onRetry={() => layout.refetch()} />
      ) : reorderMode ? (
        <RoomsReorderPanel
          floors={pendingFloors}
          roomsByFloor={pendingRoomsByFloor}
          onFloorsChange={setPendingFloors}
          onRoomsChange={(floorId, rooms) => setPendingRoomsByFloor((prev) => new Map(prev).set(floorId, rooms))}
        />
      ) : (
        <>
          {!layout.isLoading && layout.floors.length > 0 && <BuildingTip />}
          <HostelBuilding
            floors={layout.floors}
            roomsByFloor={layout.roomsByFloor}
            lens={lens}
            query={search}
            isLoading={layout.isLoading}
            onOpenRoom={(room) => setRoomSheetId(room.id)}
            onAddRoom={openAddRoom}
            onEditFloor={setEditingFloorId}
            onAddFloor={() => setAddFloorOpen(true)}
          />
        </>
      )}

      <RoomSheetModal
        open={roomSheetRoom != null}
        room={roomSheetRoom}
        floor={layout.floors.find((f) => f.id === roomSheetRoom?.floorId)}
        floors={layout.floors.filter((f) => f.id !== '__unassigned')}
        onClose={() => setRoomSheetId(null)}
        onInvite={() => roomSheetRoom && openInvite(roomSheetRoom)}
        onMoveTenant={(occupant) => roomSheetRoom && setMoving({ occupant, room: roomSheetRoom })}
        isSaving={layout.isUpdatingRoom}
        onSaveDetails={async (data) => {
          if (!roomSheetRoom) return;
          await layout.updateRoom({ roomId: roomSheetRoom.id, data });
        }}
        isDeleting={layout.isDeletingRoom}
        onDelete={async () => {
          if (!roomSheetRoom) return;
          const label = roomSheetRoom.number;
          try {
            await layout.deleteRoom(roomSheetRoom.id);
            setRoomSheetId(null);
            stayoToast.success(`Room ${label} deleted.`);
          } catch (error) {
            stayoToast.error(removalError(error, 'Could not delete this room.'));
          }
        }}
      />

      <AddRoomModal
        open={addRoomFloorId != null}
        floors={stacked}
        defaults={addRoomDefaults}
        nextAfter={nextAfter}
        isSubmitting={layout.isCreatingRoom}
        onClose={() => setAddRoomFloorId(null)}
        onAddFloor={() => {
          setAddRoomFloorId(null);
          setAddFloorOpen(true);
        }}
        onSubmit={async (data) => {
          try {
            await layout.createRoom(data);
          } catch (error) {
            stayoToast.error(removalError(error, 'Could not add this room.'));
            throw error;
          }
        }}
      />

      {(() => {
        // Counted from every room on the floor, not the search-filtered view
        // — "delete this floor" must not appear because a search hid its rooms.
        const floor = layout.floors.find((f) => f.id === editingFloorId) ?? null;
        const rooms = floor ? (layout.roomsByFloor.get(floor.id) ?? []) : [];
        const floorCounts = countRooms(rooms);
        return (
          <EditFloorSheet
            floor={floor}
            summary={{ rooms: rooms.length, beds: floorCounts.beds, vacantBeds: floorCounts.free }}
            otherNames={layout.floors.filter((f) => f.id !== editingFloorId).map((f) => f.name)}
            saving={layout.isRenamingFloor}
            deleting={layout.isDeletingFloor}
            onClose={() => setEditingFloorId(null)}
            onAddRoom={() => {
              setEditingFloorId(null);
              if (floor) openAddRoom(floor.id);
            }}
            onRename={async (name) => {
              await layout.renameFloor(floor!.id, name);
              stayoToast.success(`Renamed to ${name}.`);
              setEditingFloorId(null);
            }}
            onDelete={async () => {
              try {
                await layout.deleteFloor(floor!.id);
                stayoToast.success(`${floor!.name} deleted.`);
                setEditingFloorId(null);
              } catch (error) {
                stayoToast.error(removalError(error, 'Could not delete this floor.'));
              }
            }}
          />
        );
      })()}

      <AddFloorModal
        open={addFloorOpen}
        suggestedName={suggestFloorName(stacked.map((f) => f.name))}
        defaultRent={hostelRent}
        roomNumbersFor={(name, count) => newFloorRoomNumbers(floorPlate(name), count, allRooms.map((r) => r.number))}
        isSubmitting={addingFloor}
        onClose={() => setAddFloorOpen(false)}
        onSubmit={addFloor}
      />

      <InviteTenantWizard open={invite != null} initialData={invite ?? undefined} onClose={() => setInvite(null)} />

      {moving && (
        <ChangeRoomSheet
          open
          onClose={() => setMoving(null)}
          tenantId={moving.occupant.tenant_id}
          tenantName={moving.occupant.name}
          hostelId={hostelId}
          currentRoomId={moving.room.id}
          currentRoomNo={moving.room.number}
          currentRent={moving.occupant.rent}
        />
      )}
    </div>
  );
}
