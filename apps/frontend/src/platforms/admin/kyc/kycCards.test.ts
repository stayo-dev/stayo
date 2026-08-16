import { describe, it, expect } from 'vitest';
import { groupDocumentsByOwner } from './kycCards';

const docs = [
  {
    id: 'd1', doc_type: 'PAN', status: 'PENDING', uploaded_at: '2026-08-16T09:00:00Z',
    profile: { id: 'p1', name: 'Meghana Rao', phone: '+919000011223', email: null },
  },
  {
    id: 'd2', doc_type: 'AADHAAR', status: 'PENDING', uploaded_at: '2026-08-16T10:00:00Z',
    profile: { id: 'p1', name: 'Meghana Rao', phone: '+919000011223', email: null },
  },
  {
    id: 'd3', doc_type: 'PAN', status: 'PENDING', uploaded_at: '2026-08-15T10:00:00Z',
    profile: { id: 'p2', name: 'Faizan Ahmed', phone: null, email: 'f@urbanstay.co' },
  },
] as any[];

describe('groupDocumentsByOwner', () => {
  it('produces one card per owner, not one per document', () => {
    expect(groupDocumentsByOwner(docs)).toHaveLength(2);
  });

  it('collects every document belonging to that owner', () => {
    const card = groupDocumentsByOwner(docs).find((c) => c.profileId === 'p1');
    expect(card?.docs.map((d) => d.docType).sort()).toEqual(['AADHAAR', 'PAN']);
  });

  it('orders owners by their most recent submission first', () => {
    expect(groupDocumentsByOwner(docs).map((c) => c.profileId)).toEqual(['p1', 'p2']);
  });

  it('falls back to email when the owner has no phone', () => {
    const card = groupDocumentsByOwner(docs).find((c) => c.profileId === 'p2');
    expect(card?.contact).toBe('f@urbanstay.co');
  });

  it('prefers phone when both are present', () => {
    const card = groupDocumentsByOwner(docs).find((c) => c.profileId === 'p1');
    expect(card?.contact).toBe('+919000011223');
  });

  it('derives initials for the avatar', () => {
    const card = groupDocumentsByOwner(docs).find((c) => c.profileId === 'p2');
    expect(card?.initials).toBe('FA');
  });

  it('returns an empty list rather than throwing when nothing is pending', () => {
    expect(groupDocumentsByOwner([])).toEqual([]);
  });
});
