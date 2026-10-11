import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import {
  CUTOFF_OPTIONS,
  MEAL_TYPE_OPTIONS,
  WEEKDAY_SHORT,
  closePreview,
  occasionTitle,
  type NoAnswerPolicy,
  type SpecialOccasion,
} from '../../specialMeals';

export interface OccasionFormValues {
  weekday: number;
  mealType: SpecialOccasion['mealType'];
  nonVegDish: string | null;
  vegDish: string | null;
  cutoffMinutesBefore: number;
  noAnswerPolicy: NoAnswerPolicy;
}

const POLICY_OPTIONS: Array<{ value: NoAnswerPolicy; title: string; body: string }> = [
  { value: 'LAST_CHOICE', title: 'Cook their last choice', body: "Silent residents are counted as whatever they chose last time. Recommended — most people don't change week to week." },
  { value: 'LEAVE_OUT', title: "Don't cook for them", body: "Only residents who answered are counted. Safer for food cost, but people who forget to reply won't get a plate." },
];

/**
 * Create or edit a special meal. One sheet for both, so the owner learns one
 * form. Every choice is a tap (chips, cards), never a dropdown, and the cutoff
 * shows the actual closing time live, since "12 hours before" is easy to misjudge.
 */
export function OccasionFormSheet({
  open,
  onOpenChange,
  initial,
  mealStartFor,
  onSubmit,
  onDelete,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: SpecialOccasion | null;
  /** "HH:mm" serving start for a meal type, from the hostel's Meal Plan. */
  mealStartFor: (mealType: SpecialOccasion['mealType']) => string;
  onSubmit: (values: OccasionFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  isSaving: boolean;
}) {
  const [weekday, setWeekday] = useState(0);
  const [mealType, setMealType] = useState<SpecialOccasion['mealType']>('LUNCH');
  const [nonVegDish, setNonVegDish] = useState('');
  const [vegDish, setVegDish] = useState('');
  const [cutoff, setCutoff] = useState(180);
  const [policy, setPolicy] = useState<NoAnswerPolicy>('LAST_CHOICE');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWeekday(initial?.weekday ?? 0);
    setMealType(initial?.mealType ?? 'LUNCH');
    setNonVegDish(initial?.nonVegDish ?? '');
    setVegDish(initial?.vegDish ?? '');
    setCutoff(initial?.cutoffMinutesBefore ?? 180);
    setPolicy(initial?.noAnswerPolicy ?? 'LAST_CHOICE');
    setConfirmDelete(false);
  }, [open, initial]);

  const chip = (active: boolean) =>
    `rounded-full px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`;
  const label = 'text-[12.5px] font-bold uppercase tracking-wide text-muted-foreground';
  const input = 'w-full rounded-xl border border-border bg-background px-3.5 py-3 text-[15px] outline-none focus:border-primary';
  const editing = Boolean(initial);
  const start = mealStartFor(mealType);

  const submit = () =>
    onSubmit({
      weekday,
      mealType,
      nonVegDish: nonVegDish.trim() || null,
      vegDish: vegDish.trim() || null,
      cutoffMinutesBefore: cutoff,
      noAnswerPolicy: policy,
    });

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${occasionTitle({ weekday, mealType })}` : 'New special meal'}
      footer={
        confirmDelete ? (
          <div className="flex flex-col gap-2">
            <p className="text-[14px] font-semibold">Delete {initial ? occasionTitle(initial) : 'this meal'}? Its answers and history go too. This can't be undone.</p>
            <div className="flex gap-2">
              <button disabled={isSaving} onClick={() => onDelete?.()} className="flex-1 rounded-xl bg-destructive py-3 text-[15px] font-bold text-white">Delete</button>
              <button disabled={isSaving} onClick={() => setConfirmDelete(false)} className="rounded-xl bg-muted px-5 py-3 text-[15px] font-semibold">Keep</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {editing && onDelete && (
              <button onClick={() => setConfirmDelete(true)} aria-label="Delete special meal" className="flex h-12 w-12 items-center justify-center rounded-xl border border-border text-destructive">
                <Trash2 className="h-5 w-5" />
              </button>
            )}
            <button disabled={isSaving} onClick={submit} className="h-12 flex-1 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground disabled:opacity-60">
              {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create special meal'}
            </button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <section className="flex flex-col gap-2">
          <p className={label}>Day</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_SHORT.map((d, i) => (
              <button key={d} type="button" onClick={() => setWeekday(i)} className={chip(weekday === i)}>{d}</button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <p className={label}>Meal</p>
          <div className="flex flex-wrap gap-2">
            {MEAL_TYPE_OPTIONS.map((m) => (
              <button key={m.value} type="button" onClick={() => setMealType(m.value)} className={chip(mealType === m.value)}>{m.label}</button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <p className={label}>What's cooking</p>
          <label className="flex items-center gap-2">
            <span className="w-7 text-center text-lg" aria-hidden>🍗</span>
            <input className={input} maxLength={60} placeholder="Non-veg dish, e.g. Chicken Biryani" value={nonVegDish} onChange={(e) => setNonVegDish(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-7 text-center text-lg" aria-hidden>🥗</span>
            <input className={input} maxLength={60} placeholder="Veg dish, e.g. Veg Biryani" value={vegDish} onChange={(e) => setVegDish(e.target.value)} />
          </label>
          <p className="text-[12.5px] text-muted-foreground">Shown in the WhatsApp question and the "food's ready" alert. You can change them every week.</p>
        </section>

        <section className="flex flex-col gap-2">
          <p className={label}>Answers close</p>
          <div className="flex flex-wrap gap-2">
            {CUTOFF_OPTIONS.map((o) => (
              <button key={o.minutes} type="button" onClick={() => setCutoff(o.minutes)} className={chip(cutoff === o.minutes)}>
                {o.label.replace(' before', '')}
              </button>
            ))}
          </div>
          <p className="rounded-xl bg-muted px-3.5 py-2.5 text-[13.5px] font-medium">
            ⏰ {closePreview(start, cutoff)} · {MEAL_TYPE_OPTIONS.find((m) => m.value === mealType)?.label.toLowerCase()} starts {closePreview(start, 0).replace('Answers close at ', '').replace(' on the day', '')}
          </p>
          <p className="text-[12.5px] text-muted-foreground">Serving times come from Meal Plan.</p>
        </section>

        <section className="flex flex-col gap-2">
          <p className={label}>If a resident doesn't answer</p>
          {POLICY_OPTIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPolicy(p.value)}
              className={`flex flex-col gap-0.5 rounded-xl border p-3.5 text-left ${policy === p.value ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              <span className="text-[14.5px] font-bold">{p.title}</span>
              <span className="text-[12.5px] text-muted-foreground">{p.body}</span>
            </button>
          ))}
        </section>
      </div>
    </BottomSheet>
  );
}
