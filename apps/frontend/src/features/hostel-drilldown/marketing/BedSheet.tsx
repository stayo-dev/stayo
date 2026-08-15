import { useEffect, useState } from 'react';

import type { MarketingBed } from '@features/hostel-marketing/api';

import { Chip, MarketingSheet, SheetFooter, SheetInput, SheetLabel } from './MarketingSheet';
import { M } from './marketingTheme';

/** The sharing sizes the design offers as chips. Any other size stays valid. */
const SHARING_OPTIONS = [1, 2, 3, 4, 6];

const AVAILABILITY_OPTIONS: { value: MarketingBed['availability']; label: string }[] = [
  { value: 'BEDS_LEFT', label: 'Beds left' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'FULL', label: 'Full' },
];

function sharingLabel(size: number) {
  return size === 1 ? 'Single' : `${size}-bed`;
}

/**
 * `MODAL: MARKETING BED` of `Stayo App.dc.html`.
 *
 * Edits a working copy and commits on Save, rather than writing through on
 * every keystroke: the design's footer offers Remove and Save as a choice, and
 * a sheet that had already applied its edits would make Save a no-op and the
 * close button a silent confirm.
 */
export function BedSheet({
  open,
  bed,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  bed: MarketingBed | null;
  onClose: () => void;
  onSave: (next: MarketingBed) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<MarketingBed | null>(bed);

  useEffect(() => setDraft(bed), [bed]);

  if (!draft) return null;

  const patch = (next: Partial<MarketingBed>) => setDraft({ ...draft, ...next });
  const isNew = !bed?.name;

  return (
    <MarketingSheet
      open={open}
      onClose={onClose}
      title={isNew ? 'Add a bed type' : 'Edit bed type'}
      footer={
        <SheetFooter
          secondaryLabel="Remove"
          onSecondary={onRemove}
          primaryLabel="Save"
          onPrimary={() => onSave(draft)}
          primaryDisabled={!draft.name.trim()}
        />
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <SheetLabel>Room type name</SheetLabel>
          <SheetInput
            primary
            value={draft.name}
            maxLength={60}
            onChange={(name) => patch({ name })}
            placeholder="4-Bed AC"
          />
        </div>

        <div>
          <SheetLabel>Sharing (beds per room)</SheetLabel>
          <div className="flex flex-wrap gap-[7px]">
            {SHARING_OPTIONS.map((size) => (
              <Chip
                key={size}
                label={sharingLabel(size)}
                active={draft.sharing === size}
                onClick={() => patch({ sharing: size })}
              />
            ))}
          </div>
        </div>

        <div>
          <SheetLabel>Monthly price (per bed)</SheetLabel>
          <div
            className="flex items-center rounded-[11px] bg-card px-3.5"
            style={{ border: `1px solid ${M.inputLine}` }}
          >
            <span className="font-display text-[15px] font-semibold text-muted-foreground">₹</span>
            <input
              value={draft.price ? String(draft.price) : ''}
              inputMode="numeric"
              placeholder="4500"
              onChange={(event) => patch({ price: Number(event.target.value.replace(/\D/g, '')) || 0 })}
              className="min-w-0 flex-1 bg-transparent px-2 py-3 text-[14px] font-semibold text-foreground outline-none"
            />
          </div>
        </div>

        <div>
          <SheetLabel>Inclusions shown to tenants</SheetLabel>
          <SheetInput
            value={draft.inclusions ?? ''}
            maxLength={200}
            onChange={(inclusions) => patch({ inclusions })}
            placeholder="Attached bath · study desk · locker"
          />
        </div>

        <div>
          <SheetLabel>Availability</SheetLabel>
          <div className="flex flex-wrap gap-[7px]">
            {AVAILABILITY_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={draft.availability === option.value}
                onClick={() => patch({ availability: option.value })}
              />
            ))}
          </div>
        </div>
      </div>
    </MarketingSheet>
  );
}
