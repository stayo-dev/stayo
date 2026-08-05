import type { PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@shared/lib/cn';

/**
 * The `⠿` reorder-handle glyph confirmed reused across every drag-and-drop
 * list in the design source (Property cards on Home, Food-library chips,
 * Food-poll options, Rooms "layout" reorder mode) — always the same 2x3 dot
 * grid, not an icon-library glyph.
 *
 * Two modes, deliberately:
 *
 * - **Decorative (default).** A non-interactive `aria-hidden` span. This is
 *   what every call site was using, and for three of them (floor groups, room
 *   layout, food-poll options) the reorder behaviour genuinely does not exist
 *   yet — rendering an interactive control there would promise something that
 *   doesn't work, which is the bug this component was at the centre of.
 * - **Interactive (`onDragStart` supplied).** A real focusable button with an
 *   accessible label, used by the Home Property list. Reordering by keyboard
 *   is not done through this handle — it's in the card's ⋮ menu (Move up /
 *   Move down), because dragging is inherently pointer-only.
 */
export function DragHandle({
  className,
  onDragStart,
  label,
}: {
  className?: string;
  /** Supply to make the handle interactive; wire to `useDragControls().start`. */
  onDragStart?: (event: ReactPointerEvent) => void;
  /** Accessible name, e.g. "Reorder Stayo Residency — MG Road". */
  label?: string;
}) {
  const dots = Array.from({ length: 6 }).map((_, i) => (
    <span key={i} className="h-1 w-1 rounded-full bg-current" />
  ));

  if (!onDragStart) {
    return (
      <span
        className={cn('grid shrink-0 grid-cols-2 gap-[3px] p-1 text-muted-foreground', className)}
        aria-hidden="true"
      >
        {dots}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={label ?? 'Reorder'}
      onPointerDown={onDragStart}
      // The handle sits inside a card that navigates on click; without this a
      // drag that ends where it started would also open the hostel.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'grid shrink-0 cursor-grab touch-none grid-cols-2 gap-[3px] rounded-md p-1 text-muted-foreground',
        'transition-colors hover:bg-muted active:cursor-grabbing',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {dots}
    </button>
  );
}
