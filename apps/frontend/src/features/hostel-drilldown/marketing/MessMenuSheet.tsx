import { useEffect, useState } from 'react';
import { Coffee, CopyPlus, Loader2, Moon, Sun, Utensils } from 'lucide-react';

import type { MarketingMess, MessMealKey } from '@features/hostel-marketing/api';
import { useKitchenMenu } from '@features/hostel-marketing/hooks/useMarketing';
import { stayoToast } from '@shared/ui-patterns/Toast';

import { MarketingSheet, SheetFooter } from './MarketingSheet';
import { M, MESS_DAY_LABELS } from './marketingTheme';

export const MEAL_ICON: Record<MessMealKey, typeof Coffee> = {
  b: Coffee,
  l: Utensils,
  s: Sun,
  dn: Moon,
};

/**
 * `MODAL: MESS MENU` of `Stayo App.dc.html` — the weekly menu editor.
 *
 * Day tabs live inside the sheet rather than reusing the card's day chips: the
 * design lets an owner edit Monday through Sunday without closing and
 * reopening, and the tab strip is what makes the whole week reachable in one
 * pass. Only meals the owner has switched on get a field, so a hostel that
 * doesn't do snacks is never asked what its snacks are.
 */
export function MessMenuSheet({
  open,
  hostelId,
  mess,
  initialDay,
  onClose,
  onSave,
}: {
  open: boolean;
  /** Needed to read the hostel's real kitchen menu for the import button. */
  hostelId: string | undefined;
  mess: MarketingMess;
  initialDay: number;
  onClose: () => void;
  onSave: (week: MarketingMess['week']) => void;
}) {
  const [week, setWeek] = useState(mess.week);
  const [day, setDay] = useState(initialDay);
  const [importing, setImporting] = useState(false);
  const kitchen = useKitchenMenu(hostelId, importing);

  // Reopening the sheet must start from what is saved, not from the edits a
  // previous Cancel discarded.
  useEffect(() => {
    if (open) {
      setWeek(mess.week);
      setDay(initialDay);
    }
  }, [open, mess.week, initialDay]);

  const meals = mess.meals.filter((meal) => meal.enabled);

  const setDish = (key: MessMealKey, value: string) => {
    setWeek(week.map((entry, index) => (index === day ? { ...entry, [key]: value } : entry)));
  };

  /**
   * Copy the hostel's live kitchen menu in.
   *
   * A copy, not a link: the listing keeps its own reviewed menu (ADR-077), so
   * what lands here is an editable draft that still goes through review. The
   * owner was otherwise retyping 28 cells they already maintain in Food,
   * which is why most listings had no menu at all.
   */
  const importKitchenMenu = async () => {
    setImporting(true);
    const result = await kitchen.refetch();
    const data = result.data;
    if (!data?.available || !data.week) {
      stayoToast.info("No published menu found in Food yet — publish this month's menu first.");
      return;
    }
    setWeek(data.week);
    stayoToast.success('Menu copied in — edit it, then save and send for review');
  };

  return (
    <MarketingSheet
      open={open}
      onClose={onClose}
      title="Weekly mess menu"
      subtitle={`Editing ${MESS_DAY_LABELS[day]} · tenants see this on Discovery`}
      footer={
        <SheetFooter
          secondaryLabel="Cancel"
          onSecondary={onClose}
          primaryLabel="Save menu"
          onPrimary={() => onSave(week)}
        />
      }
    >
      <div
        className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-5 pb-3"
        style={{ borderBottom: `1px solid ${M.sheetLine}` }}
      >
        {MESS_DAY_LABELS.map((label, index) => {
          const active = index === day;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={active}
              onClick={() => setDay(index)}
              className="flex-none rounded-[9px] px-[13px] py-2 font-display text-[12px]"
              style={
                active
                  ? { background: M.ink, color: '#FFFFFF', fontWeight: 700, border: '1px solid transparent' }
                  : { background: '#FFFFFF', color: M.chipText, fontWeight: 600, border: `1px solid ${M.inputLine}` }
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={importKitchenMenu}
        disabled={kitchen.isFetching}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-[11px] border border-dashed px-3.5 py-3 font-display text-[12.5px] font-bold text-primary disabled:opacity-60"
        style={{ borderColor: M.dashed, background: M.dashedBg }}
      >
        {kitchen.isFetching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <CopyPlus className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        Copy this hostel's kitchen menu
      </button>

      <div className="flex flex-col gap-4 pb-2">
        {meals.length === 0 && (
          <p className="rounded-xl bg-muted px-3.5 py-3 text-[12px] text-muted-foreground">
            Every meal is switched off. Turn one on to write a menu for it.
          </p>
        )}
        {meals.map((meal) => {
          const Icon = MEAL_ICON[meal.key];
          return (
            <div key={meal.key}>
              <div className="mb-[7px] flex items-center gap-2">
                <Icon className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.8} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  {meal.label}
                </span>
                <span className="text-[10.5px]" style={{ color: M.ghost }}>
                  {meal.time}
                </span>
              </div>
              <input
                value={week[day]?.[meal.key] ?? ''}
                onChange={(event) => setDish(meal.key, event.target.value)}
                placeholder="Add dishes, separated by ·"
                maxLength={200}
                className="w-full rounded-[11px] bg-card px-3.5 py-3 text-[13px] font-medium text-foreground outline-none"
                style={{ border: `1px solid ${M.inputLine}` }}
              />
            </div>
          );
        })}
      </div>
    </MarketingSheet>
  );
}
