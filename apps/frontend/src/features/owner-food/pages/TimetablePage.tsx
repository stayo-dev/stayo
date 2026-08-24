import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, useDragControls } from 'motion/react';
import { ChevronLeft, ChevronRight, GripVertical, Search, X } from 'lucide-react';
import { FOOD_SLOTS, MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { PublishChecklist } from '../components/schedule/PublishChecklist';
import { useFoodMenuItems, type FoodMenuItemRow } from '../hooks/useFoodMenuItems';
import { useFoodSchedule, DAY_ORDER, type DayKey } from '../hooks/useFoodSchedule';
import { useMealTimings } from '../hooks/useMealTimings';
import { mealIcon } from '../mealIcons';
import { buildPublishChecks, canPublish } from '../publishChecks';
import { addItem, filterByName, isOverDropZone, moveItem, removeItem, reorderIndexAt, resolveDisplayName, type Rect } from '../timetableDnd';
import { cellAt, dayCompleteness, dayKeyFor, type WeekGridCell } from '../weekGrid';
import { formatTimeRange } from '@features/food/mealTimings';

const DAY_LABEL_SHORT: Record<DayKey, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
  FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** "YYYY-MM" + a signed month delta -> "YYYY-MM". No bound in either direction — see ADR-114 §9. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Page coordinates (not viewport) — matches what motion's `PanInfo.point` reports, and survives a mid-drag scroll. */
function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left + window.scrollX, top: r.top + window.scrollY, right: r.right + window.scrollX, bottom: r.bottom + window.scrollY };
}

interface LibraryChipProps {
  item: FoodMenuItemRow;
  onAdd: () => void;
  getDropZoneRect: () => Rect | null;
}

/**
 * A Food Library item, drag-or-tap-able onto the active meal section.
 * Handle-only drag (same convention the old `DayRow` established): only the
 * grip initiates a drag, so a swipe anywhere else on the chip is a normal
 * scroll, never an accidental add, and a plain tap on the chip body adds
 * immediately (the mobile-primary fallback).
 */
function LibraryChip({ item, onAdd, getDropZoneRect }: LibraryChipProps) {
  const controls = useDragControls();
  const didDragRef = useRef(false);

  return (
    <motion.div
      drag
      dragListener={false}
      dragControls={controls}
      dragSnapToOrigin
      whileDrag={{ scale: 1.06, zIndex: 50, boxShadow: '0 12px 28px rgba(0,0,0,0.18)' }}
      onPointerDownCapture={() => {
        didDragRef.current = false;
      }}
      onDragStart={() => {
        didDragRef.current = true;
      }}
      onDragEnd={(_, info) => {
        const zone = getDropZoneRect();
        if (zone && isOverDropZone(info.point, zone)) onAdd();
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
        className="flex min-h-[40px] items-center gap-1.5 rounded-full border border-border bg-card py-1.5 pl-1 pr-3 text-[12.5px] font-semibold text-foreground"
      >
        <span
          onPointerDown={(e) => {
            e.stopPropagation();
            controls.start(e);
          }}
          className="flex h-7 w-6 flex-none touch-none cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
          aria-hidden="true"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        {item.name}
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

/** One dish already placed in the active section — drag its handle to reorder, tap × to remove. */
function PlacedChip({ name, index, registerEl, onRemove, onDragEnd }: PlacedChipProps) {
  const controls = useDragControls();

  return (
    <motion.div
      ref={(el) => registerEl(index, el)}
      drag
      dragListener={false}
      dragControls={controls}
      dragSnapToOrigin
      whileDrag={{ scale: 1.04, zIndex: 50, boxShadow: '0 12px 28px rgba(0,0,0,0.18)' }}
      onDragEnd={(_, info) => onDragEnd(index, info.point)}
      className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 py-1.5 pl-1 pr-1.5 text-[12.5px] font-semibold text-foreground"
    >
      <span
        onPointerDown={(e) => {
          e.stopPropagation();
          controls.start(e);
        }}
        className="flex h-7 w-6 flex-none touch-none cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
        aria-hidden="true"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

/**
 * Weekly Timetable — day tabs, one active meal section at a time, a
 * search-and-drag Food Library panel scoped to that section. Route
 * `/owner/food/timetable`, hostel on `?hostelId=`, same convention as the
 * other Food subpages. Replaces the old 7-day grid + tap-checklist sheet —
 * see ADR-114 for the full list of what changed and why.
 */
export function TimetablePage() {
  const session = useOwnerSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostelId = searchParams.get('hostelId') ?? session.primaryHostelId ?? undefined;

  // `day`/`slot` are an optional one-time seed from `FoodPage`'s "Fix" link
  // (e.g. tapping an unset meal on the Today card) — read once on mount, not
  // kept in sync with the URL afterward. Day/slot selection is otherwise
  // plain client state, per ADR-114 §1 (no per-day routing).
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);
  const [activeDay, setActiveDay] = useState<DayKey>(() => {
    const fromUrl = searchParams.get('day');
    return fromUrl && (DAY_ORDER as readonly string[]).includes(fromUrl) ? (fromUrl as DayKey) : dayKeyFor(new Date());
  });
  const [activeSlot, setActiveSlot] = useState<MealSlotKey>(() => {
    const fromUrl = searchParams.get('slot');
    return fromUrl && FOOD_SLOTS.some((s) => s.key === fromUrl) ? (fromUrl as MealSlotKey) : 'breakfast';
  });
  const [searchQuery, setSearchQuery] = useState('');

  const library = useFoodMenuItems(hostelId);
  const schedule = useFoodSchedule(hostelId, selectedMonth);
  const mealTimings = useMealTimings(hostelId);

  // "Ensure this month has a schedule row" — fires at most once per month per
  // mount. Never seeds content from any other month (enforced server-side by
  // `POST /api/food/schedules`) — a newly created month is always empty.
  const createdForMonthRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hostelId || schedule.isLoading || schedule.schedule) return;
    if (createdForMonthRef.current === selectedMonth) return;
    createdForMonthRef.current = selectedMonth;
    schedule.createSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostelId, selectedMonth, schedule.isLoading, schedule.schedule]);

  const liveNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const slotMeta of FOOD_SLOTS) {
      for (const item of library.library[slotMeta.key]) map.set(item.id, item.name);
    }
    return map;
  }, [library.library]);

  const activeCell: WeekGridCell | null = cellAt(schedule.weekGrid, activeDay, activeSlot);
  const placedIds = (activeCell?.items ?? []).map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
  const filteredLibrary = filterByName(library.library[activeSlot], searchQuery);

  const dropZoneElRef = useRef<HTMLDivElement | null>(null);
  const placedChipElsRef = useRef(new Map<number, HTMLElement>());

  const registerPlacedChip = (index: number, el: HTMLElement | null) => {
    if (el) placedChipElsRef.current.set(index, el);
    else placedChipElsRef.current.delete(index);
  };

  const handleAdd = (itemId: string) => {
    if (!activeCell?.id) return;
    const { ids, added } = addItem(placedIds, itemId);
    if (!added) {
      stayoToast.info('Already added');
      return;
    }
    schedule.setCellItems(activeCell.id, ids);
  };

  const handleRemove = (itemId: string) => {
    if (!activeCell?.id) return;
    schedule.setCellItems(activeCell.id, removeItem(placedIds, itemId));
  };

  const handleReorderEnd = (fromIndex: number, point: { x: number; y: number }) => {
    if (!activeCell?.id) return;
    const rects: Rect[] = [];
    placedChipElsRef.current.forEach((el, i) => {
      rects[i] = measure(el);
    });
    const toIndex = reorderIndexAt(point, rects, fromIndex);
    schedule.setCellItems(activeCell.id, moveItem(placedIds, fromIndex, toIndex));
  };

  const publishResult = buildPublishChecks({ grid: schedule.weekGrid });
  const publishAllowed = canPublish(publishResult);

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={hostelId ? `/owner/food?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food'}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Weekly Timetable</h1>
            <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">
              {schedule.schedule?.status === 'PUBLISHED' ? 'Live — edits update tenants immediately' : 'Drag or tap food into each meal'}
            </p>
          </div>
        </div>
        <HostelSwitcher hostels={session.hostels} selectedId={hostelId ?? null} onSelect={(id) => setSearchParams({ hostelId: id }, { replace: true })} />
      </div>

      {/* Month navigation — Previous / current / Next, no bound either direction. Switching months always re-checks (and creates if missing) via the effect above. */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-2 py-1.5">
        <button
          type="button"
          onClick={() => setSelectedMonth((m) => shiftMonth(m, -1))}
          aria-label="Previous month"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-display text-[13.5px] font-bold text-foreground">{formatMonthLabel(selectedMonth)}</span>
        <button
          type="button"
          onClick={() => setSelectedMonth((m) => shiftMonth(m, 1))}
          aria-label="Next month"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {DAY_ORDER.map((day) => {
          const completeness = dayCompleteness(schedule.weekGrid, day);
          const active = day === activeDay;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setActiveDay(day)}
              className={`flex min-h-[40px] flex-none items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-bold ${
                active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground'
              }`}
            >
              {DAY_LABEL_SHORT[day]}
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  completeness === 'COMPLETE'
                    ? active
                      ? 'bg-primary-foreground'
                      : 'bg-success'
                    : completeness === 'PARTIAL'
                      ? active
                        ? 'bg-primary-foreground/60'
                        : 'bg-warning'
                      : active
                        ? 'bg-primary-foreground/30'
                        : 'bg-border'
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* The active day's 4 meal sections */}
      <div className="flex flex-col gap-2.5">
        {FOOD_SLOTS.map((slotMeta) => {
          const cell = cellAt(schedule.weekGrid, activeDay, slotMeta.key);
          const items = cell?.items ?? [];
          const isActive = slotMeta.key === activeSlot;
          const Icon = mealIcon(slotMeta.key);
          const timing = mealTimings.mealTimings[slotMeta.key];

          return (
            <div
              key={slotMeta.key}
              className={`overflow-hidden rounded-[18px] border bg-card ${isActive ? 'border-primary' : 'border-border'}`}
            >
              <button
                type="button"
                onClick={() => setActiveSlot(slotMeta.key)}
                className="flex w-full items-center gap-2.5 px-3.5 py-3"
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px]" style={{ background: slotMeta.tint }}>
                  <Icon className="h-4 w-4" style={{ color: slotMeta.color }} strokeWidth={1.75} />
                </span>
                <span className="flex-1 text-left">
                  <span className="block font-display text-sm font-bold tracking-tight text-foreground">{slotMeta.label}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{timing.enabled ? formatTimeRange(timing) : 'Off'}</span>
                </span>
                <span className="rounded-full bg-[#F4EDE4] px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#A89C90]">
                  {items.length}
                </span>
              </button>

              <div
                ref={isActive ? dropZoneElRef : undefined}
                className={`flex flex-wrap gap-2 px-3.5 pb-3.5 pt-0.5 ${isActive ? 'min-h-[48px] bg-secondary/20' : ''}`}
              >
                {items.length === 0 && (
                  <span className="py-1.5 text-[12px] italic text-muted-foreground/70">
                    {isActive ? 'Drag or tap a food item below to add it here' : 'Not set'}
                  </span>
                )}
                {items.map((item, index) =>
                  isActive ? (
                    <PlacedChip
                      key={item.id}
                      name={resolveDisplayName(item, liveNameById)}
                      index={index}
                      registerEl={registerPlacedChip}
                      onRemove={() => item.menu_item_id && handleRemove(item.menu_item_id)}
                      onDragEnd={handleReorderEnd}
                    />
                  ) : (
                    <span key={item.id} className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px] font-semibold text-foreground">
                      {resolveDisplayName(item, liveNameById)}
                    </span>
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Food Library panel — scoped to the active meal section only */}
      <div className="flex flex-col gap-2.5 rounded-[18px] border border-border bg-card p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {MEAL_CATEGORY_META[activeSlot].label} items
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
          <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${MEAL_CATEGORY_META[activeSlot].label.toLowerCase()} items`}
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-foreground outline-none"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" className="text-muted-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {filteredLibrary.length === 0 ? (
          <p className="py-2 text-center text-[12.5px] text-muted-foreground">No food items found</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {filteredLibrary.map((item) => (
              <LibraryChip key={item.id} item={item} onAdd={() => handleAdd(item.id)} getDropZoneRect={() => (dropZoneElRef.current ? measure(dropZoneElRef.current) : null)} />
            ))}
          </div>
        )}
      </div>

      {/* Publish */}
      {schedule.schedule && (
        <div className="flex flex-col gap-3">
          <PublishChecklist checks={publishResult.checks} tenantCount={null} />
          {schedule.schedule.status === 'DRAFT' ? (
            <button
              type="button"
              disabled={!publishAllowed || schedule.isPublishing}
              onClick={schedule.publish}
              title={publishAllowed ? undefined : 'Fill every meal before publishing'}
              className="min-h-[44px] rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground shadow-[0_8px_20px_rgba(180,106,85,0.32)] disabled:opacity-40"
            >
              {schedule.isPublishing ? 'Publishing…' : publishAllowed ? `Publish ${formatMonthLabel(selectedMonth)}` : 'Fill every meal to publish'}
            </button>
          ) : (
            <p className="text-center text-[11.5px] text-muted-foreground">Live — any edit above updates tenants immediately.</p>
          )}
        </div>
      )}
    </div>
  );
}
