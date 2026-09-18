/**
 * The agreement's version history — what each version is called, and what an
 * owner is told before bringing an old one back.
 *
 * ## Why the copy lives here
 *
 * The rest of this feature keeps rules out of the screen so they can be
 * stated and tested. The same applies to these sentences, and more so: the
 * whole reason an owner wants version history is the fear that changing a
 * legal document is irreversible, and a confirmation that answers the wrong
 * fear — or answers it second — is the difference between a feature that
 * reassures and one that frightens. That ordering is a decision, so it is
 * written down and tested rather than typed into JSX.
 */

export type AgreementVersion = {
  id: string;
  version_number: number;
  /** The wording new tenants sign right now. */
  is_live: boolean;
  published_at: string | null;
  agreements_count: number;
  /** From the server: "1 added · 2 reworded", or "First version". */
  change_summary: string;
};

/**
 * How many tenants hold this exact wording.
 *
 * Shown on every row because it is what makes a version concrete. "Version 2"
 * is a row in a list; "14 tenants signed this" is a document with consequences,
 * and an owner about to revert should feel the difference.
 */
export function signedLabel(count: number): string {
  if (count <= 0) return 'No tenants signed this version';
  return `${count} tenant${count === 1 ? '' : 's'} signed this`;
}

/** Matches the date format the rest of the owner app uses: "12 Sep 2026". */
export function publishedLabel(publishedAt: string | null | undefined): string | null {
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Published ${date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

/**
 * Only a version that is not already live can be brought back.
 *
 * The same principle the section controls follow: an action that cannot do
 * anything is absent, not present and inert.
 */
export function canRestore(version: Pick<AgreementVersion, 'is_live'>): boolean {
  return !version.is_live;
}

export type RestoreConfirmation = {
  title: string;
  /** In order of what the owner is actually afraid of. */
  lines: string[];
  confirmLabel: string;
};

/**
 * What an owner reads before reusing an old version's wording.
 *
 * Ordered deliberately: the two reassurances come before the one real cost.
 * An owner reverting a legal document is asking "what does this break?", and
 * the honest answer is *nothing that has been signed* — so that is said first,
 * not buried under a warning about their draft. The cost is stated plainly,
 * and only when there is a draft to lose.
 */
export function restoreConfirmation(input: {
  versionNumber: number;
  hasDraftEdits: boolean;
}): RestoreConfirmation {
  const lines = [
    'It goes into your draft — nothing changes for tenants until you publish.',
    'No signed agreement is affected. Every tenant keeps the version they signed.',
  ];
  if (input.hasDraftEdits) lines.push('The draft you are working on now will be replaced.');

  return {
    title: `Use version ${input.versionNumber}'s wording?`,
    lines,
    // Names where the wording lands, not the act. "Restore" would imply the
    // document had already changed.
    confirmLabel: 'Load into draft',
  };
}
