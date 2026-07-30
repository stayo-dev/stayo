import { useState } from 'react';
import type { MealSlotKey, PollType } from '@shared/mocks/food';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { EMPTY_CREATE_POLL_DRAFT, type CreatePollDraft, type CreatePollOption } from '../types';

/** The Create Poll sheet's own form state — self-contained, reset on open, mirrors useAddExpenseWizard's shape. */
export function useCreatePollDraft() {
  const [draft, setDraft] = useState<CreatePollDraft>(EMPTY_CREATE_POLL_DRAFT);
  const [optionText, setOptionText] = useState('');
  const [optionEdit, setOptionEdit] = useState<string | null>(null);
  const [optionEditText, setOptionEditText] = useState('');
  const [optionDrag, setOptionDrag] = useState<string | null>(null);

  const reset = () => {
    setDraft(EMPTY_CREATE_POLL_DRAFT);
    setOptionText('');
    setOptionEdit(null);
  };

  const setD = (patch: Partial<CreatePollDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setTitle = (title: string) => setD({ title });
  const setType = (type: PollType) => setD({ type });
  const setMealCat = (mealCat: MealSlotKey) => setD({ mealCat });
  const toggle = (key: 'anon' | 'multi' | 'notify') => setD({ [key]: !draft[key] });

  const addOption = () => {
    const name = optionText.trim();
    if (!name) return;
    setDraft((d) => ({ ...d, options: [...d.options, { id: `n${Date.now()}`, name }] }));
    setOptionText('');
  };
  const deleteOption = (id: string) => setDraft((d) => ({ ...d, options: d.options.filter((o) => o.id !== id) }));
  const startEditOption = (id: string, value: string) => {
    setOptionEdit(id);
    setOptionEditText(value);
  };
  const confirmEditOption = (id: string) => {
    const name = optionEditText.trim();
    setDraft((d) => ({ ...d, options: d.options.map((o) => (o.id === id && name ? { ...o, name } : o)) }));
    setOptionEdit(null);
  };
  const optionDragStart = (id: string) => setOptionDrag(id);
  const optionDrop = (id: string) => {
    if (!optionDrag || optionDrag === id) {
      setOptionDrag(null);
      return;
    }
    setDraft((d) => {
      const options: CreatePollOption[] = [...d.options];
      const from = options.findIndex((o) => o.id === optionDrag);
      const to = options.findIndex((o) => o.id === id);
      const [moved] = options.splice(from, 1);
      options.splice(to, 0, moved);
      return { ...d, options };
    });
    setOptionDrag(null);
  };
  const optionDragEnd = () => setOptionDrag(null);

  /** Validates and builds a MockFoodPoll from the draft, or shows a toast and returns null — mirrors publishPoll's validation. */
  const buildPoll = () => {
    const needsOptions = draft.type === 'single' || draft.type === 'multi';
    if (!draft.title.trim()) {
      stayoToast.info('Add a poll title');
      return null;
    }
    if (needsOptions && draft.options.length < 2) {
      stayoToast.info('Add at least 2 options');
      return null;
    }
    const options = needsOptions
      ? draft.options.map((o) => ({ id: o.id, name: o.name, pct: 0 }))
      : draft.type === 'yesno'
        ? [
            { id: 'y', name: 'Yes', pct: 0 },
            { id: 'n', name: 'No', pct: 0 },
          ]
        : [
            { id: 'r5', name: '5 stars', pct: 0 },
            { id: 'r4', name: '4 stars', pct: 0 },
            { id: 'r3', name: '3 stars', pct: 0 },
            { id: 'r2', name: '2 stars', pct: 0 },
            { id: 'r1', name: '1 star', pct: 0 },
          ];
    return {
      id: `p${Date.now()}`,
      title: draft.title.trim(),
      type: draft.type,
      mealCat: draft.mealCat,
      date: draft.date,
      status: 'active' as const,
      votes: 0,
      totalTenants: 180,
      closeIn: `Closes ${draft.closeTime}`,
      createdAgo: 'Just now',
      anon: draft.anon,
      options,
    };
  };

  return {
    draft,
    reset,
    setTitle,
    setType,
    setMealCat,
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
    optionDrag,
    optionDragStart,
    optionDrop,
    optionDragEnd,
    buildPoll,
  };
}
