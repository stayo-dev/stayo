import { useState } from 'react';
import { Check } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import type { OwnerSessionHostel } from '@features/owner-session/types';

interface CopyToHostelsSheetProps {
  open: boolean;
  onClose: () => void;
  /** The current hostel — excluded from the picker, copying a schedule onto itself is a no-op with no meaning here. */
  sourceHostelId: string;
  hostels: OwnerSessionHostel[];
  onConfirm: (targetHostelIds: string[]) => void;
}

/**
 * "Copy to another hostel" picker — same multi-select-checklist shape as
 * `CopyToDaysSheet`, just over the owner's other hostels instead of days.
 */
export function CopyToHostelsSheet({ open, onClose, sourceHostelId, hostels, onConfirm }: CopyToHostelsSheetProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const targets = hostels.filter((h) => h.id !== sourceHostelId);

  const toggle = (hostelId: string) => {
    setSelected((prev) => (prev.includes(hostelId) ? prev.filter((id) => id !== hostelId) : [...prev, hostelId]));
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
      title="Copy to another hostel"
      footer={
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={confirm}
          className="min-h-[44px] w-full rounded-xl bg-primary py-3 text-center font-display text-[13.5px] font-bold text-primary-foreground disabled:opacity-40"
        >
          {selected.length === 0 ? 'Choose at least one hostel' : `Copy to ${selected.length} ${selected.length === 1 ? 'hostel' : 'hostels'}`}
        </button>
      }
    >
      <div className="flex flex-col gap-1.5">
        {targets.map((hostel) => {
          const checked = selected.includes(hostel.id);
          return (
            <button
              key={hostel.id}
              type="button"
              onClick={() => toggle(hostel.id)}
              className="flex min-h-[44px] items-center justify-between rounded-xl border border-border px-3.5 py-2.5"
            >
              <span className="text-[13.5px] font-semibold text-foreground">{hostel.name}</span>
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
