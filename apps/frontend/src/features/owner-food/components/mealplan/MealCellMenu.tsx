import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu';

interface MealCellMenuProps {
  disabled: boolean;
  onCopyToDays: () => void;
  onClear: () => void;
}

/** The ⋯ overflow menu on a filled Meal Plan cell — "Copy to days" and "Clear meal" (ADR-121). Disabled on an empty cell, nothing to copy or clear. */
export function MealCellMenu({ disabled, onCopyToDays, onClear }: MealCellMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Meal options"
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted-foreground disabled:opacity-30"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onCopyToDays}>Copy to days…</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onClear}>
          Clear meal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
