import { cn } from '@shared/lib/cn';

/**
 * The `⠿` reorder-handle glyph confirmed reused across every drag-and-drop
 * list in the design source (Property cards on Home, Food-library chips,
 * Food-poll options, Rooms "layout" reorder mode) — always the same 2x3 dot
 * grid, not an icon-library glyph.
 */
export function DragHandle({ className }: { className?: string }) {
  return (
    <span
      className={cn('grid shrink-0 grid-cols-2 gap-[3px] p-1 text-muted-foreground', className)}
      aria-hidden="true"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <span key={i} className="h-1 w-1 rounded-full bg-current" />
      ))}
    </span>
  );
}
