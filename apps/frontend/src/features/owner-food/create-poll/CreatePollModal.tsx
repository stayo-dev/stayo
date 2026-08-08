import { useEffect } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { Reorder, useDragControls } from 'motion/react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { DragHandle } from '@shared/ui-patterns/DragHandle';
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { needsOwnerOptions, POLL_TYPE_META, TITLE_SUGGESTIONS, type PollType } from '../polls/pollTypes';
import { useCreatePollDraft, type CreatePollOption, type BuiltPoll } from '../hooks/useCreatePollDraft';
import { Toggle } from '../components/Toggle';
import { mealIcon } from '../mealIcons';

interface CreatePollModalProps {
  open: boolean;
  onClose: () => void;
  onPublish: (poll: BuiltPoll) => void;
}

const POLL_TYPES: PollType[] = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RATING', 'YES_NO'];
const MEAL_CATS: MealSlotKey[] = ['breakfast', 'lunch', 'snacks', 'dinner'];

function OptionRow({
  option,
  editing,
  editText,
  onEditTextChange,
  onConfirmEdit,
  onStartEdit,
  onDelete,
}: {
  option: CreatePollOption;
  editing: boolean;
  editText: string;
  onEditTextChange: (v: string) => void;
  onConfirmEdit: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={option}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, zIndex: 20, boxShadow: '0 12px 28px rgba(0,0,0,0.16)' }}
      className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-[0_1px_2px_rgba(40,30,20,0.04)]"
    >
      {editing ? (
        <>
          <input
            autoFocus
            value={editText}
            onChange={(e) => onEditTextChange(e.target.value)}
            className="flex-1 border-none bg-transparent text-[13px] font-semibold text-foreground outline-none"
          />
          <button type="button" onClick={onConfirmEdit} className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-success text-white">
            <Check className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <DragHandle onDragStart={(e) => controls.start(e)} label={`Reorder ${option.name}`} />
          <span className="flex-1 text-[13px] font-semibold text-foreground">{option.name}</span>
          <button type="button" onClick={onStartEdit} className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onDelete} className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </Reorder.Item>
  );
}

/** Create Food Poll sheet — title, poll type, options (single/multi only), meal category, date/closing-time, 3 toggles. Rebuilt on real data 2026-08-08; see docs/obsidian/Food.md. */
export function CreatePollModal({ open, onClose, onPublish }: CreatePollModalProps) {
  const draft = useCreatePollDraft();

  useEffect(() => {
    if (open) draft.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const showOptions = needsOwnerOptions(draft.draft.type);

  const handlePublish = () => {
    const poll = draft.buildPoll();
    if (!poll) return;
    onClose();
    onPublish(poll);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Create Food Poll"
      footer={
        <button type="button" onClick={handlePublish} className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-[14.5px] font-bold text-primary-foreground">
          Publish Poll
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Poll title</span>
          <div className="rounded-xl border border-border bg-card px-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04)]">
            <input
              value={draft.draft.title}
              onChange={(e) => draft.setTitle(e.target.value)}
              placeholder="e.g. Saturday Lunch Menu"
              className="w-full border-none bg-transparent py-3 text-sm font-semibold text-foreground outline-none"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TITLE_SUGGESTIONS.map((t) => (
              <button key={t} type="button" onClick={() => draft.setTitle(t)} className="rounded-full bg-muted px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Poll type</span>
          <div className="grid grid-cols-2 gap-2">
            {POLL_TYPES.map((t) => {
              const on = draft.draft.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => draft.setType(t)}
                  className={`rounded-xl border py-3 text-center text-[12.5px] font-semibold ${on ? 'border-[1.5px] border-primary bg-secondary text-primary' : 'border-border bg-card text-foreground'}`}
                >
                  {POLL_TYPE_META[t].label}
                </button>
              );
            })}
          </div>
        </div>

        {showOptions && (
          <div>
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Food options</span>
            <Reorder.Group axis="y" values={draft.draft.options} onReorder={draft.reorderOptions} className="flex list-none flex-col gap-2">
              {draft.draft.options.map((o) => (
                <OptionRow
                  key={o.id}
                  option={o}
                  editing={draft.optionEdit === o.id}
                  editText={draft.optionEditText}
                  onEditTextChange={draft.setOptionEditText}
                  onConfirmEdit={() => draft.confirmEditOption(o.id)}
                  onStartEdit={() => draft.startEditOption(o.id, o.name)}
                  onDelete={() => draft.deleteOption(o.id)}
                />
              ))}
            </Reorder.Group>
            <div className="mt-2 flex items-center gap-2 rounded-xl border-[1.4px] border-dashed border-border bg-card py-1.5 pl-3.5 pr-1.5">
              <input
                value={draft.optionText}
                onChange={(e) => draft.setOptionText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && draft.addOption()}
                placeholder="Add another option"
                className="min-w-0 flex-1 border-none bg-transparent text-[13px] font-semibold text-foreground outline-none"
              />
              <button type="button" onClick={draft.addOption} className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <div>
          <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Meal category</span>
          <div className="flex gap-2">
            {MEAL_CATS.map((k) => {
              const on = draft.draft.mealCat === k;
              const meta = MEAL_CATEGORY_META[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => draft.setMealCat(k)}
                  className={`flex-1 rounded-xl border py-2.5 text-center text-[11.5px] font-semibold ${on ? 'border-[1.5px] border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground'}`}
                >
                  <span className="flex justify-center">{(() => { const I = mealIcon(k); return <I className="h-4 w-4" strokeWidth={1.75} />; })()}</span>
                  <span className="mt-0.5 block">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Date</span>
            <input
              type="date"
              value={draft.draft.date}
              onChange={(e) => draft.setDate(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] font-semibold text-foreground shadow-[0_1px_2px_rgba(40,30,20,0.04)] outline-none"
            />
          </div>
          <div className="flex-1">
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Closing time</span>
            <input
              type="time"
              value={draft.draft.closeTime}
              onChange={(e) => draft.setCloseTime(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] font-semibold text-foreground shadow-[0_1px_2px_rgba(40,30,20,0.04)] outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col">
          <Toggle checked={draft.draft.anon} onChange={() => draft.toggle('anon')} label="Anonymous voting" sub="Hide who voted for what" />
          {showOptions && (
            <Toggle checked={draft.draft.multi} onChange={() => draft.toggle('multi')} label="Allow multiple selections" sub="Tenants can pick more than one" />
          )}
          <Toggle checked={draft.draft.notify} onChange={() => draft.toggle('notify')} label="Notify tenants now" sub="Send an in-app alert on publish" />
        </div>
      </div>
    </BottomSheet>
  );
}
