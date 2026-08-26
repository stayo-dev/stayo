import { useRef } from 'react';
import { motion } from 'motion/react';
import { GripVertical, X } from 'lucide-react';

/**
 * The two chip types shared by the Meal Plan desktop grid and mobile view
 * (ADR-121) — lifted from the retired `TimetablePage`'s `LibraryChip`/
 * `PlacedChip` (same `motion/react` drag convention every gesture in this
 * module already uses), generalized so the drop target is resolved by the
 * caller (via `gridDnd.findDropTarget` against whichever cells are currently
 * registered) instead of one hardcoded active zone.
 */

interface LibraryChipProps {
  name: string;
  onAdd: () => void;
  onDragEnd: (point: { x: number; y: number }) => void;
  /** Fires continuously while this chip is being dragged (not just at drop), and once more with `null` the instant the drag ends — drives the destination cell's live highlight. */
  onDragMove?: (point: { x: number; y: number } | null) => void;
}

/** A Food Library item, drag-or-tap-able onto whichever Meal Plan cell it's dropped on. */
export function LibraryChip({ name, onAdd, onDragEnd, onDragMove }: LibraryChipProps) {
  const didDragRef = useRef(false);

  return (
    <motion.div
      drag
      dragSnapToOrigin
      dragElastic={0.15}
      whileDrag={{ scale: 1.06, zIndex: 50, boxShadow: '0 12px 28px rgba(0,0,0,0.18)' }}
      onDragStart={() => {
        didDragRef.current = true;
      }}
      onDrag={(_, info) => onDragMove?.(info.point)}
      onDragEnd={(_, info) => {
        onDragMove?.(null); // clear the hover highlight immediately on drop
        onDragEnd(info.point);
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (didDragRef.current) {
            didDragRef.current = false;
            return;
          }
          onAdd();
        }}
        className="flex min-h-[40px] cursor-grab touch-none items-center gap-1.5 rounded-full border border-border bg-card py-1.5 pl-2.5 pr-3 text-[12.5px] font-semibold text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden="true" />
        {name}
      </button>
    </motion.div>
  );
}

interface PlacedChipProps {
  name: string;
  index: number;
  registerEl: (index: number, el: HTMLElement | null) => void;
  onRemove: () => void;
  onDragEnd: (index: number, point: { x: number; y: number }) => void;
}

/** One dish already placed in a cell — drag anywhere on the chip to reorder within that cell, tap × to remove. */
export function PlacedChip({ name, index, registerEl, onRemove, onDragEnd }: PlacedChipProps) {
  return (
    <motion.div
      ref={(el) => registerEl(index, el)}
      drag
      dragSnapToOrigin
      dragElastic={0.15}
      whileDrag={{ scale: 1.04, zIndex: 50, boxShadow: '0 12px 28px rgba(0,0,0,0.18)' }}
      onDragEnd={(_, info) => onDragEnd(index, info.point)}
      className="flex cursor-grab touch-none items-center gap-1 rounded-full border border-border bg-secondary/40 py-1 pl-2 pr-1 text-[11.5px] font-semibold text-foreground active:cursor-grabbing"
    >
      <GripVertical className="h-3 w-3 flex-none text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Remove ${name}`}
        className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-muted-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  );
}
