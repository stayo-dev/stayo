import { Check, Pencil, X } from 'lucide-react';

interface MealChipProps {
  name: string;
  color: string;
  editing: boolean;
  editText: string;
  onEditTextChange: (v: string) => void;
  onStartEdit: () => void;
  onConfirmEdit: () => void;
  onDelete: () => void;
}

/** One Food Library chip — view mode (dot, name, edit/delete) or inline-edit mode. */
export function MealChip({ name, color, editing, editText, onEditTextChange, onStartEdit, onConfirmEdit, onDelete }: MealChipProps) {
  if (editing) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border-[1.4px] border-primary bg-card py-1 pl-3 pr-1">
        <input
          value={editText}
          onChange={(e) => onEditTextChange(e.target.value)}
          className="w-20 border-none bg-transparent text-[12.5px] font-semibold text-foreground outline-none"
        />
        <button type="button" onClick={onConfirmEdit} className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-success text-white">
          <Check className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-2.5 pr-1.5">
      <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: color }} />
      <span className="text-[12.5px] font-semibold text-foreground">{name}</span>
      <button type="button" onClick={onStartEdit} className="flex h-[19px] w-[19px] items-center justify-center rounded-full text-muted-foreground">
        <Pencil className="h-3 w-3" />
      </button>
      <button type="button" onClick={onDelete} className="flex h-[19px] w-[19px] items-center justify-center rounded-full text-destructive">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
