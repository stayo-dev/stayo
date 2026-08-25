import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { getInitials } from '@features/tenants/utils/normalize';
import { Trash2 } from 'lucide-react';
import { canDeleteRoom } from '../propertyRemoval';
import type { Floor, RoomWithOccupants } from '../types';

interface RoomSheetModalProps {
  open: boolean;
  room: RoomWithOccupants | null;
  floor: Floor | undefined;
  /** All floors on this hostel, for the "move to floor" reassignment select. */
  floors: Floor[];
  onClose: () => void;
  onAssign: () => void;
  onSaveDetails: (data: { room_no: string; base_rent: number; floor_id?: string }) => Promise<void>;
  isSaving?: boolean;
  /**
   * Delete this room for good. `DELETE /api/rooms/:id` is a real delete, not
   * an archive — and it had no caller anywhere in the app until 2026-08-24,
   * so a room added by mistake was permanent.
   */
  onDelete?: () => Promise<void>;
  isDeleting?: boolean;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/** Tap an occupied/reserved room → rent/dues tiles + resident list + assign vacant beds, per Stayo App.dc.html. Real occupant data via `useHostelRooms`. "Edit room details" is a real `PATCH /rooms/:id` (number + rent + floor) — bed count isn't editable here since it can't safely go below occupied beds. Moving a room to a different floor happens here rather than by drag, since floors collapse independently (Rooms tab accordion) and can't both be open as drag targets at once. */
export function RoomSheetModal({
  open,
  room,
  floor,
  floors,
  onClose,
  onAssign,
  onSaveDetails,
  isSaving,
  onDelete,
  isDeleting,
}: RoomSheetModalProps) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  /** Two taps to delete: the second one replaces the first in place. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [number, setNumber] = useState('');
  const [rent, setRent] = useState('');
  const [floorId, setFloorId] = useState('');
  // Per room, never reviewed, never public — see the tenant Room spec §4.
  const [wifiName, setWifiName] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  /**
   * What the room is like to live in (migration 073). Two tape measurements
   * and three storage facts — the listing turns them into floor area per bed,
   * which is the number that actually compares one hostel to another.
   */
  const [lengthFt, setLengthFt] = useState('');
  const [widthFt, setWidthFt] = useState('');
  const [cupboard, setCupboard] = useState<'yes' | 'shared' | ''>('');
  const [underBed, setUnderBed] = useState('');
  const [desk, setDesk] = useState('');
  const [windows, setWindows] = useState('');

  useEffect(() => {
    if (open) {
      setEditing(false);
      setConfirmingDelete(false);
    }
  }, [open]);

  useEffect(() => {
    if (room) {
      setNumber(room.number);
      setRent(String(room.rent));
      setFloorId(room.floorId);
      setWifiName((room as any)?.wifiName ?? (room as any)?.wifi_name ?? '');
      setWifiPassword((room as any)?.wifiPassword ?? (room as any)?.wifi_password ?? '');
      const space = (room as any).space ?? {};
      setLengthFt(space.length_ft == null ? '' : String(space.length_ft));
      setWidthFt(space.width_ft == null ? '' : String(space.width_ft));
      setCupboard(space.cupboard_per_bed == null ? '' : space.cupboard_per_bed ? 'yes' : 'shared');
      setUnderBed(space.under_bed_storage ?? '');
      setDesk(space.study_desk ?? '');
      setWindows(space.windows == null ? '' : String(space.windows));
    }
  }, [room]);

  if (!room) return null;

  const handleSave = async () => {
    if (!number.trim()) {
      stayoToast.error('Room number is required');
      return;
    }
    try {
      await onSaveDetails({
        room_no: number.trim(),
        base_rent: Number(rent) || 0,
        // Blank clears it rather than storing "", so the tenant screen falls
        // back to "Ask the front desk" instead of showing an empty password.
        wifi_name: wifiName.trim() || null,
        wifi_password: wifiPassword.trim() || null,
        ...(floorId && floorId !== room.floorId ? { floor_id: floorId } : {}),
        // Empty means "not measured", which the listing shows as nothing at
        // all rather than as a zero.
        length_ft: lengthFt === '' ? null : Number(lengthFt),
        width_ft: widthFt === '' ? null : Number(widthFt),
        cupboard_per_bed: cupboard === '' ? null : cupboard === 'yes',
        under_bed_storage: underBed === '' ? null : underBed,
        study_desk: desk === '' ? null : desk,
        windows: windows === '' ? null : Number(windows),
      } as any);
      stayoToast.success('Room details updated');
      setEditing(false);
    } catch {
      stayoToast.error('Could not update room details');
    }
  };

  const occupied = room.beds.filter((b) => b.status === 'occupied').length;
  const vacant = room.beds.filter((b) => b.status === 'vacant').length;
  const reserved = room.beds.filter((b) => b.status === 'reserved').length;
  const deleteBlocker = canDeleteRoom({ occupiedBeds: occupied, reservedBeds: reserved }).reason;
  const residents = room.occupants;
  const pendingDues = residents.reduce((sum, t) => sum + t.pending_dues, 0);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex flex-col">
          <span>Room {room.number}</span>
          <span className="text-[11.5px] font-normal text-muted-foreground">
            {floor?.name} · {occupied}/{room.beds.length} beds occupied
          </span>
        </span>
      }
      footer={
        editing ? (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-xl border border-border px-5 py-3 font-display text-[13px] font-bold text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="flex-1 rounded-xl bg-primary py-3 text-center font-display text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full rounded-xl border border-border py-3 text-center font-display text-[13px] font-bold text-foreground"
          >
            ✎ Edit room details
          </button>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className={labelStyle}>Room name / number</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              className="w-full rounded-[11px] border-[1.5px] border-primary bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none"
            />
          </label>
          {/*
            Wi-Fi, per room.

            Every one of the 70 rooms in production had this blank when it was
            added, because there was no screen on which to set it — so every
            tenant's Room tab read "Ask the front desk". It is deliberately not
            an amenity: amenities are reviewed and published, and a password
            belongs on neither a review queue nor a public listing. Only this
            room's tenants ever see it.
          */}
          <div className="rounded-[13px] border border-border bg-card p-3.5">
            <p className="font-display text-[13px] font-bold text-foreground">Wi-Fi</p>
            <p className="mt-0.5 text-[11.5px] leading-[1.5] text-muted-foreground">
              Shown only to the tenants in this room, on their Room tab. Never appears on your public
              listing. Leave blank and they are told to ask at the front desk.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <label className="block">
                <span className={labelStyle}>Network name</span>
                <input
                  value={wifiName}
                  onChange={(e) => setWifiName(e.target.value)}
                  placeholder="e.g. Hostel_5G"
                  className="w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:outline-none"
                />
              </label>
              <label className="block">
                <span className={labelStyle}>Password</span>
                <input
                  value={wifiPassword}
                  onChange={(e) => setWifiPassword(e.target.value)}
                  placeholder="Leave blank if there is none"
                  className="w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:outline-none"
                />
              </label>
            </div>
          </div>

          {/*
            The space block. Tenants ask "how big is it" and "where do my
            things go" more than anything after the rent, and no listing
            answers either — the app has never had anywhere to record it.
          */}
          <div className="rounded-[13px] border border-border bg-card p-3.5">
            <p className="font-display text-[13px] font-bold text-foreground">The space</p>
            <p className="mt-0.5 text-[11.5px] leading-[1.5] text-muted-foreground">
              Measure once with a tape. Your listing turns this into floor space per bed — the
              figure people actually compare hostels on. Leave blank if you have not measured.
            </p>

            <div className="mt-3 flex gap-2">
              <label className="block flex-1">
                <span className={labelStyle}>Length (ft)</span>
                <input
                  value={lengthFt}
                  onChange={(e) => setLengthFt(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  placeholder="14"
                  className="w-full rounded-[11px] border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none"
                />
              </label>
              <label className="block flex-1">
                <span className={labelStyle}>Width (ft)</span>
                <input
                  value={widthFt}
                  onChange={(e) => setWidthFt(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  placeholder="10"
                  className="w-full rounded-[11px] border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none"
                />
              </label>
              <label className="block w-[86px]">
                <span className={labelStyle}>Windows</span>
                <input
                  value={windows}
                  onChange={(e) => setWindows(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                  placeholder="2"
                  className="w-full rounded-[11px] border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none"
                />
              </label>
            </div>

            <label className="mt-3 block">
              <span className={labelStyle}>Cupboards</span>
              <select
                value={cupboard}
                onChange={(e) => setCupboard(e.target.value as 'yes' | 'shared' | '')}
                className="w-full rounded-[11px] border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none"
              >
                <option value="">Not recorded</option>
                <option value="yes">One lockable cupboard per person</option>
                <option value="shared">Shared cupboard space</option>
              </select>
            </label>

            <label className="mt-2.5 block">
              <span className={labelStyle}>Under-bed storage</span>
              <select
                value={underBed}
                onChange={(e) => setUnderBed(e.target.value)}
                className="w-full rounded-[11px] border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none"
              >
                <option value="">Not recorded</option>
                <option value="LARGE_SUITCASE">A large suitcase fits</option>
                <option value="CABIN_BAG">A cabin bag fits</option>
                <option value="NONE">Nothing fits under the bed</option>
              </select>
            </label>

            <label className="mt-2.5 block">
              <span className={labelStyle}>Study desk</span>
              <select
                value={desk}
                onChange={(e) => setDesk(e.target.value)}
                className="w-full rounded-[11px] border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none"
              >
                <option value="">Not recorded</option>
                <option value="PER_BED">A desk for every bed</option>
                <option value="SHARED">One shared table</option>
                <option value="NONE">No desk</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className={labelStyle}>Monthly rent (per bed)</span>
            <div className="flex items-center rounded-[11px] border border-border bg-card px-3.5">
              <span className="text-sm font-semibold text-muted-foreground">₹</span>
              <input
                value={rent}
                onChange={(e) => setRent(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm font-semibold text-foreground focus:outline-none"
              />
            </div>
          </label>
          {floors.length > 1 && (
            <label className="block">
              <span className={labelStyle}>Floor</span>
              <select
                value={floorId}
                onChange={(e) => setFloorId(e.target.value)}
                className="w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none"
              >
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-[11px] text-muted-foreground">Bed count can't be changed here — it can't safely go below the {occupied} bed{occupied === 1 ? '' : 's'} currently occupied.</p>

          {/* Deleting lives inside edit mode, behind two taps, and states its
              own reason when it can't be done — the backend refuses an
              occupied or reserved room, so the owner should not have to
              discover that by pressing. */}
          {onDelete && (
            <div className="mt-1 border-t border-border pt-4">
              {deleteBlocker ? (
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Can&apos;t delete this room. </span>
                  {deleteBlocker}
                </p>
              ) : confirmingDelete ? (
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="flex-1 rounded-xl border border-border px-4 py-3 font-display text-[13px] font-bold text-foreground"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => void onDelete()}
                    className="flex-1 rounded-xl bg-destructive px-4 py-3 font-display text-[13px] font-bold text-destructive-foreground disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting…' : `Delete room ${room.number}`}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-destructive/40 px-4 font-display text-[13px] font-bold text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                  Delete this room
                </button>
              )}
              {!deleteBlocker && confirmingDelete && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  This one is permanent — unlike removing a hostel, the room is not kept on file.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2.5">
            <div className="flex-1 rounded-2xl border border-border bg-card p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Monthly rent</div>
              <div className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-foreground">₹{room.rent.toLocaleString('en-IN')}</div>
            </div>
            <div className="flex-1 rounded-2xl border border-border bg-card p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Pending dues</div>
              <div className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-destructive">₹{pendingDues.toLocaleString('en-IN')}</div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Current residents</span>
              <span className="text-[10.5px] font-semibold text-primary">{vacant} beds available</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {residents.length === 0 && (
                <p className="p-4 text-center text-[12.5px] text-muted-foreground">No active tenants</p>
              )}
              {residents.map((t) => (
                <button
                  key={t.tenant_id}
                  type="button"
                  onClick={() => navigate(`/owner/tenants/${t.tenant_id}`)}
                  className="flex w-full items-center gap-3 border-b border-border/60 p-3.5 text-left last:border-none"
                >
                  <span className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-full bg-foreground font-display text-xs font-bold text-background">
                    {getInitials(t.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[13.5px] font-bold text-foreground">{t.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">₹{t.rent.toLocaleString('en-IN')}/mo</div>
                  </div>
                  {t.pending_dues > 0 ? (
                    <div className="flex flex-none flex-col items-end gap-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-warning">Due</span>
                      <span className="font-display text-[11.5px] font-bold tabular-nums text-destructive">₹{t.pending_dues.toLocaleString('en-IN')}</span>
                    </div>
                  ) : (
                    <span className="flex-none text-muted-foreground">›</span>
                  )}
                </button>
              ))}
              {vacant > 0 && (
                <button
                  type="button"
                  onClick={onAssign}
                  className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 bg-muted/50 p-3 font-display text-[12.5px] font-bold text-primary"
                >
                  + Assign {vacant} vacant bed{vacant > 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
