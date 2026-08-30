import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, Printer } from 'lucide-react';
import { FOOD_SLOTS, type MealSlotKey } from '@shared/mocks/food';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { PublishChecklist } from '../components/schedule/PublishChecklist';
import { MenuPreviewSheet } from '../components/mealplan/MenuPreviewSheet';
import { MealTimingsForm } from '../components/timings/MealTimingsForm';
import { AddFoodPopover } from '../components/mealplan/AddFoodPopover';
import { TrashDropZone } from '../components/mealplan/TrashDropZone';
import { CopyToDaysSheet } from '../components/mealplan/CopyToDaysSheet';
import { MealPlanGrid } from '../components/mealplan/MealPlanGrid';
import { MealPlanMobile } from '../components/mealplan/MealPlanMobile';
import { useFoodMenuItems } from '../hooks/useFoodMenuItems';
import { useFoodSchedule, DAY_ORDER, type DayKey } from '../hooks/useFoodSchedule';
import { useMealTimings } from '../hooks/useMealTimings';
import { planCopyToDays } from '../gridDnd';
import { addItem, isOverDropZone, type Rect } from '../timetableDnd';
import { measure } from '../gridMeasure';
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
  const navigate = useNavigate();
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

  // Add Food popover state — `addFoodTarget` is the specific cell a
  // "+ Add food" button was pressed for, driving both the popover's scope
  // and where a pick/create lands. Replaces the old drawer's `drawerTarget`
  // (ADR-123) — no more drag affordance for adding, no meal-type tabs.
  const [addFoodOpen, setAddFoodOpen] = useState(false);
  const [addFoodTarget, setAddFoodTarget] = useState<{ day: DayKey; slot: MealSlotKey } | null>(null);

  // Trash drop zone — mounted once at the page level, measured the same way
  // the old multi-cell resolver measured cell rects. Visible only while a
  // placed chip is mid-drag; `trashHover` drives its hover highlight.
  const trashRef = useRef<HTMLDivElement | null>(null);
  const [chipDragging, setChipDragging] = useState(false);
  const [trashHover, setTrashHover] = useState(false);

  const getTrashRect = (): Rect | null => (trashRef.current ? measure(trashRef.current) : null);

  const handleChipDragMove = (point: { x: number; y: number } | null) => {
    if (!point) {
      setChipDragging(false);
      setTrashHover(false);
      return;
    }
    setChipDragging(true);
    const rect = getTrashRect();
    setTrashHover(rect ? isOverDropZone(point, rect) : false);
  };

  // The Today card's "Fix" deep-link (`?day=&slot=`) used to preseed the old
  // Timetable's single active section; here it opens the Add Food popover
  // straight onto that cell — read once on mount.
  useEffect(() => {
    const day = searchParams.get('day');
    const slot = searchParams.get('slot');
    if (day && slot && (DAY_ORDER as readonly string[]).includes(day) && FOOD_SLOTS.some((s) => s.key === slot)) {
      setAddFoodTarget({ day: day as DayKey, slot: slot as MealSlotKey });
      setAddFoodOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [copyTarget, setCopyTarget] = useState<{ day: DayKey; slot: MealSlotKey } | null>(null);
  const [timingsOpen, setTimingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);

  // Unsaved-changes navigation guard (ADR-123) — wraps every in-app exit
  // trigger (back link, hostel switch, month nav). Known limitation: this
  // guards in-app navigation and tab close/refresh (`beforeunload`, below)
  // only. The browser's own Back/Forward buttons are NOT intercepted — this
  // app uses a plain <BrowserRouter> (RootProviders.tsx), not a data router,
  // so react-router's useBlocker isn't available.
  const [unsavedGuardOpen, setUnsavedGuardOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const guardedNavigate = (action: () => void) => {
    if (!schedule.hasPendingChanges) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setUnsavedGuardOpen(true);
  };

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (schedule.hasPendingChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [schedule.hasPendingChanges]);

  const handleOpenAddFood = (day: DayKey, slot: MealSlotKey) => {
    setAddFoodTarget({ day, slot });
    setAddFoodOpen(true);
  };

  /**
   * Places one dish in the target cell, or — when the owner asked for it — in
   * that slot on every day of the week. Hostels serve the same lunch all week
   * far more often than not, and doing that used to mean seven trips through
   * this sheet.
   *
   * Days that already carry the dish are skipped rather than duplicated, and
   * the toast reports what actually changed instead of claiming seven.
   */
  const addToTarget = (itemId: string, allDays = false) => {
    if (!addFoodTarget) return;
    const days = allDays ? DAY_ORDER : [addFoodTarget.day];

    let changed = 0;
    for (const day of days) {
      const cell = cellAt(schedule.weekGrid, day, addFoodTarget.slot);
      if (!cell?.id) continue;
      const currentIds = cell.items.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
      const { ids, added } = addItem(currentIds, itemId);
      if (!added) continue;
      schedule.setCellItems(cell.id, ids);
      changed += 1;
    }

    if (changed === 0) {
      stayoToast.info(allDays ? 'Already on every day' : 'Already added');
      return;
    }
    if (allDays) stayoToast.success(`Added to ${changed} ${changed === 1 ? 'day' : 'days'}`);
  };

  const handleCreateAndPick = async (name: string, allDays = false) => {
    if (!addFoodTarget) return;
    const newId = await library.createAndReturn(addFoodTarget.slot, name);
    if (newId) addToTarget(newId, allDays);
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

  const goBack = () => navigate(hostelId ? `/owner/food?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food');

  const resolveGuard = () => {
    setUnsavedGuardOpen(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
  };

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => guardedNavigate(goBack)}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Weekly Meal Plan</h1>
            <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">Plan your meals for the week</p>
          </div>
        </div>
        <HostelSwitcher
          hostels={session.hostels}
          selectedId={hostelId ?? null}
          onSelect={(id) => guardedNavigate(() => setSearchParams({ hostelId: id }, { replace: true }))}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => guardedNavigate(() => setSelectedMonth((m) => shiftMonth(m, -1)))}
            aria-label="Previous month"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-display text-[13.5px] font-bold text-foreground">{formatMonthLabel(selectedMonth)}</span>
          <button
            type="button"
            onClick={() => guardedNavigate(() => setSelectedMonth((m) => shiftMonth(m, 1)))}
            aria-label="Next month"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${schedule.schedule?.status === 'PUBLISHED' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
            {schedule.schedule?.status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </span>
          {schedule.schedule?.status === 'PUBLISHED' && schedule.hasPendingChanges && (
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">Unsaved changes</span>
          )}
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
        <div className="flex items-center gap-2">
          {/* The point of drafting a week is the sheet on the canteen wall, so
              the way to that sheet lives next to the plan itself rather than
              behind a menu. See ADR-144. */}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] font-semibold text-foreground"
          >
            <Printer className="h-3.5 w-3.5" /> Preview &amp; print
          </button>
          <button
            type="button"
            onClick={() => setTimingsOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11.5px] font-semibold text-foreground"
          >
            <Clock className="h-3.5 w-3.5" /> Edit timings
          </button>
        </div>
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
          getTrashRect={getTrashRect}
          onChipDragMove={handleChipDragMove}
        />
      ) : (
        <MealPlanGrid
          weekGrid={schedule.weekGrid}
          mealTimings={mealTimings.mealTimings}
          liveNameById={liveNameById}
          setCellItems={schedule.setCellItems}
          onOpenAddFood={handleOpenAddFood}
          onCopyToDays={(day, slot) => setCopyTarget({ day, slot })}
          getTrashRect={getTrashRect}
          onChipDragMove={handleChipDragMove}
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
          ) : schedule.hasPendingChanges ? (
            <button
              type="button"
              disabled={schedule.isSavingChanges}
              onClick={() => schedule.saveChanges()}
              className="min-h-[44px] rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground shadow-[0_8px_20px_rgba(180,106,85,0.32)] disabled:opacity-40"
            >
              {schedule.isSavingChanges ? 'Saving…' : 'Save changes'}
            </button>
          ) : (
            <p className="text-center text-[11.5px] text-muted-foreground">Live — no unsaved changes.</p>
          )}
        </div>
      )}

      <TrashDropZone
        visible={chipDragging}
        hovering={trashHover}
        registerRect={(el) => {
          trashRef.current = el;
        }}
      />

      <AddFoodPopover
        open={addFoodOpen}
        onClose={() => setAddFoodOpen(false)}
        target={addFoodTarget}
        library={library}
        onPickExisting={addToTarget}
        onCreateNew={handleCreateAndPick}
      />

      {copyTarget && (
        <CopyToDaysSheet open={Boolean(copyTarget)} onClose={() => setCopyTarget(null)} sourceDay={copyTarget.day} onConfirm={handleCopyToDays} />
      )}

      <MenuPreviewSheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        grid={schedule.weekGrid}
        hostelId={hostelId}
        hostelName={session.hostels.find((h) => h.id === hostelId)?.name ?? 'Your hostel'}
        month={selectedMonth}
        monthLabel={formatMonthLabel(selectedMonth)}
        isDraft={schedule.schedule?.status !== 'PUBLISHED'}
      />

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

      <BottomSheet
        open={unsavedGuardOpen}
        onOpenChange={setUnsavedGuardOpen}
        title="Unsaved changes"
        footer={
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={async () => {
                await schedule.saveChanges();
                resolveGuard();
              }}
              className="min-h-[44px] rounded-xl bg-primary py-3 text-center font-display text-[13.5px] font-bold text-primary-foreground"
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={() => {
                schedule.discardChanges();
                resolveGuard();
              }}
              className="min-h-[44px] rounded-xl border border-border py-3 text-center font-display text-[13.5px] font-bold text-foreground"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={() => {
                setUnsavedGuardOpen(false);
                pendingActionRef.current = null;
              }}
              className="min-h-[44px] py-2 text-center text-[13px] font-semibold text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        }
      >
        <p className="text-[13px] text-muted-foreground">You have unsaved changes to this published schedule. Save them so tenants see the update, or discard them?</p>
      </BottomSheet>
    </div>
  );
}
