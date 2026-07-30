import { Sparkles } from 'lucide-react';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { DAY_ORDER, type DayKey, type useFoodSchedule } from '../../hooks/useFoodSchedule';

const DAY_LABEL: Record<DayKey, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
};

const SLOT_ORDER: MealSlotKey[] = ['breakfast', 'lunch', 'snacks', 'dinner'];

interface WeeklyScheduleGridProps {
  schedule: ReturnType<typeof useFoodSchedule>;
  canGenerate: boolean;
}

/** The weekly (Mon-Sun x 4 meals) review/edit grid — one real week, replacing the old Week1-4 model. Tap a cell to swap its item. */
export function WeeklyScheduleGrid({ schedule, canGenerate }: WeeklyScheduleGridProps) {
  if (schedule.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-muted" />;
  }

  if (!schedule.schedule) {
    return (
      <div className="flex flex-col items-center gap-2.5 rounded-[20px] border border-border bg-card px-6 py-8 text-center shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <span className="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-secondary text-[27px]">🍽️</span>
        <span className="font-display text-[15px] font-bold text-foreground">No schedule yet</span>
        <p className="max-w-[250px] text-[12.5px] leading-relaxed text-muted-foreground">
          {canGenerate ? "Generate a week's schedule from this month's votes." : 'Close voting first, then generate the schedule from the results.'}
        </p>
        <button
          type="button"
          disabled={!canGenerate || schedule.isGenerating}
          onClick={() => schedule.generate()}
          className="mt-1 flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 font-display text-[13px] font-bold text-primary-foreground disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" /> {schedule.isGenerating ? 'Generating…' : 'Generate Schedule'}
        </button>
      </div>
    );
  }

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
            onClick={() => schedule.generate()}
            className="flex items-center gap-1 text-xs font-semibold text-primary disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" /> Regenerate
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {DAY_ORDER.map((day) => (
          <div key={day} className="flex flex-col gap-1.5">
            <span className="pl-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{DAY_LABEL[day]}</span>
            <div className="grid grid-cols-2 gap-2">
              {SLOT_ORDER.map((slot) => {
                const cell = schedule.grid[day][slot];
                const meta = MEAL_CATEGORY_META[slot];
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => cell && schedule.openPicker({ mealId: cell.id, slot })}
                    className="flex flex-col gap-1 rounded-xl border border-border bg-card px-2.5 py-2 text-left"
                  >
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      {meta.emoji} {meta.label}
                    </span>
                    <span className={`truncate text-[12px] font-semibold ${cell?.item_name && cell.item_name !== 'Not set' ? 'text-foreground' : 'text-muted-foreground/60 italic'}`}>
                      {cell?.item_name ?? 'Empty'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {schedule.schedule.status === 'DRAFT' ? (
        <button
          type="button"
          disabled={schedule.isPublishing}
          onClick={schedule.publish}
          className="rounded-xl bg-primary py-3.5 text-center font-display text-[13.5px] font-bold text-primary-foreground shadow-[0_8px_20px_rgba(180,106,85,0.32)] disabled:opacity-50"
        >
          {schedule.isPublishing ? 'Publishing…' : `Publish ${new Date().toLocaleDateString('en-IN', { month: 'long' })}`}
        </button>
      ) : (
        <p className="text-center text-[11.5px] text-muted-foreground">Live — any edit above updates tenants immediately.</p>
      )}
    </div>
  );
}
