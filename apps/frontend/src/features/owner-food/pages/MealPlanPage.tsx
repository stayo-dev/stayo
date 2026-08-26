import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { PublishChecklist } from '../components/schedule/PublishChecklist';
import { MealTimingsForm } from '../components/timings/MealTimingsForm';
import { FoodLibraryDrawer } from '../components/mealplan/FoodLibraryDrawer';
import { CopyToDaysSheet } from '../components/mealplan/CopyToDaysSheet';
import { MealPlanGrid } from '../components/mealplan/MealPlanGrid';
import { MealPlanMobile } from '../components/mealplan/MealPlanMobile';
import type { DropResolution } from '../components/mealplan/dropResolution';
import { useFoodMenuItems } from '../hooks/useFoodMenuItems';
import { useFoodSchedule, DAY_ORDER, type DayKey } from '../hooks/useFoodSchedule';
import { useMealTimings } from '../hooks/useMealTimings';
import { planCopyToDays } from '../gridDnd';
import { addItem } from '../timetableDnd';
import { buildPublishChecks, canPublish } from '../publishChecks';
import { cellAt, dayKeyFor } from '../weekGrid';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** "YYYY-MM" + a signed month delta -> "YYYY-MM". No bound in either direction — see ADR-114 §9 / ADR-121. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Weekly Meal Plan — timings + timetable, one page (ADR-121). Replaces the
 * retired `MealTimingsPage` + `TimetablePage`: those two routes are gone,
 * `/owner/food/meal-timings` and `/owner/food/timetable` now redirect here
 * (see `RetiredFoodRoutes.tsx`). Route `/owner/food/meal-plan`, hostel on
 * `?hostelId=`, same convention as the rest of this module.
 */
export function MealPlanPage() {
  const session = useOwnerSession();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostelId = searchParams.get('hostelId') ?? session.primaryHostelId ?? undefined;

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);
  const [activeDay, setActiveDay] = useState<DayKey>(() => {
    const fromUrl = searchParams.get('day');
    return fromUrl && (DAY_ORDER as readonly string[]).includes(fromUrl) ? (fromUrl as DayKey) : dayKeyFor(new Date());
  });

  const library = useFoodMenuItems(hostelId);
  const schedule = useFoodSchedule(hostelId, selectedMonth);
  const mealTimings = useMealTimings(hostelId);

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

  // Drawer state — `drawerTarget` is the specific cell a "+ Add food" button
  // was pressed for, driving both the drawer's preselected meal-type tab and
  // where a *tap*-to-add lands. A *drag* is resolved independently by
  // geometry (`dropResolverRef`, below) and can land on any cell regardless
  // of which one opened the drawer — the two affordances are deliberately
  // not the same mechanism (ADR-121 §9).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTarget, setDrawerTarget] = useState<{ day: DayKey; slot: MealSlotKey } | null>(null);
  const dropResolverRef = useRef<(point: { x: number; y: number }) => DropResolution | null>(() => null);

  // Live highlight for whichever cell a Food Library chip is currently being
  // dragged over — `valid` when the cell's meal type matches the dragged
  // item's own type, `invalid` otherwise (a cross-meal-type drop is refused
  // client-side on drop, see handleDrawerDragEnd, rather than round-tripping
  // to the backend to find out).
  const [dragHover, setDragHover] = useState<{ day: DayKey; slot: MealSlotKey; valid: boolean } | null>(null);

  const handleDrawerDragMove = (mealType: MealSlotKey, point: { x: number; y: number } | null) => {
    if (!point) {
      setDragHover(null);
      return;
    }
    const resolved = dropResolverRef.current(point);
    if (!resolved) {
      setDragHover(null);
      return;
    }
    setDragHover({ day: resolved.day, slot: resolved.slot, valid: resolved.slot === mealType });
  };

  // The Today card's "Fix" deep-link (`?day=&slot=`) used to preseed the old
  // Timetable's single active section; here it opens the drawer straight
  // onto that cell, which is the closer equivalent — read once on mount.
  useEffect(() => {
    const day = searchParams.get('day');
    const slot = searchParams.get('slot');
    if (day && slot && (DAY_ORDER as readonly string[]).includes(day) && FOOD_SLOTS.some((s) => s.key === slot)) {
      setDrawerTarget({ day: day as DayKey, slot: slot as MealSlotKey });
      setDrawerOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [copyTarget, setCopyTarget] = useState<{ day: DayKey; slot: MealSlotKey } | null>(null);
  const [timingsOpen, setTimingsOpen] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);

  const handleOpenAddFood = (day: DayKey, slot: MealSlotKey) => {
    setDrawerTarget({ day, slot });
    setDrawerOpen(true);
  };

  const handleDrawerTapAdd = (itemId: string) => {
    if (!drawerTarget) {
      stayoToast.info('Open "+ Add food" from a specific meal to add there');
      return;
    }
    const cell = cellAt(schedule.weekGrid, drawerTarget.day, drawerTarget.slot);
    if (!cell?.id) return;
    const currentIds = cell.items.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
    const { ids, added } = addItem(currentIds, itemId);
    if (!added) {
      stayoToast.info('Already added');
      return;
    }
    schedule.setCellItems(cell.id, ids);
  };

  const handleDrawerDragEnd = (itemId: string, mealType: MealSlotKey, point: { x: number; y: number }) => {
    const resolved = dropResolverRef.current(point);
    if (!resolved) return;
    if (resolved.slot !== mealType) {
      // Refused client-side — the same rule the backend would enforce
      // (`validateMenuItemIds` scopes a cell's allowed items to its own meal
      // type), caught here so it never round-trips to a 400.
      stayoToast.error(`Can't add a ${mealType} item to ${resolved.slot}`);
      return;
    }
    const { ids, added } = addItem(resolved.currentIds, itemId);
    if (!added) {
      stayoToast.info('Already added');
      return;
    }
    schedule.setCellItems(resolved.cellId, ids);
  };

  const handleCopyToDays = (targetDays: DayKey[]) => {
    if (!copyTarget) return;
    const sourceCell = cellAt(schedule.weekGrid, copyTarget.day, copyTarget.slot);
    if (!sourceCell) return;
    const plan = planCopyToDays(sourceCell.items, targetDays);
    for (const { day, ids } of plan) {
      const targetCell = cellAt(schedule.weekGrid, day, copyTarget.slot);
      if (targetCell?.id) schedule.setCellItems(targetCell.id, ids);
    }
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
            <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Weekly Meal Plan</h1>
            <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">Plan your meals for the week</p>
          </div>
        </div>
        <HostelSwitcher hostels={session.hostels} selectedId={hostelId ?? null} onSelect={(id) => setSearchParams({ hostelId: id }, { replace: true })} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setSelectedMonth((m) => shiftMonth(m, -1))} aria-label="Previous month" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-display text-[13.5px] font-bold text-foreground">{formatMonthLabel(selectedMonth)}</span>
          <button type="button" onClick={() => setSelectedMonth((m) => shiftMonth(m, 1))} aria-label="Next month" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${schedule.schedule?.status === 'PUBLISHED' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
            {schedule.schedule?.status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            {publishResult.filledCount} / {publishResult.totalCells} meals planned
            {' · '}
            {publishAllowed ? (
              <span className="text-success">Ready to publish</span>
            ) : (
              `${publishResult.incompleteCells.length} meals remaining`
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-border bg-card px-3.5 py-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Meal Timings</span>
        <button
          type="button"
          onClick={() => setTimingsOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] font-semibold text-foreground"
        >
          <Clock className="h-3.5 w-3.5" /> Edit timings
        </button>
      </div>

      {isMobile ? (
        <MealPlanMobile
          activeDay={activeDay}
          onSelectDay={setActiveDay}
          weekGrid={schedule.weekGrid}
          mealTimings={mealTimings.mealTimings}
          liveNameById={liveNameById}
          setCellItems={schedule.setCellItems}
          onOpenAddFood={handleOpenAddFood}
          onCopyToDays={(day, slot) => setCopyTarget({ day, slot })}
          registerDropResolver={(fn) => {
            dropResolverRef.current = fn;
          }}
          dragHover={dragHover}
        />
      ) : (
        <MealPlanGrid
          weekGrid={schedule.weekGrid}
          mealTimings={mealTimings.mealTimings}
          liveNameById={liveNameById}
          setCellItems={schedule.setCellItems}
          onOpenAddFood={handleOpenAddFood}
          onCopyToDays={(day, slot) => setCopyTarget({ day, slot })}
          registerDropResolver={(fn) => {
            dropResolverRef.current = fn;
          }}
          dragHover={dragHover}
        />
      )}

      {schedule.schedule && (
        <div className="flex flex-col gap-3">
          <PublishChecklist checks={publishResult.checks} tenantCount={null} />
          {schedule.schedule.status === 'DRAFT' ? (
            <button
              type="button"
              disabled={!publishAllowed || schedule.isPublishing}
              onClick={() => setConfirmPublishOpen(true)}
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

      <FoodLibraryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        library={library}
        initialSlot={drawerTarget?.slot ?? null}
        onAdd={handleDrawerTapAdd}
        onDragEnd={handleDrawerDragEnd}
        onDragMove={handleDrawerDragMove}
      />

      {copyTarget && (
        <CopyToDaysSheet open={Boolean(copyTarget)} onClose={() => setCopyTarget(null)} sourceDay={copyTarget.day} onConfirm={handleCopyToDays} />
      )}

      <BottomSheet open={timingsOpen} onOpenChange={setTimingsOpen} title="Meal Timings">
        <MealTimingsForm
          mealTimings={mealTimings.mealTimings}
          isSaving={mealTimings.isSaving}
          onSave={(next) => {
            mealTimings.save(next);
            setTimingsOpen(false);
          }}
        />
      </BottomSheet>

      <BottomSheet
        open={confirmPublishOpen}
        onOpenChange={setConfirmPublishOpen}
        title={`Publish ${formatMonthLabel(selectedMonth)}?`}
        footer={
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmPublishOpen(false)}
              className="min-h-[44px] flex-1 rounded-xl border border-border py-3 text-center font-display text-[13.5px] font-bold text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                schedule.publish();
                setConfirmPublishOpen(false);
              }}
              className="min-h-[44px] flex-1 rounded-xl bg-primary py-3 text-center font-display text-[13.5px] font-bold text-primary-foreground"
            >
              Publish
            </button>
          </div>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          All {publishResult.totalCells} meals are planned for {formatMonthLabel(selectedMonth)}. Publishing makes this the live menu — tenants see it
          immediately.
        </p>
      </BottomSheet>
    </div>
  );
}
