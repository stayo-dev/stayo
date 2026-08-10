import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { InviteTenantWizard } from '@features/owner-tenants/invite/InviteTenantWizard';
import { ErrorCard } from '@shared/ui/error/ErrorCard';
import { useHostelRooms } from '../hooks/useHostelRooms';
import { FloorGroup } from '../components/FloorGroup';
import { RoomSheetModal } from '../room-sheet/RoomSheetModal';
import { AddRoomModal } from '../add-room/AddRoomModal';
import { AddFloorModal } from '../add-floor/AddFloorModal';
import type { RoomWithOccupants } from '../types';

/** Hostel Drill-down → Rooms sub-tab: floors as a collapsible list (Food
 * Library accordion pattern) — tap a floor to reveal its rooms, drag a room's
 * handle to reorder within that floor. Real data via `useHostelRooms`. */
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

      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-[11px] border border-border bg-card px-3 py-2.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search room…" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground focus:outline-none" />
        </div>
        <button type="button" onClick={() => setAddRoomOpen(true)} className="flex-none rounded-[10px] bg-foreground px-3.5 py-2.5 font-display text-xs font-bold text-background">
          + Add
        </button>
      </div>

      {layout.isError ? (
        <ErrorCard compact error={layout.error} onRetry={() => layout.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          {layout.floors.map((floor) => {
            const rooms = (layout.roomsByFloor.get(floor.id) ?? []).filter(matchesSearch);
            if (rooms.length === 0) return null;
            return (
              <FloorGroup
                key={floor.id}
                floor={floor}
                rooms={rooms}
                expanded={searching || expandedFloorIds.has(floor.id)}
                onToggle={() => toggleFloor(floor.id)}
                onOpenRoom={setRoomSheetRoom}
                onAssignRoom={() => setInviteOpen(true)}
                onReorder={(order) => layout.reorderRooms(floor.id, order)}
                reorderDisabled={searching}
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
