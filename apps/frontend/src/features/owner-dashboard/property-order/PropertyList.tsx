import { useEffect, useMemo, useState } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { DragHandle } from '@shared/ui-patterns/DragHandle';
import { cn } from '@shared/lib/cn';
import type { MockProperty } from '@shared/mocks/dashboard';
import { PropertySortControl } from './PropertySortControl';
import {
  sortHostels,
  isReorderable,
  occupancyTone,
  loadSortMode,
  saveSortMode,
  type HostelSortMode,
} from './hostelSort';

interface PropertyListProps {
  properties: MockProperty[];
  onSelectProperty?: (hostelId: string) => void;
  onPropertyMenu?: (hostelId: string) => void;
  onAddHostel?: () => void;
  onReorder?: (orderedIds: string[]) => void;
}

function PropertyCard({
  property: p,
  draggable,
  onSelect,
  onMenu,
}: {
  property: MockProperty;
  draggable: boolean;
  onSelect?: () => void;
  onMenu?: () => void;
}) {
  const controls = useDragControls();

  const card = (
    <div className="rounded-2xl border border-border bg-card">
      <div
        onClick={onSelect}
        className={cn('flex flex-col gap-2.5 p-3.5', onSelect && 'cursor-pointer')}
      >
        <div className="flex items-center gap-2.5">
          {draggable && (
            <DragHandle onDragStart={(e) => controls.start(e)} label={`Reorder ${p.name}`} />
          )}
          <div className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-foreground">
            {p.name}
          </div>
          <StatusPill tone={occupancyTone(p.occupancyPercent ?? 0)} variant="filter">
            {p.occupancyLabel}
          </StatusPill>
          <button
            type="button"
            aria-label={`Options for ${p.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onMenu?.();
            }}
            className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-lg text-muted-foreground transition-colors hover:bg-muted"
          >
            ⋮
          </button>
        </div>

        <div className="text-[11.5px] text-muted-foreground">{p.location}</div>

        <div className="grid grid-cols-3 gap-1.5 border-t border-border pt-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9.5px] font-medium text-muted-foreground">Revenue</span>
            <span className="font-display text-xs font-bold tabular-nums text-foreground">{p.revenue}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9.5px] font-medium text-muted-foreground">Dues</span>
            <span
              className={cn(
                'font-display text-xs font-bold tabular-nums',
                // Zero dues is good news; painting it red made every property
                // look like it had a problem.
                (p.outstandingValue ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {p.outstanding}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9.5px] font-medium text-muted-foreground">Vacant</span>
            <span className="font-display text-xs font-bold tabular-nums text-foreground">{p.vacant}</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (!draggable) return card;

  return (
    <Reorder.Item
      value={p}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, zIndex: 20, boxShadow: '0 12px 28px rgba(0,0,0,0.16)' }}
      className="rounded-2xl"
    >
      {card}
    </Reorder.Item>
  );
}

/**
 * Home "Property" section — sort control plus the hostel cards.
 *
 * Drag is live only in "My order" mode and only from the handle
 * (`dragListener={false}` + `useDragControls`). That combination is what makes
 * this work on touch: the card keeps its tap-to-drill and the page keeps its
 * vertical scroll everywhere except the handle itself. See ADR-042.
 */
export function PropertyList({
  properties,
  onSelectProperty,
  onPropertyMenu,
  onAddHostel,
  onReorder,
}: PropertyListProps) {
  const [mode, setMode] = useState<HostelSortMode>(() => loadSortMode());
  const draggable = isReorderable(mode) && properties.length > 1 && Boolean(onReorder);

  const sorted = useMemo(() => sortHostels(properties as any, mode) as MockProperty[], [properties, mode]);

  // Local copy so the list follows the finger during a drag; resynced whenever
  // the sorted result changes (mode switch, refetch, optimistic update).
  const [items, setItems] = useState<MockProperty[]>(sorted);
  useEffect(() => setItems(sorted), [sorted]);

  const changeMode = (next: HostelSortMode) => {
    setMode(next);
    saveSortMode(next);
  };

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Property</h2>
      <div className="flex items-center gap-1">
        <PropertySortControl mode={mode} onChange={changeMode} />
        <button type="button" onClick={onAddHostel} className="text-[12.5px] font-semibold text-primary">
          + Add hostel
        </button>
      </div>
    </div>
  );

  const cardProps = (p: MockProperty) => ({
    property: p,
    onSelect: onSelectProperty ? () => onSelectProperty(p.id) : undefined,
    onMenu: onPropertyMenu ? () => onPropertyMenu(p.id) : undefined,
  });

  return (
    <section className="flex flex-col gap-3">
      {header}

      {draggable ? (
        <Reorder.Group
          axis="y"
          values={items}
          onReorder={setItems}
          // Commit on release, not on every crossover — otherwise a single
          // drag past two cards would fire two writes.
          onPointerUp={() => {
            const ids = items.map((p) => p.id);
            if (ids.join() !== sorted.map((p) => p.id).join()) onReorder?.(ids);
          }}
          className="flex list-none flex-col gap-3"
        >
          {items.map((p) => (
            <PropertyCard key={p.id} {...cardProps(p)} draggable />
          ))}
        </Reorder.Group>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((p) => (
            <PropertyCard key={p.id} {...cardProps(p)} draggable={false} />
          ))}
        </div>
      )}
    </section>
  );
}
