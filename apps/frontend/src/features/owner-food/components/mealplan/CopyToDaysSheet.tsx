import { useState } from 'react';
import { Check } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { DAY_ORDER, type DayKey } from '../../weekGrid';

const DAY_LABEL: Record<DayKey, string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday',
  FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
};

interface CopyToDaysSheetProps {
  open: boolean;
  onClose: () => void;
  /** The source cell's own day — excluded from the picker, copying a cell onto itself is a no-op with no meaning here. */
  sourceDay: DayKey;
  onConfirm: (targetDays: DayKey[]) => void;
}

/**
 * "Copy to days" / "Copy meal" picker — collapsed into one control (ADR-121):
 * a single day selected is exactly what "copy meal" would have meant, so
 * there's no separate action or extra state for it.
 */
export function CopyToDaysSheet({ open, onClose, sourceDay, onConfirm }: CopyToDaysSheetProps) {
  const [selected, setSelected] = useState<DayKey[]>([]);

  const toggle = (day: DayKey) => {
    setSelected((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const confirm = () => {
    if (selected.length === 0) return;
    onConfirm(selected);
    setSelected([]);
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSelected([]);
          onClose();
        }
      }}
      title="Copy to days"
      footer={
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={confirm}
          className="min-h-[44px] w-full rounded-xl bg-primary py-3 text-center font-display text-[13.5px] font-bold text-primary-foreground disabled:opacity-40"
        >
          {selected.length === 0 ? 'Choose at least one day' : `Copy to ${selected.length} ${selected.length === 1 ? 'day' : 'days'}`}
        </button>
      }
    >
      <div className="flex flex-col gap-1.5">
        {DAY_ORDER.filter((day) => day !== sourceDay).map((day) => {
          const checked = selected.includes(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              className="flex min-h-[44px] items-center justify-between rounded-xl border border-border px-3.5 py-2.5"
            >
              <span className="text-[13.5px] font-semibold text-foreground">{DAY_LABEL[day]}</span>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                {checked && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
