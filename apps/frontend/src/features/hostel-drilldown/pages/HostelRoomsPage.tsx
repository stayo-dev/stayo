import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { InviteTenantWizard } from '@features/owner-tenants/invite/InviteTenantWizard';
import { ErrorCard } from '@shared/ui/error/ErrorCard';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { Floor } from '@shared/mocks/rooms';
import { useHostelRooms } from '../hooks/useHostelRooms';
import { FloorGroup } from '../components/FloorGroup';
import { RoomsReorderPanel } from '../components/RoomsReorderPanel';
import { RoomSheetModal } from '../room-sheet/RoomSheetModal';
import { AddRoomModal } from '../add-room/AddRoomModal';
import { AddFloorModal } from '../add-floor/AddFloorModal';
import type { RoomWithOccupants } from '../types';

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

/** Hostel Drill-down → Rooms sub-tab: floors as a collapsible list (Food
 * Library accordion pattern) — tap a floor to reveal its rooms. A dedicated
 * "Reorder" mode (ADR-064) swaps this browsing view for `RoomsReorderPanel`,
 * where floors and rooms can be dragged into place and saved explicitly.
 * Real data via `useHostelRooms`. */
export function HostelRoomsPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const layout = useHostelRooms(hostelId ?? '');
  const [search, setSearch] = useState('');
  const [expandedFloorIds, setExpandedFloorIds] = useState<Set<string>>(new Set());
  const [roomSheetRoom, setRoomSheetRoom] = useState<RoomWithOccupants | null>(null);
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [addFloorOpen, setAddFloorOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * "Reorder" mode (ADR-064): drag floors and rooms into place, nothing
   * persists until Save. `pendingFloors`/`pendingRoomsByFloor` are a local
   * staging copy, seeded from `layout` when the mode is entered and diffed
   * against it on Save so only floors/rooms that actually moved are written.
   */
  const [reorderMode, setReorderMode] = useState(false);
  const [pendingFloors, setPendingFloors] = useState<Floor[]>([]);
  const [pendingRoomsByFloor, setPendingRoomsByFloor] = useState<Map<string, RoomWithOccupants[]>>(new Map());
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const startReorder = () => {
    setPendingFloors([...layout.floors].sort((a, b) => a.order - b.order));
    setPendingRoomsByFloor(new Map(layout.roomsByFloor));
    setReorderMode(true);
  };

  const cancelReorder = () => setReorderMode(false);

  const saveReorder = async () => {
    setIsSavingOrder(true);
    try {
      const tasks: Promise<unknown>[] = [];

      const originalFloorIds = [...layout.floors].sort((a, b) => a.order - b.order).map((f) => f.id);
      const newFloorIds = pendingFloors.map((f) => f.id);
      if (newFloorIds.join() !== originalFloorIds.join()) {
        tasks.push(layout.reorderFloors(newFloorIds));
      }

      for (const [floorId, rooms] of pendingRoomsByFloor) {
        const originalIds = (layout.roomsByFloor.get(floorId) ?? []).map((r) => r.id);
        const newIds = rooms.map((r) => r.id);
        if (newIds.join() !== originalIds.join()) {
          tasks.push(layout.reorderRooms(floorId, newIds));
        }
      }

      await Promise.all(tasks);
      setReorderMode(false);
    } catch {
      stayoToast.error('Could not save the new layout');
    } finally {
      setIsSavingOrder(false);
    }
  };

  const toggleFloor = (floorId: string) => {
    setExpandedFloorIds((prev) => {
      const next = new Set(prev);
      if (next.has(floorId)) next.delete(floorId);
      else next.add(floorId);
      return next;
    });
  };

  /**
   * Deep link from Universal Search: `?room=<id>` opens that room's sheet
   * directly, so a room result lands on the room instead of a list to hunt
   * through (ADR-044). The param is cleared once consumed, so a later back
   * navigation doesn't silently reopen the sheet. Also expands that room's
   * floor, since floors are collapsed by default.
   */
  const deepLinkRoomId = searchParams.get('room');
  useEffect(() => {
    if (!deepLinkRoomId || layout.isLoading) return;
    for (const [floorId, rooms] of layout.roomsByFloor) {
      const target = rooms.find((r) => r.id === deepLinkRoomId);
      if (target) {
        setRoomSheetRoom(target);
        setExpandedFloorIds((prev) => new Set(prev).add(floorId));
        break;
      }
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('room');
        return next;
      },
      { replace: true },
    );
  }, [deepLinkRoomId, layout.isLoading, layout.roomsByFloor, setSearchParams]);

  if (!hostelId) return null;
  const stats = layout.stats;
  const searching = Boolean(search.trim());

  const matchesSearch = (room: RoomWithOccupants) => !searching || room.number.toLowerCase().includes(search.trim().toLowerCase());

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex gap-2">
        <div className="flex-1 rounded-2xl border border-border bg-card p-2.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="font-display text-base font-extrabold tabular-nums text-foreground">
            {stats.bedsOccupied}/{stats.bedsTotal}
          </div>
          <div className="text-[10.5px] text-muted-foreground">beds</div>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-card p-2.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="font-display text-base font-extrabold tabular-nums text-foreground">{stats.vacantRooms}</div>
          <div className="text-[10.5px] text-muted-foreground">vacant rooms</div>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-card p-2.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="font-display text-base font-extrabold tabular-nums text-foreground">{stats.reservedRooms}</div>
          <div className="text-[10.5px] text-muted-foreground">reserved</div>
        </div>
      </div>

      {reorderMode ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={cancelReorder}
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
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-[11px] border border-border bg-card px-3 py-2.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search room…" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground focus:outline-none" />
          </div>
          <button type="button" onClick={() => setAddRoomOpen(true)} className="flex-none rounded-[10px] bg-foreground px-3.5 py-2.5 font-display text-xs font-bold text-background">
            + Add
          </button>
          <button
            type="button"
            onClick={startReorder}
            disabled={layout.floors.length === 0}
            className="flex-none rounded-[10px] border border-border px-3.5 py-2.5 font-display text-xs font-bold text-foreground disabled:opacity-50"
          >
            Reorder
          </button>
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
        <div className="flex flex-col gap-3">
          {layout.floors.map((floor) => {
            const all = layout.roomsByFloor.get(floor.id) ?? [];
            const rooms = all.filter(matchesSearch);
            // While searching, a floor with no match is noise. Otherwise an
            // empty floor must still render: it used to return null, which
            // made a deletable floor invisible and therefore undeletable.
            if (searching && rooms.length === 0) return null;
            return (
              <FloorGroup
                key={floor.id}
                floor={floor}
                rooms={rooms}
                expanded={searching || expandedFloorIds.has(floor.id)}
                onToggle={() => toggleFloor(floor.id)}
                onOpenRoom={setRoomSheetRoom}
                onAssignRoom={() => setInviteOpen(true)}
                isDeleting={layout.isDeletingFloor}
                onDelete={async () => {
                  try {
                    await layout.deleteFloor(floor.id);
                    stayoToast.success(`${floor.name} deleted.`);
                  } catch (error) {
                    stayoToast.error(removalError(error, 'Could not delete this floor.'));
                  }
                }}
              />
            );
          })}
          {!layout.isLoading && layout.floors.length === 0 && (
            <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">No floors yet — add one to get started.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 px-1 py-1">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-success" /> occupied
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-warning" /> reserved
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full border-[1.5px] border-border" /> vacant
        </span>
      </div>

      <RoomSheetModal
        open={roomSheetRoom != null}
        room={roomSheetRoom}
        floor={layout.floors.find((f) => f.id === roomSheetRoom?.floorId)}
        floors={layout.floors}
        onClose={() => setRoomSheetRoom(null)}
        onAssign={() => {
          setRoomSheetRoom(null);
          setInviteOpen(true);
        }}
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
            setRoomSheetRoom(null);
            stayoToast.success(`Room ${label} deleted.`);
          } catch (error) {
            stayoToast.error(removalError(error, 'Could not delete this room.'));
          }
        }}
      />
      <AddRoomModal
        open={addRoomOpen}
        floors={layout.floors}
        isSubmitting={layout.isCreatingRoom}
        onClose={() => setAddRoomOpen(false)}
        onAddFloor={() => setAddFloorOpen(true)}
        onSubmit={async (data) => {
          await layout.createRoom(data);
          setAddRoomOpen(false);
        }}
      />
      <AddFloorModal
        open={addFloorOpen}
        nextFloorLabel={`${layout.floors.length + 1}th Floor`}
        isSubmitting={layout.isCreatingFloor || layout.isCreatingRoom}
        onClose={() => setAddFloorOpen(false)}
        onSubmit={async ({ name, roomCount, bedsPerRoom }) => {
          const floor = await layout.createFloor({ name, sort_order: layout.floors.length });
          if (roomCount && bedsPerRoom) {
            for (let i = 1; i <= roomCount; i++) {
              await layout.createRoom({
                room_no: `${name.replace(/\s+/g, '').slice(0, 4)}-${String(i).padStart(2, '0')}`,
                floor_id: (floor as { id: string }).id,
                capacity: bedsPerRoom,
              });
            }
          }
          setAddFloorOpen(false);
        }}
      />
      <InviteTenantWizard open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
