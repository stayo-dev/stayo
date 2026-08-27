import { useState } from 'react';
import type { MealSlotKey } from '@shared/mocks/food';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { needsOwnerOptions, RATING_OPTIONS, YES_NO_OPTIONS, toClosesAtIso, type PollRow, type PollType } from '../polls/pollTypes';

export interface CreatePollOption {
  id: string;
  name: string;
  /** Only set when editing an existing poll — locks the option against removal. */
  votes?: number;
}

export interface CreatePollDraft {
  title: string;
  type: PollType;
  options: CreatePollOption[];
  mealCat: MealSlotKey;
  date: string; // yyyy-mm-dd, real <input type="date"> value
  closeTime: string; // HH:mm, real <input type="time"> value
  anon: boolean;
  multi: boolean;
  notify: boolean;
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}
/** Default closing time: 2 hours from now, so a freshly-opened poll isn't accidentally already past its own deadline. */
function defaultCloseTimeInput(): string {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toTimeString().slice(0, 5);
}

function emptyDraft(): CreatePollDraft {
  return {
    title: '',
    type: 'SINGLE_CHOICE',
    options: [],
    mealCat: 'lunch',
    date: todayDateInput(),
    closeTime: defaultCloseTimeInput(),
    anon: true,
    multi: false,
    notify: true,
  };
}

export interface BuiltPoll {
  title: string;
  type: PollType;
  mealCat: MealSlotKey;
  date: string;
  closeTime: string;
  anon: boolean;
  notify: boolean;
  /** Resolved options actually sent to the API — owner-authored for single/multi, fixed labels for rating/yesno. */
  options: string[];
  /** allow_multiple sent to the API — derived from poll type for rating/yesno (always false), independent toggle for single/multi. */
  allowMultiple: boolean;
}

export interface PollPatch {
  title: string;
  pollDate: string;
  closesAt: string;
  isAnonymous: boolean;
  allowMultiple: boolean;
  /** Omitted for RATING/YES_NO polls — their fixed option set isn't user-editable. */
  options?: { id?: string; label: string }[];
}

/** The Create Poll sheet's own form state — self-contained, reset on open. */
export function useCreatePollDraft() {
  const [draft, setDraft] = useState<CreatePollDraft>(emptyDraft);
  const [optionText, setOptionText] = useState('');
  const [optionEdit, setOptionEdit] = useState<string | null>(null);
  const [optionEditText, setOptionEditText] = useState('');

  const reset = () => {
    setDraft(emptyDraft());
    setOptionText('');
    setOptionEdit(null);
  };

  /** Loads an existing published poll's fields for editing — options carry their live vote counts so locked ones can't be removed. */
  const seedFrom = (poll: PollRow) => {
    setDraft({
      title: poll.title,
      type: poll.poll_type,
      options: poll.options.map((o) => ({ id: o.id, name: o.label, votes: o.votes })),
      mealCat: poll.meal_type.toLowerCase() as MealSlotKey,
      date: new Date(poll.poll_date).toISOString().slice(0, 10),
      closeTime: new Date(poll.closes_at).toTimeString().slice(0, 5),
      anon: poll.is_anonymous,
      multi: poll.allow_multiple,
      notify: false,
    });
    setOptionText('');
    setOptionEdit(null);
  };

  const setD = (patch: Partial<CreatePollDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setTitle = (title: string) => setD({ title });
  const setType = (type: PollType) => setD({ type });
  const setMealCat = (mealCat: MealSlotKey) => setD({ mealCat });
  const setDate = (date: string) => setD({ date });
  const setCloseTime = (closeTime: string) => setD({ closeTime });
  const toggle = (key: 'anon' | 'multi' | 'notify') => setD({ [key]: !draft[key] });

  const addOption = () => {
    const name = optionText.trim();
    if (!name) return;
    setDraft((d) => ({ ...d, options: [...d.options, { id: `n${Date.now()}`, name }] }));
    setOptionText('');
  };
  const deleteOption = (id: string) => {
    setDraft((d) => {
      const option = d.options.find((o) => o.id === id);
      if (option && (option.votes ?? 0) > 0) {
        stayoToast.info("Can't remove an option that already has votes");
        return d;
      }
      return { ...d, options: d.options.filter((o) => o.id !== id) };
    });
  };
  const startEditOption = (id: string, value: string) => {
    setOptionEdit(id);
    setOptionEditText(value);
  };
  const confirmEditOption = (id: string) => {
    const name = optionEditText.trim();
    setDraft((d) => ({ ...d, options: d.options.map((o) => (o.id === id && name ? { ...o, name } : o)) }));
    setOptionEdit(null);
  };
  /** Reorder.Group hands back the whole reordered array on drop — no manual drag-state machine needed. */
  const reorderOptions = (options: CreatePollOption[]) => setD({ options });

  const buildPoll = (): BuiltPoll | null => {
    if (!draft.title.trim()) {
      stayoToast.info('Add a poll title');
      return null;
    }
    const ownerOptions = needsOwnerOptions(draft.type);
    if (ownerOptions && draft.options.length < 2) {
      stayoToast.info('Add at least 2 options');
      return null;
    }
    const options = ownerOptions ? draft.options.map((o) => o.name) : draft.type === 'YES_NO' ? YES_NO_OPTIONS : RATING_OPTIONS;

    return {
      title: draft.title.trim(),
      type: draft.type,
      mealCat: draft.mealCat,
      date: draft.date,
      closeTime: draft.closeTime,
      anon: draft.anon,
      notify: draft.notify,
      options,
      // Only single/multi have a real per-poll "allow multiple selections"
      // choice — rating/yes-no are inherently one pick, and the toggle is
      // hidden for them in the modal (see needsOwnerOptions usage there) so
      // there's nothing to derive from `draft.multi` for those types.
      allowMultiple: ownerOptions ? draft.multi : false,
    };
  };

  /** Builds a `PATCH /api/food/polls/:id` body for editing an already-published poll. `poll_type` is fixed once created, so unlike `buildPoll` this never re-derives it. */
  const buildPatch = (): PollPatch | null => {
    if (!draft.title.trim()) {
      stayoToast.info('Add a poll title');
      return null;
    }
    const ownerOptions = needsOwnerOptions(draft.type);
    if (ownerOptions && draft.options.length < 2) {
      stayoToast.info('Add at least 2 options');
      return null;
    }

    const patch: PollPatch = {
      title: draft.title.trim(),
      pollDate: draft.date,
      closesAt: toClosesAtIso(draft.date, draft.closeTime),
      isAnonymous: draft.anon,
      allowMultiple: ownerOptions ? draft.multi : false,
    };
    if (ownerOptions) {
      patch.options = draft.options.map((o) => ({ id: o.id.startsWith('n') ? undefined : o.id, label: o.name }));
    }
    return patch;
  };

  return {
    draft,
    reset,
    seedFrom,
    setTitle,
    setType,
    setMealCat,
    setDate,
    setCloseTime,
    toggle,
    optionText,
    setOptionText,
    addOption,
    deleteOption,
    optionEdit,
    optionEditText,
    setOptionEditText,
    startEditOption,
    confirmEditOption,
    reorderOptions,
    buildPoll,
    buildPatch,
  };
}
