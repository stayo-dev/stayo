import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useIsDesktop } from '@/app/components/ui/use-desktop';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { parseApiError } from '@lib/errors';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { SpecialMealReadyPanel } from '../components/SpecialMealReadyPanel';
import { SpecialMealOutreachPanel } from '../components/SpecialMealOutreachPanel';
import { OccasionFormSheet, type OccasionFormValues } from '../components/special-meals/OccasionFormSheet';
import { useMealTimings } from '../hooks/useMealTimings';
import { useSpecialMealCount, useSpecialMeals } from '../hooks/useSpecialMeals';
import {
  WEEKDAYS,
  groupByDay,
  specialLabel,
  answeredProgress,
  breakdownLine,
  choiceLabel,
  dishSummary,
  occasionTitle,
  peopleGroups,
  phaseOf,
  servingLine,
  type MealChoice,
  type SpecialCountPerson,
  type SpecialOccasion,
} from '../specialMeals';

const SLOT = { BREAKFAST: 'breakfast', LUNCH: 'lunch', SNACKS: 'snacks', DINNER: 'dinner' } as const;
const MEAL_EMOJI = { BREAKFAST: '🍳', LUNCH: '🍛', SNACKS: '☕', DINNER: '🍽️' } as const;

function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/**
 * Special meals (ADR-238). One job: "how much do I cook, and who still needs a
 * nudge?" Each meal gets a hero card with its state and the two numbers, then
 * the single next action for that state (ask → remind → food's ready), then
 * the people behind the numbers. Editing, pausing and deleting live behind ⋯.
 */
export function SpecialMealsPage() {
  const session = useOwnerSession();
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const hostelId = params.get('hostelId') ?? session.primaryHostelId ?? undefined;
  const hostelName = session.hostels.find((h) => h.id === hostelId)?.name;
  const meals = useSpecialMeals(hostelId);
  const { mealTimings } = useMealTimings(hostelId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; editing: SpecialOccasion | null; weekday?: number }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<SpecialOccasion | null>(null);

  const today = istToday();
  const days = useMemo(() => groupByDay(meals.occasions, today), [meals.occasions, today]);
  const day = days.find((d) => d.date === selectedDay) ?? days[0] ?? null;
  const active = day?.occasions.find((o) => o.id === selectedId) ?? day?.occasions[0] ?? null;
  const hasSiblingAt = (weekday: number, mealType: SpecialOccasion['mealType']) =>
    meals.occasions.some((o) => o.weekday === weekday && o.mealType === mealType && o.id !== form.editing?.id);
  const mealStartFor = (m: SpecialOccasion['mealType']) => mealTimings[SLOT[m]]?.start ?? '12:30';

  const save = async (v: OccasionFormValues) => {
    try {
      if (form.editing) {
        await meals.update({ occasionId: form.editing.id, body: v });
        stayoToast.success('Saved');
      } else {
        const created = await meals.create(v);
        setSelectedId(created.id);
        setSelectedDay(created.nextServeDate);
        stayoToast.success(`${occasionTitle(created)} added · residents are asked the evening before`);
      }
      setForm({ open: false, editing: null });
    } catch (e) {
      stayoToast.error(parseApiError(e) || "Couldn't save the special meal.");
    }
  };

  const remove = async (target: SpecialOccasion | null) => {
    if (!target) return;
    try {
      await meals.remove(target.id);
      stayoToast.success(`${occasionTitle(target)} deleted`);
      setSelectedId(null);
      setForm({ open: false, editing: null });
      setDeleting(null);
    } catch (e) {
      stayoToast.error(parseApiError(e) || "Couldn't delete it.");
    }
  };

  const togglePause = async (o: SpecialOccasion) => {
    try {
      await meals.update({ occasionId: o.id, body: { isActive: !o.isActive } });
      stayoToast.success(o.isActive ? `${occasionTitle(o)} paused` : `${occasionTitle(o)} resumed`);
    } catch (e) {
      stayoToast.error(parseApiError(e) || "Couldn't update it.");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-10 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={hostelId ? `/owner/food?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food'} aria-label="Back to Food" className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-foreground">Special meals</h1>
            <p className="truncate text-[12.5px] font-medium text-muted-foreground">{hostelName ?? 'Veg and non-veg counts, collected on WhatsApp'}</p>
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {meals.occasions.length > 0 && (
            <button onClick={() => setForm({ open: true, editing: null, weekday: day?.weekday })} className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-[13.5px] font-bold text-primary-foreground">
              <Plus className="h-4 w-4" /> New
            </button>
          )}
          {!isDesktop && <HostelSwitcher hostels={session.hostels} selectedId={hostelId} onSelect={(id) => setParams({ hostelId: id }, { replace: true })} />}
        </div>
      </div>

      {!meals.isLoading && meals.occasions.length === 0 && <EmptyIntro onCreate={() => setForm({ open: true, editing: null })} />}

      {days.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="tablist" aria-label="Days">
          {days.map((d) => (
            <button
              key={d.date}
              role="tab"
              aria-selected={day?.date === d.date}
              onClick={() => { setSelectedDay(d.date); setSelectedId(null); }}
              className={`flex flex-none items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-semibold ${day?.date === d.date ? 'bg-foreground text-background' : 'bg-muted text-foreground'}`}
            >
              {d.label}
              <span className={`rounded-full px-1.5 text-[11.5px] ${day?.date === d.date ? 'bg-background/20' : 'bg-background'}`}>{d.occasions.length}</span>
            </button>
          ))}
        </div>
      )}

      {day && (
        <div className="flex flex-col gap-2">
          {day.occasions.map((o) => {
            const selected = active?.id === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setSelectedId(o.id)}
                aria-pressed={selected}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
              >
                <span className="text-xl" aria-hidden>{MEAL_EMOJI[o.mealType]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{specialLabel(o, day.occasions)}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">{dishSummary(o) ?? 'Veg or non-veg'}</span>
                </span>
                {!o.isActive && <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground">Paused</span>}
              </button>
            );
          })}
          <button
            onClick={() => setForm({ open: true, editing: null, weekday: day.weekday })}
            className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3 text-[13.5px] font-semibold text-muted-foreground"
          >
            <Plus className="h-4 w-4" /> Add another special for {day.label === 'Today' || day.label === 'Tomorrow' ? day.label.toLowerCase() : WEEKDAYS[day.weekday]}
          </button>
        </div>
      )}

      {active && hostelId && (
        <OccasionView
          key={active.id}
          hostelId={hostelId}
          occasion={active}
          onEdit={() => setForm({ open: true, editing: active })}
          onTogglePause={() => togglePause(active)}
          onDelete={() => setDeleting(active)}
        />
      )}

      <OccasionFormSheet
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        initial={form.editing}
        mealStartFor={mealStartFor}
        defaultWeekday={form.weekday}
        hasSiblingAt={hasSiblingAt}
        onSubmit={save}
        onDelete={() => remove(form.editing)}
        isSaving={meals.isSaving}
      />

      <BottomSheet open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={deleting ? `Delete ${occasionTitle(deleting)}?` : ''}>
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-[14px] text-muted-foreground">
            Residents stop being asked, and every answer and "food's ready" record for it is deleted. This can't be undone.
            If you only want a break, <button onClick={() => { if (deleting) togglePause(deleting); setDeleting(null); }} className="font-semibold text-primary underline">pause it instead</button>.
          </p>
          <div className="flex gap-2">
            <button disabled={meals.isSaving} onClick={() => remove(deleting)} className="h-12 flex-1 rounded-xl bg-destructive text-[15px] font-bold text-white">Delete</button>
            <button disabled={meals.isSaving} onClick={() => setDeleting(null)} className="h-12 rounded-xl bg-muted px-5 text-[15px] font-semibold">Keep</button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

function EmptyIntro({ onCreate }: { onCreate: () => void }) {
  const steps = [
    ['📲', 'The evening before, residents get a WhatsApp: Veg, Non-veg or I\'m away.'],
    ['📊', 'You see how much of each to cook, live, without going room to room.'],
    ['🔔', 'When it\'s ready, one tap tells everyone who ordered it.'],
  ];
  return (
    <div className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-card px-5 py-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-3xl">🍛</div>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-[20px] font-extrabold">Plan your special meals</h2>
        <p className="text-[14px] text-muted-foreground">Biryani Sunday? Ask who wants veg or non-veg on WhatsApp and get the count automatically.</p>
      </div>
      <ol className="flex w-full flex-col gap-2.5 text-left">
        {steps.map(([icon, text]) => (
          <li key={icon} className="flex items-start gap-3 rounded-2xl bg-muted px-3.5 py-3 text-[13.5px]">
            <span className="text-lg" aria-hidden>{icon}</span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <button onClick={onCreate} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground">
        <Plus className="h-5 w-5" /> Add a special meal
      </button>
    </div>
  );
}

function OccasionView({
  hostelId,
  occasion,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  hostelId: string;
  occasion: SpecialOccasion;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const { data, isLoading, setAnswer, isSaving, sendReady, isSendingReady, sendNow, isSendingNow } = useSpecialMealCount(hostelId, occasion.id);
  const [tab, setTab] = useState<string | null>(null);
  const [editing, setEditing] = useState<SpecialCountPerson | null>(null);
  const today = istToday();
  const groups = useMemo(() => (data ? peopleGroups(data.count.people) : []), [data]);
  const current = groups.find((g) => g.key === tab) ?? groups[0] ?? null;

  if (isLoading || !data) {
    return <div className="h-64 animate-pulse rounded-3xl bg-muted" />;
  }

  const c = data.count;
  const phase = phaseOf(data, today);
  const progress = answeredProgress(c);
  const dishes = dishSummary(occasion);

  const choose = async (choice: MealChoice | null) => {
    if (!editing) return;
    try {
      await setAnswer({ tenantId: editing.tenantId, serveDate: data.serveDate, choice });
      stayoToast.success(choice ? `${editing.name}: ${choiceLabel(choice)}` : `${editing.name}: answer cleared`);
      setEditing(null);
    } catch (e) {
      stayoToast.error(parseApiError(e) || "Couldn't save that answer.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Hero */}
      <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[24px] font-extrabold leading-tight">{occasionTitle(occasion)}</h2>
            {dishes && <p className="mt-0.5 text-[14px] font-medium">🍛 {dishes}</p>}
            <p className="mt-0.5 text-[13px] text-muted-foreground">{servingLine(data.serveDate, occasion.mealType, data.mealStart ?? '12:30', today)}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="More actions" className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-border">
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={onEdit}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={onTogglePause}>
                {occasion.isActive ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Resume</>}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <StatusPill tone={phase.tone} className="self-start">{phase.label}</StatusPill>

        <div className="grid grid-cols-2 gap-3">
          <CookTile emoji="🍗" label="Non-veg" value={c.cook.nonVeg} className="bg-[#FCEDE8] text-[#8A3A22] dark:bg-[#3A211A] dark:text-[#F4B9A6]" />
          <CookTile emoji="🥗" label="Veg" value={c.cook.veg} className="bg-[#E9F4EA] text-[#2F6B36] dark:bg-[#1C3320] dark:text-[#A9DDB0]" />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="font-semibold">{progress.answered} of {progress.here} answered</span>
            <span className="text-muted-foreground">{progress.pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="text-[12px] text-muted-foreground">{breakdownLine(c, occasion.noAnswerPolicy)}</p>
        </div>
      </section>

      {/* The next action for this state */}
      {occasion.isActive && (
        <>
          <SpecialMealOutreachPanel data={data} onSend={sendNow} isSending={isSendingNow} />
          <SpecialMealReadyPanel data={data} onSend={sendReady} isSending={isSendingReady} />
        </>
      )}

      {/* The people behind the numbers */}
      {groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Residents</h3>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {groups.map((g) => (
              <button
                key={g.key}
                onClick={() => setTab(g.key)}
                className={`flex flex-none items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${current?.key === g.key ? 'bg-foreground text-background' : 'bg-muted'}`}
              >
                {g.label} <span className="opacity-70">{g.people.length}</span>
              </button>
            ))}
          </div>
          {current && (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {current.people.map((p) => (
                <li key={p.tenantId}>
                  <button
                    disabled={p.basis === 'ON_LEAVE'}
                    onClick={() => setEditing(p)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-70"
                  >
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-muted text-[13px] font-bold">{p.name.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        Room {p.roomNo}
                        {p.basis === 'LAST_CHOICE' && ' · counted from last time'}
                        {p.source === 'OWNER' && ' · set by you'}
                        {p.basis === 'ON_LEAVE' && ' · on leave'}
                      </span>
                    </span>
                    {p.basis !== 'ON_LEAVE' && <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="flex items-start gap-2 px-1 text-[12px] text-muted-foreground">
        <UtensilsCrossed className="mt-0.5 h-3.5 w-3.5 flex-none" />
        Residents are asked automatically around 6 PM the day before and reminded around 8 AM on the day. People on leave are never asked.
      </p>

      <BottomSheet open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} title={editing ? `${editing.name} · Room ${editing.roomNo}` : ''}>
        <div className="flex flex-col gap-2 pb-2">
          <p className="text-[13px] text-muted-foreground">Set their answer for {occasionTitle(occasion).toLowerCase()}. They'll be counted as you choose.</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['NON_VEG', '🍗'],
              ['VEG', '🥗'],
              ['AWAY', '🧳'],
              ['SKIP', '🙅'],
            ] as Array<[MealChoice, string]>).map(([choice, icon]) => (
              <button
                key={choice}
                disabled={isSaving}
                onClick={() => choose(choice)}
                className={`flex h-16 items-center justify-center gap-2 rounded-2xl border text-[15px] font-bold ${editing?.choice === choice && editing.basis === 'CONFIRMED' ? 'border-primary bg-primary/10' : 'border-border'}`}
              >
                <span className="text-xl" aria-hidden>{icon}</span> {choiceLabel(choice)}
              </button>
            ))}
          </div>
          {editing?.basis === 'CONFIRMED' && (
            <button disabled={isSaving} onClick={() => choose(null)} className="mt-1 py-2 text-[13.5px] font-semibold text-muted-foreground">Clear their answer</button>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

function CookTile({ emoji, label, value, className }: { emoji: string; label: string; value: number; className: string }) {
  return (
    <div className={`flex flex-col gap-1 rounded-2xl px-4 py-3.5 ${className}`}>
      <span className="text-[13px] font-semibold">{emoji} {label}</span>
      <span className="font-display text-[40px] font-extrabold leading-none">{value}</span>
      <span className="text-[12px] font-medium opacity-80">to cook</span>
    </div>
  );
}
