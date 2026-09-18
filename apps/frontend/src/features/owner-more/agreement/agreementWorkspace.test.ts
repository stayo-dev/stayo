import { describe, expect, it } from 'vitest';
import {
  blastRadiusLabel,
  publishReadiness,
  saveStateLabel,
  sectionActions,
  sectionSubtitle,
} from './agreementWorkspace';

describe('publishReadiness', () => {
  const ok = { hasDraftChanges: true, unknownTokens: [], signatureConfigured: true, affectedTenants: 4 };

  it('allows publishing a changed, valid draft', () => {
    expect(publishReadiness(ok)).toEqual({ canPublish: true, blockers: [], warnings: [] });
  });

  it('has nothing to publish when the draft matches what is live', () => {
    expect(publishReadiness({ ...ok, hasDraftChanges: false }).canPublish).toBe(false);
  });

  it('blocks on an unknown token, naming it', () => {
    const r = publishReadiness({ ...ok, unknownTokens: ['{{MONTLY_RENT}}'] });
    expect(r.canPublish).toBe(false);
    expect(r.blockers.join(' ')).toContain('MONTLY_RENT');
  });

  it('names every offending token, not just the first', () => {
    const r = publishReadiness({ ...ok, unknownTokens: ['{{A}}', '{{B}}'] });
    expect(r.blockers.join(' ')).toContain('A');
    expect(r.blockers.join(' ')).toContain('B');
  });

  it('warns but does not block when the signature is missing', () => {
    const r = publishReadiness({ ...ok, signatureConfigured: false });
    expect(r.canPublish).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it('reports a blocker and a warning together', () => {
    const r = publishReadiness({ ...ok, unknownTokens: ['{{X}}'], signatureConfigured: false });
    expect(r.blockers).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
  });

  it('still refuses an unchanged draft even when everything else is fine', () => {
    expect(publishReadiness({ ...ok, hasDraftChanges: false, signatureConfigured: true }).canPublish)
      .toBe(false);
  });
});

describe('saveStateLabel', () => {
  it('says saving while a save is in flight', () => {
    expect(saveStateLabel({ saving: true, unsaved: true, hasDraft: true, savedAt: null })).toBe('Saving…');
  });

  it('says unsaved changes when edits have not landed', () => {
    expect(saveStateLabel({ saving: false, unsaved: true, hasDraft: true, savedAt: null })).toBe('Unsaved changes');
  });

  it('says draft saved once a save has landed', () => {
    expect(saveStateLabel({ saving: false, unsaved: false, hasDraft: true, savedAt: new Date() })).toBe('Draft saved');
  });

  it('distinguishes an unpublished draft from an unsaved one', () => {
    expect(saveStateLabel({ saving: false, unsaved: false, hasDraft: true, savedAt: null })).toBe('Unpublished draft');
  });

  it('says it matches the published version when there is no draft', () => {
    expect(saveStateLabel({ saving: false, unsaved: false, hasDraft: false, savedAt: null }))
      .toBe('Matches the published version');
  });
});

describe('blastRadiusLabel', () => {
  it('counts the tenants already on the current version', () => {
    expect(blastRadiusLabel(4)).toContain('4 tenants');
  });

  it('uses the singular for one', () => {
    expect(blastRadiusLabel(1)).toContain('1 tenant ');
  });

  it('says so plainly when nobody has signed yet', () => {
    expect(blastRadiusLabel(0)).toBe('No tenants have signed this document yet.');
  });

  it('gives no number rather than a wrong one when the count is unknown', () => {
    expect(blastRadiusLabel(null)).toBe('Future tenants will sign this version.');
    expect(blastRadiusLabel(undefined)).toBe('Future tenants will sign this version.');
  });
});

describe('sectionActions', () => {
  const base = {
    title: 'Fee Structure',
    severity: 'standard',
    enabled: true,
    isFirst: false,
    isLast: false,
    hasDefault: true,
  };
  const ids = (i: Partial<typeof base> = {}) => sectionActions({ ...base, ...i }).map((a) => a.id);
  const find = (id: string, i: Partial<typeof base> = {}) =>
    sectionActions({ ...base, ...i }).find((a) => a.id === id)!;

  it('offers every operation the draft module supports', () => {
    expect(ids()).toEqual(['moveUp', 'moveDown', 'important', 'include', 'reset', 'delete']);
  });

  it('omits reset where there is no Stayo wording to reset to', () => {
    // `resetSection` no-ops on a section the owner wrote. A button that
    // silently does nothing teaches an owner to distrust the others.
    expect(ids({ hasDefault: false })).not.toContain('reset');
  });

  it('refuses to move the first section up and the last one down', () => {
    expect(find('moveUp', { isFirst: true }).disabled).toBe(true);
    expect(find('moveDown', { isFirst: true }).disabled).toBe(false);
    expect(find('moveDown', { isLast: true }).disabled).toBe(true);
  });

  it('flips the highlight label to match the current state', () => {
    expect(find('important').label).toBe('Mark important');
    expect(find('important', { severity: 'important' }).label).toBe('Remove highlight');
  });

  it('flips leave-out to include-again once a section is excluded', () => {
    expect(find('include').label).toBe('Leave out');
    expect(find('include', { enabled: false }).label).toBe('Include again');
  });

  it('marks delete destructive and names the section in its confirmation', () => {
    // The one operation here that loses text. "Leave out" exists for
    // everything short of it.
    const del = find('delete');
    expect(del.destructive).toBe(true);
    expect(del.confirm).toContain('Fee Structure');
  });

  it('asks for confirmation on nothing but delete', () => {
    expect(sectionActions(base).filter((a) => a.confirm).map((a) => a.id)).toEqual(['delete']);
  });
});

describe('sectionSubtitle', () => {
  it('says nothing about an ordinary, included section', () => {
    expect(sectionSubtitle({ severity: 'standard', enabled: true })).toBeUndefined();
  });

  it('names a highlight', () => {
    expect(sectionSubtitle({ severity: 'important', enabled: true })).toBe('shown as a highlight');
  });

  it('names an excluded section, so a dimmed card is not the only clue', () => {
    expect(sectionSubtitle({ severity: 'standard', enabled: false })).toBe('not included');
  });

  it('reports both at once', () => {
    expect(sectionSubtitle({ severity: 'important', enabled: false }))
      .toBe('shown as a highlight · not included');
  });
});
