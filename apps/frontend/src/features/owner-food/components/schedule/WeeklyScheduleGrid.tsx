import { useRef } from 'react';
import { GripVertical, Sparkles } from 'lucide-react';
import type { useFoodSchedule } from '../../hooks/useFoodSchedule';
import { UtensilsCrossed } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { buildPublishChecks } from '../../publishChecks';
import { findDropTarget, isValidDrop, type DropCandidate } from '../../dragSwap';
import { PublishChecklist } from './PublishChecklist';
import { DayRow } from './DayRow';
import { DAY_ORDER, SLOT_ORDER, dayKeyFor, isFilled } from '../../weekGrid';

/**
 * A chip's on-screen box in **page** coordinates.
 *
 * `getBoundingClientRect()` is viewport-relative but motion's `PanInfo.point`
 * is `pageX`/`pageY` (verified in `framer-motion/dist/es/events/event-info.mjs`
 * — the docs only say "relative to the device or page"), so the scroll offset
 * is added here to put both in one space. Page coordinates also survive a
 * scroll mid-drag, which viewport rects measured at drag start would not.
 */
function measure(el: HTMLElement): DropCandidate['rect'] {
  const r = el.getBoundingClientRect();
  return {
    left: r.left + window.scrollX,
    top: r.top + window.scrollY,
    right: r.right + window.scrollX,
    bottom: r.bottom + window.scrollY,
  };
}

interface WeeklyScheduleGridProps {
  schedule: ReturnType<typeof useFoodSchedule>;
  canGenerate: boolean;
  voteCount: number;
  votesConsidered: boolean;
  tenantCount: number | null;
}

/** The weekly (Mon-Sun x 4 meals) review/edit grid — one real week, replacing the old Week1-4 model. Tap a cell to swap its item. */
export function WeeklyScheduleGrid({ schedule, canGenerate, voteCount, votesConsidered, tenantCount }: WeeklyScheduleGridProps) {
  // Every mounted chip's element, keyed by meal id. Elements rather than rects
  // because a rect measured at mount is stale the moment the page scrolls or
  // the grid re-renders; measuring is deferred to drag start.
  const chipsRef = useRef(new Map<string, { mealType: string; el: HTMLElement }>());
  // Snapshot taken at drag start and hit-tested at drag end. The dragged chip
  // is in it too, but `isValidDrop` rejects a drop onto itself.
  const candidatesRef = useRef<DropCandidate[]>([]);

  const registerChip = (mealId: string, mealType: string, el: HTMLElement | null) => {
    if (el) chipsRef.current.set(mealId, { mealType, el });
    else chipsRef.current.delete(mealId);
  };

  const measureChips = () => {
    candidatesRef.current = [...chipsRef.current.entries()].map(([mealId, { mealType, el }]) => ({
      mealId,
      mealType,
      rect: measure(el),
    }));
  };

  const handleChipDragEnd = (mealId: string, mealType: string, point: { x: number; y: number }) => {
    const targetId = findDropTarget(point, candidatesRef.current);
    const target = candidatesRef.current.find((c) => c.mealId === targetId) ?? null;

    if (!target) {
      // Releasing over nothing — the bottom nav, the gap between rows, a day
      // that was never on screen — is the common miss, because the week is
      // taller than a phone and motion will not scroll the page mid-drag.
      // Saying nothing here is indistinguishable from the feature being broken.
      stayoToast.info('Drop a meal onto the same meal type on another day, or tap it to move it');
      return;
    }
    if (!isValidDrop({ mealId, mealType }, target)) {
      // Dropping a chip back on itself is a change of mind, not a mistake.
      if (target.mealId !== mealId) stayoToast.info('Meals can only swap with the same meal type');
      return;
    }
    schedule.swapMeals(mealId, target.mealId);
  };

  if (schedule.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-muted" />;
  }

  if (!schedule.schedule) {
    return (
      <div className="flex flex-col items-center gap-2.5 rounded-[20px] border border-border bg-card px-6 py-8 text-center shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <span className="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-secondary"><UtensilsCrossed className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} /></span>
        <span className="font-display text-[15px] font-bold text-foreground">No schedule yet</span>
        <p className="max-w-[250px] text-[12.5px] leading-relaxed text-muted-foreground">
          {canGenerate ? "Generate a week's schedule from this month's votes." : 'Close voting first, then generate the schedule from the results.'}
        </p>
        <button
          type="button"
          disabled={!canGenerate || schedule.isGenerating}
          onClick={() => schedule.generate('BUILD')}
          className="mt-1 flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 font-display text-[13px] font-bold text-primary-foreground disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" /> {schedule.isGenerating ? 'Generating…' : 'Generate Schedule'}
        </button>
      </div>
    );
  }

  const checks = buildPublishChecks({ grid: schedule.weekGrid, votesConsidered, voteCount });
  const today = dayKeyFor(new Date());
  // Nothing to swap with until some meal type appears on two days, so the hint
  // stays out of the way of a half-built week.
  const canSwapAnything = SLOT_ORDER.some(
    (slot) => schedule.weekGrid.filter((c) => c.meal_type === slot && isFilled(c)).length >= 2,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Weekly Schedule</span>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${schedule.schedule.status === 'PUBLISHED' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
            {schedule.schedule.status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </span>
          <button
            type="button"
            disabled={schedule.isGenerating}
            onClick={() => schedule.generate(schedule.schedule!.status === 'PUBLISHED' ? 'FILL_GAPS' : 'BUILD')}
            className="flex min-h-[44px] items-center gap-1 text-xs font-semibold text-primary disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" /> {schedule.schedule!.status === 'PUBLISHED' ? 'Fill gaps' : 'Rebuild'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {DAY_ORDER.map((day) => (
          <DayRow
            key={day}
            day={day}
            grid={schedule.weekGrid}
            isToday={day === today}
            onPick={(cell) => {
              if (cell.id) schedule.openPicker({ mealId: cell.id, slot: cell.meal_type });
            }}
            registerChip={registerChip}
            onChipDragStart={measureChips}
            onChipDragEnd={handleChipDragEnd}
            // A second drag while a swap is in flight would hit-test against
            // the pre-swap grid and write the wrong pair.
            dragDisabled={schedule.isSwapping}
          />
        ))}
      </div>

      {canSwapAnything && (
        <p className="px-1.5 text-[11px] text-muted-foreground">
          Tap a meal to change it or move it to another day. Drag <GripVertical className="inline h-3 w-3 align-[-2px]" /> for a nearby day.
        </p>
      )}

      {schedule.schedule.status === 'DRAFT' ? (
        <div className="flex flex-col gap-3">
          <PublishChecklist checks={checks} tenantCount={tenantCount} />
          <button
            type="button"
            disabled={schedule.isPublishing}
            onClick={schedule.publish}
            className="min-h-[44px] rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground shadow-[0_8px_20px_rgba(180,106,85,0.32)] disabled:opacity-50"
          >
            {schedule.isPublishing ? 'Publishing…' : `Publish ${new Date().toLocaleDateString('en-IN', { month: 'long' })}`}
          </button>
        </div>
      ) : (
        <p className="text-center text-[11.5px] text-muted-foreground">Live — any edit above updates tenants immediately.</p>
      )}
    </div>
  );
}
