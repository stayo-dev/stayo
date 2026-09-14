import { useState } from 'react';
import { Building2, X } from 'lucide-react';

const KEY = 'stayo.rooms.buildingTip.v1';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * A one-time explanation of the building, for an owner seeing it for the
 * first time. Remembered per browser only — it is a convenience, and showing
 * it once more on a new phone costs one tap.
 */
export function BuildingTip() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* private mode or blocked storage — it just shows again next time */
    }
  };

  return (
    <div className="flex gap-2.5 rounded-2xl border border-primary/20 bg-primary/[0.06] p-3 text-[12px] leading-[1.5] text-foreground">
      <Building2 className="mt-0.5 h-4 w-4 flex-none text-primary" strokeWidth={2} aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <b className="font-display font-bold">This is your hostel, floor by floor.</b> Tap a room to see who lives there, invite someone into a
        free bed, or edit the room. Tap a floor number to rename or remove the floor, and the dashed{' '}
        <span className="font-bold text-primary">+</span> under it to add a room.
      </p>
      <button type="button" onClick={dismiss} aria-label="Got it, hide this tip" className="-m-1 flex h-7 w-7 flex-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
        <X className="h-3.5 w-3.5" strokeWidth={2.2} />
      </button>
    </div>
  );
}
