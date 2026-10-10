import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Plus } from 'lucide-react';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useIsDesktop } from '@/app/components/ui/use-desktop';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { parseApiError } from '@lib/errors';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { SpecialMealReadyPanel } from '../components/SpecialMealReadyPanel';
import { useSpecialMealCount, useSpecialMeals } from '../hooks/useSpecialMeals';
import {
  absentLine, breakdownLine, choiceLabel, cookLine, CUTOFF_OPTIONS, lockLine, occasionTitle, peopleGroups, WEEKDAYS,
  type MealChoice, type SpecialCountPerson, type SpecialOccasion,
} from '../specialMeals';

/**
 * Special meals (spec 2026-10-10, Phase 1). Route `/owner/food/special-meals`,
 * hostel on `?hostelId=`. Answers one question: how many veg and non-veg to cook
 * for the next special meal, and who is behind each number.
 */
export function SpecialMealsPage() {
  const session = useOwnerSession();
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const hostelId = params.get('hostelId') ?? session.primaryHostelId ?? undefined;
  const meals = useSpecialMeals(hostelId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const active = meals.occasions.find((o) => o.id === selectedId) ?? meals.occasions[0] ?? null;

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={hostelId ? `/owner/food?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food'} className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Special meals</h1>
            <p className="text-[12.5px] font-medium text-muted-foreground">Veg and non-veg counts, collected on WhatsApp</p>
          </div>
        </div>
        {!isDesktop && <HostelSwitcher hostels={session.hostels} selectedId={hostelId} onSelect={(id) => setParams({ hostelId: id }, { replace: true })} />}
      </div>

      {meals.occasions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {meals.occasions.map((o) => (
            <button key={o.id} onClick={() => setSelectedId(o.id)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${active?.id === o.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
              {occasionTitle(o)}{o.isActive ? '' : ' · paused'}
            </button>
          ))}
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[13px] font-semibold">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      )}

      {(adding || (!meals.isLoading && meals.occasions.length === 0)) && hostelId && (
        <AddOccasionForm
          onCancel={meals.occasions.length > 0 ? () => setAdding(false) : undefined}
          onSave={async (body) => {
            try {
              const created = await meals.create(body);
              setSelectedId(created.id);
              setAdding(false);
              stayoToast.success(`${occasionTitle(created)} added · residents are asked the evening before`);
            } catch (e) {
              stayoToast.error(parseApiError(e) || 'Could not add that special meal.');
            }
          }}
        />
      )}

      {active && hostelId && <OccasionCount hostelId={hostelId} occasion={active} onUpdate={(body) => meals.update({ occasionId: active.id, body })} />}
    </div>
  );
}

/** Mirrors the backend's DEFAULT_MEAL_TIMINGS starts. Audit §7: no hostel has set its own timings yet. */
const DEFAULT_START: Record<string, string> = { BREAKFAST: '7:00 AM', LUNCH: '12:30 PM', SNACKS: '5:00 PM', DINNER: '7:00 PM' };

function AddOccasionForm({ onSave, onCancel }: { onSave: (b: { weekday: number; mealType: string; vegDish: string | null; nonVegDish: string | null; cutoffMinutesBefore: number }) => void; onCancel?: () => void }) {
  const [weekday, setWeekday] = useState(0);
  const [mealType, setMealType] = useState('LUNCH');
  const [vegDish, setVegDish] = useState('');
  const [nonVegDish, setNonVegDish] = useState('');
  const [cutoff, setCutoff] = useState(180);
  const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px]';
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <p className="text-[14px] font-bold">Add a special meal</p>
      <div className="grid grid-cols-2 gap-2">
        <select className={field} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
        <select className={field} value={mealType} onChange={(e) => setMealType(e.target.value)}>
          {['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'].map((m) => <option key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</option>)}
        </select>
      </div>
      <input className={field} placeholder="Non-veg dish (optional), e.g. Chicken Biryani" maxLength={60} value={nonVegDish} onChange={(e) => setNonVegDish(e.target.value)} />
      <input className={field} placeholder="Veg dish (optional), e.g. Veg Biryani" maxLength={60} value={vegDish} onChange={(e) => setVegDish(e.target.value)} />
      <p className="text-[12.5px] text-muted-foreground">
        Counted from the hostel's {mealType.toLowerCase()} time in Meal Plan (default {DEFAULT_START[mealType]} if never set).
      </p>
      <label className="text-[12.5px] font-medium text-muted-foreground">
        Answers close
        <select className={`${field} mt-1`} value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))}>
          {CUTOFF_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>{o.label} the meal starts</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <button className="flex-1 rounded-xl bg-primary py-2.5 text-[14px] font-bold text-primary-foreground"
          onClick={() => onSave({ weekday, mealType, vegDish: vegDish.trim() || null, nonVegDish: nonVegDish.trim() || null, cutoffMinutesBefore: cutoff })}>
          Save
        </button>
        {onCancel && <button className="rounded-xl bg-muted px-4 text-[14px] font-semibold" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

function OccasionCount({ hostelId, occasion, onUpdate }: { hostelId: string; occasion: SpecialOccasion; onUpdate: (b: Partial<SpecialOccasion>) => Promise<unknown> }) {
  const { data, isLoading, setAnswer, isSaving, sendReady, isSendingReady } = useSpecialMealCount(hostelId, occasion.id);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<SpecialCountPerson | null>(null);
  if (isLoading || !data) return <p className="text-[13px] text-muted-foreground">Loading…</p>;
  const c = data.count;
  const day = new Date(`${data.serveDate}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-border p-4">
        <p className="text-[13px] font-semibold text-muted-foreground">{day} · {lockLine(data.cutoffAt, data.isOpen)}</p>
        <div className="mt-2 flex gap-6">
          {cookLine(c).map((n) => (
            <div key={n.label}>
              <p className="font-display text-[34px] font-extrabold leading-none">{n.value}</p>
              <p className="text-[13px] font-semibold">{n.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground">{breakdownLine(c, occasion.noAnswerPolicy)}</p>
        <p className="text-[12.5px] text-muted-foreground">{absentLine(c)}</p>
      </div>

      <SpecialMealReadyPanel data={data} onSend={sendReady} isSending={isSendingReady} />

      {peopleGroups(c.people).map((g) => (
        <div key={g.key} className="rounded-xl border border-border">
          <button className="flex w-full items-center justify-between px-4 py-3 text-[14px] font-semibold" onClick={() => setOpen(open === g.key ? null : g.key)}>
            <span>{g.label}</span><span>{g.people.length}</span>
          </button>
          {open === g.key && (
            <ul className="divide-y divide-border border-t border-border">
              {g.people.map((p) => (
                <li key={p.tenantId}>
                  <button disabled={p.basis === 'ON_LEAVE'} onClick={() => setEditing(p)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13.5px] disabled:opacity-60">
                    <span>{p.name} <span className="text-muted-foreground">· Room {p.roomNo}</span></span>
                    <span className="text-muted-foreground">{p.basis === 'LAST_CHOICE' ? 'last time' : p.source === 'OWNER' ? 'edited' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {editing && (
        <div className="rounded-2xl border border-primary p-4">
          <p className="text-[14px] font-bold">{editing.name} · Room {editing.roomNo}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['NON_VEG', 'VEG', 'AWAY', 'SKIP'] as MealChoice[]).map((choice) => (
              <button key={choice} disabled={isSaving} className="rounded-xl bg-muted py-2 text-[13.5px] font-semibold"
                onClick={async () => { await setAnswer({ tenantId: editing.tenantId, serveDate: data.serveDate, choice }); setEditing(null); }}>
                {choiceLabel(choice)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button className="flex-1 rounded-xl py-2 text-[13px] text-muted-foreground" onClick={async () => { await setAnswer({ tenantId: editing.tenantId, serveDate: data.serveDate, choice: null }); setEditing(null); }}>Clear answer</button>
            <button className="flex-1 rounded-xl py-2 text-[13px]" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <details className="rounded-xl border border-border px-4 py-3 text-[13.5px]">
        <summary className="font-semibold">Settings</summary>
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center justify-between gap-2">
            Silent residents
            <select value={occasion.noAnswerPolicy} onChange={(e) => onUpdate({ noAnswerPolicy: e.target.value as SpecialOccasion['noAnswerPolicy'] })} className="rounded-lg border border-border bg-background px-2 py-1">
              <option value="LAST_CHOICE">Cook their last choice</option>
              <option value="LEAVE_OUT">Don't cook for them</option>
            </select>
          </label>
          <button className="self-start text-[13px] font-semibold text-primary" onClick={() => onUpdate({ isActive: !occasion.isActive })}>
            {occasion.isActive ? 'Pause this special meal' : 'Resume this special meal'}
          </button>
        </div>
      </details>
    </div>
  );
}
