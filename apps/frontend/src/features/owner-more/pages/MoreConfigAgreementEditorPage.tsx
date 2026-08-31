import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, Eye, Pencil } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { configApi } from '../api/configApi';
import { useAgreementTemplate } from '../hooks/useAgreements';
import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import type { RulesContent } from '../config/agreements';
import {
  editLine,
  addLine,
  removeLine,
  moveLine,
  renameSection,
  toggleSection,
  isSectionEnabled,
  toggleImportant,
  resetSection,
  unknownVariables,
  fillVariables,
  hasDraftChanges,
  countEnabledLines,
  AGREEMENT_VARIABLES,
} from '../config/agreementDraft';

const card =
  'overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04)]';

/** Sample values, so a preview reads like a real agreement rather than tokens. */
const SAMPLE: Record<string, string> = {
  '{TENANT_NAME}': 'Ravi Kumar',
  '{MONTHLY_RENT}': '8,000',
  '{SECURITY_DEPOSIT_AMOUNT}': '16,000',
  '{MAINTENANCE_CHARGE_AMOUNT}': '500',
  '{ROOM_NUMBER}': '101',
  '{JOINING_DATE}': '1 September 2026',
  '{HOSTEL_NAME}': 'your hostel',
  '{OWNER_NAME}': 'you',
};

/**
 * Writing the agreement.
 *
 * The screen this replaces rendered the document read-only. Every operation it
 * needed already existed on the backend — `saveAgreementDraft`,
 * `publishAgreementTemplate`, per-section reset — and none was wired, so an
 * owner could look at their agreement and change nothing in it.
 *
 * Lines, not a rich-text box. An agreement is `categories[]` each holding
 * `rules[]`, and every line an owner reads is one of those strings. Flattening
 * that into markup would take three features with it: clause counts,
 * highlights, and "reset this section to Stayo's wording", which needs
 * something to reset *to*. The operations themselves live in
 * `config/agreementDraft.ts`, tested apart from this screen, because a mistake
 * here is a clause missing from a document somebody signed.
 *
 * Draft is the resting state. Edits autosave after a pause; the published
 * version stays live for tenants the whole time, and publishing is one
 * deliberate act that bumps the version.
 */
export function MoreConfigAgreementEditorPage() {
  const hostelId = useConfiguredHostelId();
  const queryClient = useQueryClient();
  const { active, rules, defaultRules, hasDraft, isLoading } = useAgreementTemplate();

  const [draft, setDraft] = useState<RulesContent | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ categoryId: string; index: number } | null>(null);
  const [preview, setPreview] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (rules && !draft) {
      setDraft(rules);
      setOpenSection(rules.categories?.[0]?.id ?? null);
    }
  }, [rules, draft]);

  const saveDraft = useMutation({
    mutationFn: (content: RulesContent) => configApi.saveAgreementDraft(hostelId!, content),
    onSuccess: () => {
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ['owner', 'agreement-template', hostelId] });
    },
    onError: () => stayoToast.error('Could not save — your changes are still on screen'),
  });

  const publish = useMutation({
    mutationFn: () => configApi.publishAgreementTemplate(hostelId!),
    onSuccess: () => {
      stayoToast.success('Published — new tenants sign this version');
      queryClient.invalidateQueries({ queryKey: ['owner', 'agreement-template', hostelId] });
    },
    onError: () => stayoToast.error('Could not publish'),
  });

  /**
   * Autosave after a pause rather than on every keystroke: a legal document is
   * edited in bursts, and a request per character would put dozens of
   * half-finished sentences through the server.
   */
  const change = (next: RulesContent) => {
    setDraft(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (hostelId) saveDraft.mutate(next);
    }, 1200);
  };

  const unknown = useMemo(() => unknownVariables(draft), [draft]);
  const dirty = hasDraftChanges(draft, rules);

  if (isLoading || !draft) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6">
        <MoreScreenHeader title="Agreement" />
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  const categories = draft.categories ?? [];

  return (
    <div className="flex flex-col gap-4 px-4 pb-28 pt-6 sm:px-6">
      <MoreScreenHeader
        title="Agreement"
        subtitle={
          active?.version_number
            ? `Version ${active.version_number} published · ${countEnabledLines(draft)} clauses`
            : `Not published yet · ${countEnabledLines(draft)} clauses`
        }
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {saveDraft.isPending
            ? 'Saving…'
            : savedAt
              ? 'Draft saved'
              : hasDraft
                ? 'Unpublished draft'
                : 'Matches the published version'}
        </span>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground"
        >
          {preview ? <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> : <Eye className="h-3.5 w-3.5" strokeWidth={2} />}
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {unknown.length > 0 && (
        <p className="rounded-xl bg-[#F8EFDC] px-3.5 py-2.5 text-[12px] leading-[1.5] text-[#7A5510]">
          <strong>{unknown.join(', ')}</strong> {unknown.length === 1 ? 'is not a value' : 'are not values'} Stayo can
          fill, so {unknown.length === 1 ? 'it' : 'they'} will print exactly as written. Check the spelling.
        </p>
      )}

      {preview ? (
        /* What a tenant sees, with real numbers in place of the tokens. */
        <div className={`${card} p-5`}>
          {categories.filter(isSectionEnabled).map((c, ci) => (
            <div key={c.id} className={ci === 0 ? '' : 'mt-5'}>
              <h3 className="font-display text-[13.5px] font-bold text-foreground">
                {ci + 1}. {c.title}
              </h3>
              {(c.rules ?? []).map((rule, i) => (
                <p key={i} className="mt-2 text-[12.5px] leading-[1.6] text-foreground/75">
                  {fillVariables(rule, SAMPLE)}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : (
        categories.map((category) => {
          const open = openSection === category.id;
          const enabled = isSectionEnabled(category);
          return (
            <div key={category.id} className={`${card} ${enabled ? '' : 'opacity-60'}`}>
              <button
                type="button"
                onClick={() => setOpenSection(open ? null : category.id)}
                className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-foreground">{category.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {(category.rules ?? []).length} line{(category.rules ?? []).length === 1 ? '' : 's'}
                    {category.severity === 'important' ? ' · shown as a highlight' : ''}
                    {enabled ? '' : ' · not included'}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 flex-none text-muted-foreground/60 transition-transform ${open ? 'rotate-180' : ''}`}
                  strokeWidth={2}
                />
              </button>

              {open && (
                <div className="border-t border-border/60 px-4 py-3">
                  <input
                    value={category.title}
                    onChange={(e) => change(renameSection(draft, category.id, e.target.value))}
                    aria-label="Section title"
                    className="mb-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-semibold text-foreground outline-none focus:border-primary"
                  />

                  {(category.rules ?? []).map((rule, index) => {
                    const isEditing = editing?.categoryId === category.id && editing.index === index;
                    return (
                      <div key={index} className="mb-2.5 rounded-xl bg-secondary/60 p-2.5">
                        {isEditing ? (
                          <textarea
                            autoFocus
                            defaultValue={rule}
                            rows={3}
                            onBlur={(e) => {
                              change(editLine(draft, category.id, index, e.target.value));
                              setEditing(null);
                            }}
                            className="w-full resize-none rounded-lg border border-primary bg-card px-3 py-2 text-[12.5px] leading-[1.55] text-foreground outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditing({ categoryId: category.id, index })}
                            className="block w-full text-left text-[12.5px] leading-[1.55] text-foreground/85"
                          >
                            {rule || <span className="text-muted-foreground">Empty line — tap to write</span>}
                          </button>
                        )}

                        <div className="mt-2 flex items-center gap-1">
                          <IconAction label="Move up" onClick={() => change(moveLine(draft, category.id, index, -1))}>
                            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
                          </IconAction>
                          <IconAction label="Move down" onClick={() => change(moveLine(draft, category.id, index, 1))}>
                            <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} />
                          </IconAction>
                          <IconAction label="Add line below" onClick={() => change(addLine(draft, category.id, index))}>
                            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                          </IconAction>
                          <span className="flex-1" />
                          <IconAction
                            label="Delete line"
                            destructive
                            onClick={() => change(removeLine(draft, category.id, index))}
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                          </IconAction>
                        </div>

                        {isEditing && (
                          /* Inserted, never typed: one mistyped identifier ships a
                             literal {MONTLY_RENT} into a signed agreement. */
                          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                            {AGREEMENT_VARIABLES.map((v) => (
                              <button
                                key={v.token}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  const el = e.currentTarget
                                    .closest('div')
                                    ?.parentElement?.querySelector('textarea') as HTMLTextAreaElement | null;
                                  if (!el) return;
                                  const at = el.selectionStart ?? el.value.length;
                                  el.value = `${el.value.slice(0, at)}${v.token}${el.value.slice(at)}`;
                                  el.focus();
                                  el.setSelectionRange(at + v.token.length, at + v.token.length);
                                }}
                                className="rounded-full bg-primary/10 px-2.5 py-1 text-[10.5px] font-semibold text-primary"
                              >
                                {v.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="mt-1 flex flex-wrap gap-2">
                    <SectionAction onClick={() => change(addLine(draft, category.id, (category.rules ?? []).length - 1))}>
                      <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Add line
                    </SectionAction>
                    <SectionAction onClick={() => change(toggleImportant(draft, category.id))}>
                      {category.severity === 'important' ? 'Remove highlight' : 'Mark important'}
                    </SectionAction>
                    <SectionAction onClick={() => change(toggleSection(draft, category.id))}>
                      {enabled ? 'Leave out' : 'Include again'}
                    </SectionAction>
                    {defaultRules && (
                      <SectionAction onClick={() => change(resetSection(draft, category.id, defaultRules))}>
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} /> Reset wording
                      </SectionAction>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      <div className="fixed inset-x-0 bottom-[68px] border-t border-border bg-card px-4 py-3 sm:px-6">
        <button
          type="button"
          disabled={publish.isPending || saveDraft.isPending || !dirty}
          onClick={() => publish.mutate()}
          className="w-full rounded-[13px] bg-primary py-3 text-[14px] font-bold text-primary-foreground disabled:opacity-50"
        >
          {publish.isPending ? 'Publishing…' : dirty ? 'Publish changes' : 'Nothing to publish'}
        </button>
        <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground">
          Tenants keep signing the published version until you publish.
        </p>
      </div>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card ${
        destructive ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function SectionAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] font-semibold text-foreground/80"
    >
      {children}
    </button>
  );
}
