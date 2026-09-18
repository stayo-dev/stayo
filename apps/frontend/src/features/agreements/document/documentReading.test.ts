import { describe, expect, it } from 'vitest';
import {
  anchorIdFor,
  clauseCount,
  gateState,
  highlightTitles,
  isReadComplete,
  readProgress,
  sectionIndex,
} from './documentReading';
import type { AgreementDocument } from './agreementDocument';

const doc = {
  reference: 'AGR-42',
  contentHash: 'a'.repeat(64),
  blocks: [
    { kind: 'title', text: 'HOSTEL ACCOMMODATION AGREEMENT' },
    { kind: 'preamble', text: 'This Agreement is made…' },
    { kind: 'facts', rows: [{ label: 'Room', value: '101' }] },
    { kind: 'section', number: 1, title: 'Notice Period', clauses: [{ number: '1', text: 'Thirty days.' }], origin: 'owner', band: 'terms' },
    { kind: 'section', number: 2, title: 'Fees', clauses: [{ number: '2.1', text: 'Due on the 5th.' }, { number: '2.2', text: 'No refunds.' }], origin: 'owner', band: 'rules', severity: 'important' },
    { kind: 'section', number: 3, title: 'Severability', clauses: [{ number: '3', text: 'Remaining clauses continue.' }], origin: 'platform', band: 'terms' },
    { kind: 'execution', text: 'IN WITNESS WHEREOF' },
  ],
  meta: { hostelName: 'H', ownerName: 'O', tenantName: 'T', versionNumber: 3, generatedAt: '', status: 'DRAFT' },
} as unknown as AgreementDocument;

describe('sectionIndex', () => {
  it('lists only section blocks, in document order', () => {
    expect(sectionIndex(doc).map((s) => s.title)).toEqual(['Notice Period', 'Fees', 'Severability']);
  });

  it('gives each section an anchor id matching anchorIdFor', () => {
    expect(sectionIndex(doc).map((s) => s.anchorId)).toEqual([
      anchorIdFor(1), anchorIdFor(2), anchorIdFor(3),
    ]);
  });

  it('keeps the platform sections, because the tenant reads one contract', () => {
    expect(sectionIndex(doc).some((s) => s.origin === 'platform')).toBe(true);
  });

  it('is empty rather than throwing for a document that has not loaded', () => {
    expect(sectionIndex(null)).toEqual([]);
    expect(sectionIndex(undefined)).toEqual([]);
  });
});

describe('highlightTitles', () => {
  it('returns only the sections the owner marked important', () => {
    expect(highlightTitles(doc)).toEqual(['Fees']);
  });

  it('is empty when nothing is marked', () => {
    expect(highlightTitles(null)).toEqual([]);
  });
});

describe('clauseCount', () => {
  it('counts every clause across every section', () => {
    expect(clauseCount(doc)).toBe(4);
  });

  it('is zero for a document that has not loaded', () => {
    expect(clauseCount(null)).toBe(0);
  });
});

describe('readProgress', () => {
  it('is 0 at the top', () => {
    expect(readProgress(0, 2000, 800)).toBe(0);
  });

  it('is 1 at the bottom', () => {
    expect(readProgress(1200, 2000, 800)).toBe(1);
  });

  it('is 0.5 halfway through the scrollable distance', () => {
    expect(readProgress(600, 2000, 800)).toBeCloseTo(0.5);
  });

  it('is 1 when the document is shorter than the viewport', () => {
    // Nothing to scroll means it has been read, not that it never can be --
    // otherwise a short agreement could never satisfy the gate.
    expect(readProgress(0, 500, 800)).toBe(1);
  });

  it('never exceeds 1 on elastic overscroll', () => {
    expect(readProgress(5000, 2000, 800)).toBe(1);
  });

  it('never goes below 0 on rubber-band scroll above the top', () => {
    expect(readProgress(-120, 2000, 800)).toBe(0);
  });
});

describe('isReadComplete', () => {
  it('accepts a near-bottom position, because exact equality never fires on real devices', () => {
    expect(isReadComplete(0.99)).toBe(true);
  });

  it('rejects a partial read', () => {
    expect(isReadComplete(0.62)).toBe(false);
  });

  it('rejects a read that stopped just short', () => {
    expect(isReadComplete(0.97)).toBe(false);
  });
});

describe('gateState', () => {
  const ready = { readCompleted: true, hasTenantSignature: true, hasTenantName: true };

  it('blocks signing before the document has been read', () => {
    expect(gateState({ ...ready, readCompleted: false }))
      .toEqual({ canSign: false, reason: 'Read the full agreement first' });
  });

  it('blocks signing without a tenant signature', () => {
    expect(gateState({ ...ready, hasTenantSignature: false }))
      .toEqual({ canSign: false, reason: 'Your signature is required' });
  });

  it('blocks signing without a typed name', () => {
    expect(gateState({ ...ready, hasTenantName: false }))
      .toEqual({ canSign: false, reason: 'Type your full name to sign' });
  });

  it('allows signing once the document is read and signed', () => {
    expect(gateState(ready)).toEqual({ canSign: true, reason: null });
  });

  it('does not accept a guardian signature in place of the tenant"s', () => {
    // "tenant, guardian, or both" is exactly what let a tenancy be activated
    // with no signature from the person living there.
    expect(gateState({ ...ready, hasTenantSignature: false, hasGuardianSignature: true, hasGuardianName: true }).canSign)
      .toBe(false);
  });

  it('requires a guardian co-signature when the hostel asks for one', () => {
    expect(gateState({ ...ready, guardianRequired: true }))
      .toEqual({ canSign: false, reason: 'This hostel requires a parent or guardian co-signature' });
  });

  it('requires the guardian"s typed name too', () => {
    expect(gateState({ ...ready, guardianRequired: true, hasGuardianSignature: true }))
      .toEqual({ canSign: false, reason: "Type your guardian's full name to sign" });
  });

  it('allows signing with a complete guardian co-signature when required', () => {
    expect(gateState({ ...ready, guardianRequired: true, hasGuardianSignature: true, hasGuardianName: true }))
      .toEqual({ canSign: true, reason: null });
  });

  it('ignores guardian fields when the hostel does not require one', () => {
    expect(gateState({ ...ready, guardianRequired: false })).toEqual({ canSign: true, reason: null });
  });

  it('names the next thing to fix, not the last thing that failed', () => {
    // Nothing done at all -> the reason is the read, which comes first.
    expect(gateState({ readCompleted: false, hasTenantSignature: false, hasTenantName: false }).reason)
      .toBe('Read the full agreement first');
  });
});
