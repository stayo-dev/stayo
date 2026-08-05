import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import type { FoodSlotMeta } from '@shared/mocks/food';
import { MealChip } from './MealChip';
import type { FoodMenuItemRow } from '../../hooks/useFoodMenuItems';
import type { useFoodMenuItems } from '../../hooks/useFoodMenuItems';
import { mealIcon } from '../../mealIcons';

interface FoodLibraryCardProps {
  slotMeta: FoodSlotMeta;
  items: FoodMenuItemRow[];
  library: ReturnType<typeof useFoodMenuItems>;
}

/** One Food Library collapsible section (Breakfast/Lunch/Snacks/Dinner) — real chip list with inline add/edit/delete. */
export function FoodLibraryCard({ slotMeta, items, library }: FoodLibraryCardProps) {
  const expanded = library.expanded[slotMeta.key];
  const addOpen = library.addOpen === slotMeta.key;

  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <button
        type="button"
        onClick={() => library.toggleSection(slotMeta.key)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3"
      >
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] text-[17px]" style={{ background: slotMeta.tint }}>
          {(() => { const I = mealIcon(slotMeta.key); return <I className="h-4 w-4" strokeWidth={1.75} />; })()}
        </span>
        <span className="flex-1 text-left font-display text-sm font-bold tracking-tight text-foreground">{slotMeta.label}</span>
        <span className="rounded-full bg-[#F4EDE4] px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#A89C90]">{items.length}</span>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="flex flex-wrap gap-2 px-3.5 pb-3.5 pt-0.5">
          {items.map((item) => (
            <MealChip
              key={item.id}
              name={item.name}
              color={slotMeta.color}
              editing={library.editTarget?.slot === slotMeta.key && library.editTarget.id === item.id}
              editText={library.editText}
              onEditTextChange={library.setEditText}
              onStartEdit={() => library.startEdit(slotMeta.key, item.id, item.name)}
              onConfirmEdit={library.confirmEdit}
              onDelete={() => library.deleteChip(item.id)}
            />
          ))}
          {!addOpen && (
            <button
              type="button"
              onClick={() => library.startAdd(slotMeta.key)}
              className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground"
            >
              <Plus className="h-3 w-3" /> Add Item
            </button>
          )}
          {addOpen && (
            <div className="flex items-center gap-1.5 rounded-full border-[1.4px] border-primary bg-card py-1 pl-3 pr-1">
              <input
                autoFocus
                value={library.addText}
                onChange={(e) => library.setAddText(e.target.value)}
                placeholder="New item"
                className="w-20 border-none bg-transparent text-[12.5px] font-semibold text-foreground outline-none"
              />
              <button type="button" onClick={() => library.confirmAdd(slotMeta.key)} className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-3 w-3" />
              </button>
              <button type="button" onClick={library.cancelAdd} className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full text-muted-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
