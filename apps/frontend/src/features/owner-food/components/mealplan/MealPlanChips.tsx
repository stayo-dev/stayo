import { motion } from 'motion/react';
import { GripVertical, X } from 'lucide-react';

/**
 * `PlacedChip` — one dish already placed in a Meal Plan cell (ADR-121),
 * shared by the desktop grid and mobile view. Used to also export
 * `LibraryChip`, the Food Library drawer's draggable-onto-any-cell item —
 * removed along with the drawer itself in favor of the Add Food popover
 * (ADR-123); dragging a chip now only ever means reorder-within-cell or
 * drop-on-trash-to-delete, both handled by this component alone.
 */

interface PlacedChipProps {
  name: string;
  index: number;
  registerEl: (index: number, el: HTMLElement | null) => void;
  onRemove: () => void;
  onDragEnd: (index: number, point: { x: number; y: number }) => void;
  /** Fires continuously while this chip is being dragged (not just at drop), and once more with `null` the instant the drag ends — drives the page-level trash zone's visibility/hover state (ADR-123). */
  onDragMove?: (point: { x: number; y: number } | null) => void;
}

/** One dish already placed in a cell — drag anywhere on the chip to reorder within that cell or drop it on the trash zone to remove it, tap × to remove directly. */
export function PlacedChip({ name, index, registerEl, onRemove, onDragEnd, onDragMove }: PlacedChipProps) {
  return (
    <motion.div
      ref={(el) => registerEl(index, el)}
      drag
      dragSnapToOrigin
      dragElastic={0.15}
      whileDrag={{ scale: 1.04, zIndex: 50, boxShadow: '0 12px 28px rgba(0,0,0,0.18)' }}
      onDrag={(_, info) => onDragMove?.(info.point)}
      onDragEnd={(_, info) => {
        onDragMove?.(null);
        onDragEnd(index, info.point);
      }}
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
