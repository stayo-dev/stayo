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
