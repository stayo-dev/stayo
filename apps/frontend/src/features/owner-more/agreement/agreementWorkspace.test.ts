import { describe, expect, it } from 'vitest';
import { blastRadiusLabel, publishReadiness, saveStateLabel } from './agreementWorkspace';

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
