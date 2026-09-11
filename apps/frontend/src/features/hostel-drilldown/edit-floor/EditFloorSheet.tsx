import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import type { Floor } from '@shared/mocks/rooms';
import { canDeleteFloor } from '../propertyRemoval';
import { FLOOR_NAME_MAX, describeFloor, floorNameProblem, isRename, tidyFloorName, type FloorSummary } from '../floorName';

interface EditFloorSheetProps {
  floor: Floor | null;
  summary: FloorSummary;
  /** The hostel's other floor names, for the duplicate check. */
  otherNames: string[];
  hostelStatus?: string | null;
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/**
 * One place for everything about a floor.
 *
 * Floors could be added, reordered and deleted, but never renamed — an owner
 * who typed "Floor 1" when they meant "Ground" had to delete the floor, which
 * the app refuses while it has rooms, so the typo was permanent. Rename, the
 * floor's summary and delete now live together here, opened from the pencil
 * on the floor's header, instead of delete sitting alone at the foot of an
 * expanded list.
 *
 * The name is checked while typing with the same rule the server applies, so
 * a clash shows before Save rather than after it; the server's answer still
 * wins, and is shown in place if it disagrees.
 */
export function EditFloorSheet({
  floor,
  summary,
  otherNames,
  hostelStatus,
  saving,
  deleting,
  onClose,
  onRename,
  onDelete,
}: EditFloorSheetProps) {
  const [name, setName] = useState(floor?.name ?? '');
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A different floor, or the same one reopened, starts from its saved name.
  useEffect(() => {
    setName(floor?.name ?? '');
    setServerError(null);
    setConfirmingDelete(false);
  }, [floor?.id, floor?.name]);

  if (!floor) return null;

  const problem = floorNameProblem(name, otherNames);
  const changed = isRename(floor.name, name);
  const canSave = changed && !problem && !saving;
  const removal = canDeleteFloor({ roomCount: summary.rooms, hostelStatus: hostelStatus ?? undefined });
  // Shown once the owner has typed something, not the moment the sheet opens.
  const showProblem = changed && problem;

  const save = async () => {
    if (!canSave) return;
    setServerError(null);
    try {
      await onRename(tidyFloorName(name));
    } catch (error: any) {
      setServerError(error?.response?.data?.error?.message || error?.message || 'Could not rename this floor.');
    }
  };

  return (
    <BottomSheet
      open={Boolean(floor)}
      onOpenChange={(v) => !v && onClose()}
      title="Edit floor"
      footer={
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void save()}
          className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving…' : changed ? 'Save name' : 'No changes'}
        </button>
      }
    >
      <div className="flex flex-col gap-4.5">
        <label className="block">
          <span className={labelStyle}>Floor name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setServerError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            maxLength={FLOOR_NAME_MAX + 10}
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={Boolean(showProblem || serverError)}
            className={`w-full rounded-[11px] border-[1.5px] bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:outline-none ${
              showProblem || serverError ? 'border-destructive' : 'border-primary'
            }`}
          />
          <span
            className={`mt-1.5 block text-[11.5px] font-medium ${
              showProblem || serverError ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {serverError || showProblem || 'Shown on the Rooms tab, on each room, and in your import sheet.'}
          </span>
        </label>

        <div className="rounded-2xl border border-border bg-muted/40 px-3.5 py-3">
          <p className="font-display text-[13px] font-bold text-foreground">{describeFloor(summary)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            To change the order of floors, use Reorder on the Rooms tab.
          </p>
        </div>

        <div className="border-t border-border pt-3.5">
          {removal.ok ? (
            confirmingDelete ? (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1 rounded-xl border border-border px-4 py-2.5 font-display text-[12.5px] font-bold text-foreground"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void onDelete()}
                  className="flex-1 rounded-xl bg-destructive px-4 py-2.5 font-display text-[12.5px] font-bold text-destructive-foreground disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : `Delete ${floor.name}`}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex min-h-[38px] items-center gap-2 rounded-lg px-2 font-display text-[12.5px] font-bold text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                Delete this floor
              </button>
            )
          ) : (
            // Said, not hidden: an owner looking for delete should learn why
            // it isn't offered, not conclude there is no such thing.
            <p className="flex items-start gap-2 px-1 text-[12px] font-medium text-muted-foreground">
              <Trash2 className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={2} />
              {removal.reason}
            </p>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
