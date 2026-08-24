import { useEffect, useMemo, useState } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import { RefreshCw, Archive, Trash2 } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { DragHandle } from '@shared/ui-patterns/DragHandle';
import { cn } from '@shared/lib/cn';
import type { MockProperty } from '@shared/mocks/dashboard';
import { PropertySortControl } from './PropertySortControl';
import { ReactivateHostelModal } from '../components/ReactivateHostelModal';
import { DeleteHostelModal } from '../components/DeleteHostelModal';
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
  onReactivate,
  onDelete,
}: {
  property: MockProperty;
  draggable: boolean;
  onSelect?: () => void;
  onMenu?: () => void;
  onReactivate?: () => void;
  /** Archived only: remove it for good. No undo, hence its own confirmation. */
  onDelete?: () => void;
}) {
  const controls = useDragControls();
  const isArchived = p.status === 'ARCHIVED';

  const card = (
    <div className={cn('rounded-2xl border bg-card transition-colors', isArchived ? 'border-amber-200/80 bg-amber-50/20 dark:border-amber-900/40 dark:bg-amber-950/10' : 'border-border')}>
      <div
        onClick={onSelect}
        className={cn('flex flex-col gap-2.5 p-3.5', onSelect && 'cursor-pointer')}
      >
        <div className="flex items-center gap-2.5">
          {draggable && !isArchived && (
            <DragHandle onDragStart={(e) => controls.start(e)} label={`Reorder ${p.name}`} />
          )}
          <div className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-foreground">
            {p.name}
          </div>
          {isArchived ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              <Archive className="h-3 w-3" />
              Archived
            </span>
          ) : (
            <StatusPill tone={occupancyTone(p.occupancyPercent ?? 0)} variant="filter">
              {p.occupancyLabel}
            </StatusPill>
          )}
          {!isArchived && (
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
          )}
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
                (p.outstandingValue ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {p.outstanding}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9.5px] font-medium text-muted-foreground">{isArchived ? 'Status' : 'Vacant'}</span>
            <span className="font-display text-xs font-bold tabular-nums text-foreground">
              {isArchived ? 'Historical' : p.vacant}
            </span>
          </div>
        </div>

        {isArchived && (onReactivate || onDelete) && (
          <div className="mt-1 flex items-center gap-2">
            {onReactivate && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReactivate();
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 py-2 text-[12px] font-bold text-primary transition-colors hover:bg-primary/20"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reactivate Property
              </button>
            )}
            {/* Reactivate used to be the only thing offered here, so a hostel
                created by mistake could never leave the account. The server
                accepts this only for one that never carried a tenant, a
                payment or an agreement. */}
            {onDelete && (
              <button
                type="button"
                aria-label={`Delete ${p.name} permanently`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="flex min-h-[34px] flex-none items-center justify-center gap-1.5 rounded-xl border border-destructive/30 px-3 py-2 text-[12px] font-bold text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (!draggable || isArchived) return card;

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

export function PropertyList({
  properties,
  onSelectProperty,
  onPropertyMenu,
  onAddHostel,
  onReorder,
}: PropertyListProps) {
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [mode, setMode] = useState<HostelSortMode>(() => loadSortMode());
  const [reactivateTarget, setReactivateTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const activeProperties = useMemo(() => properties.filter((p) => p.status !== 'ARCHIVED'), [properties]);
  const archivedProperties = useMemo(() => properties.filter((p) => p.status === 'ARCHIVED'), [properties]);

  const displayProperties = activeTab === 'ACTIVE' ? activeProperties : archivedProperties;

  const draggable = activeTab === 'ACTIVE' && isReorderable(mode) && activeProperties.length > 1 && Boolean(onReorder);

  const sorted = useMemo(() => sortHostels(displayProperties as any, mode) as MockProperty[], [displayProperties, mode]);

  const [items, setItems] = useState<MockProperty[]>(sorted);
  useEffect(() => setItems(sorted), [sorted]);

  const changeMode = (next: HostelSortMode) => {
    setMode(next);
    saveSortMode(next);
  };

  const header = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('ACTIVE')}
            className={cn(
              'text-xs font-bold uppercase tracking-wider transition-colors',
              activeTab === 'ACTIVE' ? 'text-foreground font-extrabold underline decoration-primary decoration-2 underline-offset-4' : 'text-muted-foreground/70 hover:text-muted-foreground',
            )}
          >
            Active ({activeProperties.length})
          </button>
          <span className="text-muted-foreground/30">•</span>
          <button
            type="button"
            onClick={() => setActiveTab('ARCHIVED')}
            className={cn(
              'text-xs font-bold uppercase tracking-wider transition-colors',
              activeTab === 'ARCHIVED' ? 'text-foreground font-extrabold underline decoration-primary decoration-2 underline-offset-4' : 'text-muted-foreground/70 hover:text-muted-foreground',
            )}
          >
            Archived ({archivedProperties.length})
          </button>
        </div>
        <div className="flex items-center gap-1">
          {activeTab === 'ACTIVE' && <PropertySortControl mode={mode} onChange={changeMode} />}
          <button type="button" onClick={onAddHostel} className="text-[12.5px] font-semibold text-primary">
            + Add hostel
          </button>
        </div>
      </div>
    </div>
  );

  const cardProps = (p: MockProperty) => ({
    property: p,
    onSelect: p.status !== 'ARCHIVED' && onSelectProperty ? () => onSelectProperty(p.id) : undefined,
    onMenu: onPropertyMenu ? () => onPropertyMenu(p.id) : undefined,
    onReactivate: () => setReactivateTarget({ id: p.id, name: p.name }),
    onDelete: () => setDeleteTarget({ id: p.id, name: p.name }),
  });

  return (
    <section className="flex flex-col gap-3">
      {header}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-8 text-center text-[13px] text-muted-foreground">
          {activeTab === 'ACTIVE' ? 'No active properties found.' : 'No archived properties in record.'}
        </div>
      ) : draggable ? (
        <Reorder.Group
          axis="y"
          values={items}
          onReorder={setItems}
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

      <ReactivateHostelModal
        open={Boolean(reactivateTarget)}
        onClose={() => setReactivateTarget(null)}
        hostelId={reactivateTarget?.id ?? null}
        hostelName={reactivateTarget?.name ?? ''}
      />
      <DeleteHostelModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        hostelId={deleteTarget?.id ?? null}
        hostelName={deleteTarget?.name ?? ''}
      />
    </section>
  );
}
