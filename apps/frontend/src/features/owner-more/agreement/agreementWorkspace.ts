/**
 * Workspace state, decided here rather than in the screen.
 *
 * Publishing is the act that changes what tenants sign, so whether it may
 * proceed is a rule with its own tests — not a disabled attribute someone can
 * quietly loosen.
 */

export type PublishInput = {
  hasDraftChanges: boolean;
  /** Tokens Stayo cannot fill, as written by the owner. */
  unknownTokens: string[];
  signatureConfigured: boolean;
  affectedTenants: number;
};

export type PublishReadiness = {
  canPublish: boolean;
  blockers: string[];
  warnings: string[];
};

export function publishReadiness(input: PublishInput): PublishReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.unknownTokens.length > 0) {
    // A typo'd token prints literally on a document somebody signs. This is the
    // one thing worth refusing over.
    const list = input.unknownTokens.join(', ');
    blockers.push(
      input.unknownTokens.length === 1
        ? `${list} is not a value Stayo can fill — it will print exactly as written.`
        : `${list} are not values Stayo can fill — they will print exactly as written.`,
    );
  }

  if (!input.signatureConfigured) {
    // A warning, not a blocker: an unsigned agreement is still a real document,
    // and refusing would strand an owner who has not got to that screen yet.
    warnings.push('Your signature is not set, so agreements will go out unsigned.');
  }

  return {
    canPublish: input.hasDraftChanges && blockers.length === 0,
    blockers,
    warnings,
  };
}

export function saveStateLabel(state: {
  saving: boolean;
  unsaved: boolean;
  hasDraft: boolean;
  savedAt: Date | null;
}): string {
  if (state.saving) return 'Saving…';
  if (state.unsaved) return 'Unsaved changes';
  if (state.savedAt) return 'Draft saved';
  if (state.hasDraft) return 'Unpublished draft';
  return 'Matches the published version';
}

/** "4 tenants will sign this" — or no number at all rather than a wrong one. */
export function blastRadiusLabel(affectedTenants: number | null | undefined): string {
  if (affectedTenants == null || affectedTenants < 0) return 'Future tenants will sign this version.';
  if (affectedTenants === 0) return 'No tenants have signed this document yet.';
  return `${affectedTenants} tenant${affectedTenants === 1 ? '' : 's'} already signed the current version. New tenants will sign this one.`;
}

/**
 * A section's controls, decided here rather than in the row that draws them.
 *
 * [[Decisions#ADR-220|ADR-220]]'s workspace shipped with none of these: the
 * operations existed in `config/agreementDraft.ts`, tested, and nothing on
 * screen called them, so a clause could be reworded but never removed and a
 * section could not be deleted, reordered, highlighted or reset. An owner who
 * emptied a line was left with a numbered blank clause in the signed document,
 * because the composer renders every line a section holds.
 *
 * Availability is a rule, not a style: **an action that cannot do anything is
 * absent rather than present and inert**, which is the same principle `locked`
 * already applies to a fixed commercial term. Hence `reset` only exists when
 * there is Stayo wording to reset *to* — `resetSection` deliberately no-ops on
 * a section the owner wrote themselves, and a button that silently does
 * nothing teaches an owner to distrust the others.
 */
export type SectionActionId = 'moveUp' | 'moveDown' | 'important' | 'include' | 'reset' | 'delete';

export type SectionAction = {
  id: SectionActionId;
  label: string;
  /** Present but refusing, and only where the reason is self-evident (ends of a list). */
  disabled?: boolean;
  destructive?: boolean;
  /** Set when the action loses text. The screen must not run it unaccepted. */
  confirm?: string;
};

export function sectionActions(input: {
  title: string;
  severity?: string | null;
  /** `enabled !== false` — absent means included, for templates predating the flag. */
  enabled: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Whether Stayo ships a default for this section id. */
  hasDefault: boolean;
}): SectionAction[] {
  const actions: SectionAction[] = [
    { id: 'moveUp', label: 'Move up', disabled: input.isFirst },
    { id: 'moveDown', label: 'Move down', disabled: input.isLast },
    {
      id: 'important',
      label: input.severity === 'important' ? 'Remove highlight' : 'Mark important',
    },
    // Keeps the text for later, unlike delete: an owner who drops "Pets" this
    // year and wants it back next year should not have to retype it.
    { id: 'include', label: input.enabled ? 'Leave out' : 'Include again' },
  ];

  if (input.hasDefault) actions.push({ id: 'reset', label: 'Reset wording' });

  actions.push({
    id: 'delete',
    label: 'Delete section',
    destructive: true,
    confirm: `Delete "${input.title}" and everything in it?`,
  });

  return actions;
}

/** The tail of a section's summary line, after "3 lines". */
export function sectionSubtitle(input: { severity?: string | null; enabled: boolean }): string | undefined {
  const parts: string[] = [];
  if (input.severity === 'important') parts.push('shown as a highlight');
  if (!input.enabled) parts.push('not included');
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
