import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, History, Pencil, Plus } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { AgreementDocumentView } from '@features/agreements/document/AgreementDocumentView';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { configApi } from '../api/configApi';
import { useAgreementTemplate, useAgreementTemplates } from '../hooks/useAgreements';
import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import type { RulesContent } from '../config/agreements';
import {
  addLine,
  addSection,
  countEnabledLines,
  editLine,
  editTerm,
  hasDraftChanges,
  isSectionEnabled,
  moveLine,
  moveSection,
  removeLine,
  removeSection,
  renameSection,
  resetSection,
  toggleImportant,
  toggleSection,
  unknownVariables,
} from '../config/agreementDraft';
import { SectionRow } from './SectionRow';
import { PublishReviewSheet } from './PublishReviewSheet';
import { VersionHistorySheet } from './VersionHistorySheet';
import { diffAgreementDocument } from './agreementDiff';
import {
  publishReadiness,
  saveStateLabel,
  sectionActions,
  sectionSubtitle,
  type SectionActionId,
} from './agreementWorkspace';
import { fetchOwnerAgreementDocument, downloadSampleAgreementPdf, ownerAgreementKeys } from './ownerAgreementApi';

/**
 * Configuration › Agreements — one place to write the agreement.
 *
 * This replaces five screens. An owner previously went More → Configuration →
 * Agreements → Agreement → a template card → Template → "Edit this agreement"
 * to change a sentence, across two screens that wrote the same
 * `rules_content` with different save semantics.
 *
 * **Write** is the document's sections. **Read** is the real composed
 * document — the same `AgreementDocument` the tenant reads and the PDF is made
 * from, fetched from the server rather than approximated here. That is the
 * point: the editor's own preview used to omit the preamble, the standard legal
 * clauses, the execution statement and the signature block, so an owner
 * approved one document and issued another.
 *
 * See ADR-220.
 */
export function AgreementWorkspacePage() {
  const hostelId = useConfiguredHostelId();
  const queryClient = useQueryClient();
  const { active, rules, defaultRules, hasDraft, signatureConfigured, isLoading } = useAgreementTemplate();
  const { templates } = useAgreementTemplates();

  const [segment, setSegment] = useState<'write' | 'read'>('write');
  const [draft, setDraft] = useState<RulesContent | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
    // Publishes exactly what is on screen: the route resolves
    // `rules_content || DEFAULT_AGREEMENT_TEMPLATE` and deletes the draft in
    // the same transaction, so publishing without the content would throw the
    // owner's work away and publish Stayo's stock template over it.
    mutationFn: (content: RulesContent) => configApi.publishAgreementTemplate(hostelId!, content),
    onSuccess: () => {
      setReviewOpen(false);
      stayoToast.success('Published — new tenants sign this version');
      queryClient.invalidateQueries({ queryKey: ['owner', 'agreement-template', hostelId] });
      queryClient.invalidateQueries({ queryKey: ['owner', 'agreement-templates', hostelId] });
    },
    onError: () => stayoToast.error('Could not publish'),
  });

  /**
   * Throw the draft away and go back to what is live.
   *
   * The editor autosaves, so before this existed an owner who changed their
   * mind had no way back except retyping the published wording from memory.
   */
  const discardDraft = useMutation({
    mutationFn: () => configApi.discardAgreementDraft(hostelId!),
    onSuccess: () => {
      setDraft((active?.rules_content as RulesContent) ?? null);
      setSavedAt(null);
      stayoToast.success('Draft discarded — back to the published version');
      queryClient.invalidateQueries({ queryKey: ['owner', 'agreement-template', hostelId] });
      queryClient.invalidateQueries({ queryKey: ['owner', 'agreement-templates', hostelId] });
    },
    onError: () => stayoToast.error('Could not discard the draft'),
  });

  /** Autosave after a pause: a legal document is edited in bursts. */
  const change = (next: RulesContent) => {
    setDraft(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (hostelId) saveDraft.mutate(next);
    }, 1200);
  };

  /**
   * One section action to one draft operation.
   *
   * The screen decides nothing here: which actions exist, how they are
   * labelled and which one needs confirming all come from `sectionActions`,
   * and every branch below is a call into the tested `agreementDraft` module.
   */
  const runSectionAction = (categoryId: string, id: SectionActionId) => {
    if (!draft) return;
    switch (id) {
      case 'moveUp':
        return change(moveSection(draft, categoryId, -1));
      case 'moveDown':
        return change(moveSection(draft, categoryId, 1));
      case 'important':
        return change(toggleImportant(draft, categoryId));
      case 'include':
        return change(toggleSection(draft, categoryId));
      case 'reset':
        return change(resetSection(draft, categoryId, defaultRules));
      case 'delete':
        // Confirmed in `SectionRow` from the action's own `confirm` text.
        setOpenSection(null);
        return change(removeSection(draft, categoryId));
    }
  };

  // The composed document, from the server. Keyed on the draft so the Read
  // segment always shows what is currently written.
  const draftKey = useMemo(() => JSON.stringify(draft ?? {}), [draft]);
  const { data: document } = useQuery({
    queryKey: ownerAgreementKeys.document(hostelId, draftKey),
    queryFn: () => fetchOwnerAgreementDocument(hostelId!, draft, active?.version_number),
    enabled: Boolean(hostelId && draft),
  });
  const { data: publishedDocument } = useQuery({
    queryKey: ownerAgreementKeys.document(hostelId, 'published'),
    queryFn: () => fetchOwnerAgreementDocument(hostelId!, active?.rules_content ?? null, active?.version_number),
    enabled: Boolean(hostelId && active?.rules_content),
  });

  /**
   * How many tenants signed the version this would replace.
   *
   * Matched on the active template's id rather than the first row of the list:
   * that list is ordered `status: "asc"` and `TemplateStatus` begins at DRAFT,
   * so the first row is a draft whose `agreements_count` is always 0 — every
   * owner would have been told nobody had signed. `null` when it cannot be
   * determined, so the sheet says "future tenants" rather than inventing a
   * number.
   */
  const affectedTenants =
    templates.find((t) => t.id === active?.id)?.agreements_count ?? null;

  const unknown = useMemo(() => unknownVariables(draft), [draft]);
  const unsaved = hasDraftChanges(draft, rules);
  const diff = useMemo(
    () => diffAgreementDocument(publishedDocument ?? null, document ?? null),
    [publishedDocument, document],
  );
  const readiness = publishReadiness({
    hasDraftChanges: hasDraft || hasDraftChanges(draft, active?.rules_content ?? null),
    unknownTokens: unknown,
    signatureConfigured,
    affectedTenants: affectedTenants ?? 0,
  });

  if (isLoading || !draft) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6">
        <MoreScreenHeader title="Agreement" />
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  const categories = draft.categories ?? [];
  const terms = ((draft as any).terms_and_conditions ?? []) as Array<{ id: string; title: string; content: string }>;

  return (
    <div className="flex flex-col gap-4 px-4 pb-40 pt-6 sm:px-6">
      <MoreScreenHeader
        title="Agreement"
        subtitle={
          active?.version_number
            ? `Version ${active.version_number} · ${countEnabledLines(draft)} clauses`
            : `Not published yet · ${countEnabledLines(draft)} clauses`
        }
      />

      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11.5px] font-medium text-muted-foreground">
            {saveStateLabel({ saving: saveDraft.isPending, unsaved, hasDraft, savedAt })}
          </span>
          {/* Only offered when there is something to throw away. */}
          {(hasDraft || unsaved) && (
            <button
              type="button"
              disabled={discardDraft.isPending}
              onClick={() => {
                if (!window.confirm('Discard this draft and go back to the published version?')) return;
                discardDraft.mutate();
              }}
              className="flex-none text-[11.5px] font-semibold text-muted-foreground underline underline-offset-2 disabled:opacity-50"
            >
              Discard
            </button>
          )}
        </span>

        <div className="flex flex-none items-center gap-2">
          {/*
            History is a permanent, visible affordance rather than something in
            a menu. Most of its value is delivered to owners who never open it:
            the reason they want version history is the fear that editing a
            legal document is irreversible, and seeing that every version is
            kept answers that before they ever need it to.
          */}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground"
          >
            <History className="h-3.5 w-3.5" strokeWidth={2} />
            History
          </button>

        <div className="flex rounded-full border border-border p-0.5 lg:hidden">
          {(['write', 'read'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSegment(s)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                segment === s ? 'bg-primary text-primary-foreground' : 'text-foreground'
              }`}
            >
              {s === 'write' ? <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> : <Eye className="h-3.5 w-3.5" strokeWidth={2} />}
              {s === 'write' ? 'Write' : 'Read'}
            </button>
          ))}
        </div>
        </div>
      </div>

      {unknown.length > 0 && (
        <p className="rounded-xl bg-[color:var(--warning)]/12 px-3.5 py-2.5 text-[12px] leading-[1.5] text-[color:var(--warning)]">
          <strong>{unknown.join(', ')}</strong> {unknown.length === 1 ? 'is not a value' : 'are not values'} Stayo can
          fill, so {unknown.length === 1 ? 'it' : 'they'} will print exactly as written. Check the spelling.
        </p>
      )}

      {/* Below lg the segmented control picks one pane. At lg both are shown
          side by side — the same code serving a laptop properly rather than a
          stretched phone screen. Visibility is a class rather than a ternary so
          neither pane unmounts when the breakpoint changes. */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        {/* Write */}
        <div className={`${segment === 'write' ? '' : 'hidden'} flex flex-col gap-4 lg:order-1 lg:flex`}>
          <section className="flex flex-col gap-2.5">
            <h2 className="pl-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Your terms
            </h2>
            <p className="pl-0.5 text-[11.5px] leading-[1.5] text-muted-foreground">
              The commercial terms of your agreement. Write them in your own words — the headings stay
              the same so every agreement you issue can be compared.
            </p>
            {terms.map((term) => (
              <SectionRow
                key={term.id}
                title={term.title}
                subtitle="heading fixed"
                locked
                lines={[term.content]}
                open={openSection === term.id}
                onToggle={() => setOpenSection(openSection === term.id ? null : term.id)}
                onEditLine={(_i, text) => change(editTerm(draft, term.id, text))}
              />
            ))}
          </section>

          <section className="flex flex-col gap-2.5">
            <h2 className="pl-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Your rules
            </h2>
            {categories.map((category, index) => {
              const enabled = isSectionEnabled(category);
              return (
                <SectionRow
                  key={category.id}
                  title={category.title}
                  subtitle={sectionSubtitle({ severity: category.severity, enabled })}
                  dimmed={!enabled}
                  lines={category.rules ?? []}
                  open={openSection === category.id}
                  actions={sectionActions({
                    title: category.title,
                    severity: category.severity,
                    enabled,
                    isFirst: index === 0,
                    isLast: index === categories.length - 1,
                    // `resetSection` leaves a section we ship no default for
                    // untouched, so the action is absent rather than inert.
                    hasDefault: (defaultRules?.categories ?? []).some((c) => c.id === category.id),
                  })}
                  onToggle={() => setOpenSection(openSection === category.id ? null : category.id)}
                  onEditLine={(i, text) => change(editLine(draft, category.id, i, text))}
                  onAddLine={() => change(addLine(draft, category.id, (category.rules ?? []).length - 1))}
                  onRemoveLine={(i) => change(removeLine(draft, category.id, i))}
                  onMoveLine={(i, direction) => change(moveLine(draft, category.id, i, direction))}
                  onRename={(title) => change(renameSection(draft, category.id, title))}
                  onAction={(id) => runSectionAction(category.id, id)}
                />
              );
            })}

            <button
              type="button"
              onClick={() => {
                const next = addSection(draft);
                change(next);
                setOpenSection(next.categories?.[next.categories.length - 1]?.id ?? null);
              }}
              className="flex items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-card py-3 text-[13px] font-semibold text-foreground"
            >
              <Plus className="h-4 w-4" strokeWidth={2} /> Add your own section
            </button>
          </section>

          {/* Named, not hidden: an owner should know these clauses are in their
              agreement and why they cannot edit them. */}
          <p className="rounded-xl border border-border bg-secondary/40 px-3.5 py-3 text-[11.5px] leading-[1.55] text-muted-foreground">
            Every agreement also carries the standard legal clauses — entire agreement, amendment,
            severability, governing law and stamp duty — plus the execution statement and signature
            panel. They are fixed so that every Stayo agreement is a complete instrument. Switch to
            Read to see them.
          </p>
        </div>

        {/* Read */}
        <div className={`${segment === 'read' ? '' : 'hidden'} lg:order-2 lg:block`}>
          <div className="lg:sticky lg:top-4">
            <div className="rounded-[20px] border border-border bg-card p-5 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
              {document ? (
                <AgreementDocumentView doc={document} />
              ) : (
                <div className="h-72 animate-pulse rounded-xl bg-muted" />
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const blob = await downloadSampleAgreementPdf(hostelId!, draft);
                  const url = URL.createObjectURL(blob);
                  window.open(url, '_blank', 'noopener');
                } catch {
                  stayoToast.error('Could not build the sample PDF');
                }
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-[13px] border border-border py-3 text-[13px] font-semibold text-foreground"
            >
              <Download className="h-4 w-4" strokeWidth={2} />
              Download a sample PDF
            </button>
          </div>
        </div>
      </div>


      {/*
        Sits *on top of* the owner tab bar, not under it. `bottom-0` put it
        behind a `fixed bottom-0 z-40` nav, so an owner who changed something
        saw an orange sliver above Home/Tenants/Money and never reached
        Publish. Offsets match `components/SaveBar.tsx`, the same feature's
        existing bottom bar: 4.5rem is the nav's height (`OwnerAppShell` pads
        its main by the same amount), and at `lg` the console shell drops the
        nav entirely, so the bar returns to the bottom edge.
      */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-[480px] sm:px-6 lg:bottom-0 lg:max-w-[760px]">
        <button
          type="button"
          disabled={!readiness.canPublish}
          onClick={() => setReviewOpen(true)}
          className="w-full rounded-[13px] bg-primary py-3 text-[14px] font-bold text-primary-foreground disabled:opacity-50"
        >
          {readiness.canPublish ? 'Review and publish' : 'Nothing to publish'}
        </button>
        <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground">
          Tenants keep signing the published version until you publish.
        </p>
      </div>

      {historyOpen && hostelId && (
        <VersionHistorySheet
          hostelId={hostelId}
          liveVersionNumber={active?.version_number ?? null}
          hasDraftEdits={hasDraft || unsaved}
          onClose={() => setHistoryOpen(false)}
          onUseVersion={(content) => {
            // Lands in the draft and autosaves, exactly like any other edit.
            // Publishing stays the one deliberate act that changes what
            // tenants sign, and the review sheet will show the diff against
            // the live version before it does.
            change(content);
            setOpenSection(content.categories?.[0]?.id ?? null);
            setHistoryOpen(false);
            stayoToast.success('Loaded into your draft — publish when you are ready');
          }}
        />
      )}

      {reviewOpen && (
        <PublishReviewSheet
          diff={diff}
          readiness={readiness}
          affectedTenants={affectedTenants}
          publishing={publish.isPending}
          onCancel={() => setReviewOpen(false)}
          onConfirm={() => draft && publish.mutate(draft)}
        />
      )}
    </div>
  );
}
