import { describe, expect, it } from 'vitest';
import { flattenQueue, currentItem, queueProgress, upNext } from './reviewQueue';
import type { PendingTenantGroup } from './kycDocuments';

const groups: PendingTenantGroup[] = [
  {
    tenantId: 't-old',
    tenantName: 'Locus',
    roomNo: '101',
    hostelName: 'Sri Adithya Boys Hostel',
    waitingSince: '2026-09-01T00:00:00.000Z',
    documents: [
      { id: 'd1', docType: 'AADHAAR', downloadUrl: '/d1', uploadedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'd2', docType: 'COLLEGE_ID', downloadUrl: '/d2', uploadedAt: '2026-09-02T00:00:00.000Z' },
    ],
  },
  {
    tenantId: 't-new',
    tenantName: 'Shiva',
    roomNo: '401',
    hostelName: 'Sri Adithya Boys Hostel',
    waitingSince: '2026-09-10T00:00:00.000Z',
    documents: [{ id: 'd3', docType: 'AADHAAR', downloadUrl: '/d3', uploadedAt: '2026-09-10T00:00:00.000Z' }],
  },
];

describe('flattenQueue', () => {
  it('keeps the tenant order (longest-waiting first) and each tenant’s documents together', () => {
    expect(flattenQueue(groups).map((i) => i.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('carries who the document belongs to, so the owner can check the name matches', () => {
    expect(flattenQueue(groups)[2]).toMatchObject({ tenantId: 't-new', tenantName: 'Shiva', roomNo: '401' });
  });

  it('is empty when nothing is pending', () => {
    expect(flattenQueue([])).toEqual([]);
    expect(flattenQueue(undefined)).toEqual([]);
  });
});

describe('currentItem — advancing without waiting for the server', () => {
  const queue = flattenQueue(groups);

  it('starts at the first document', () => {
    expect(currentItem(queue, new Set())?.id).toBe('d1');
  });

  it('moves on as soon as a decision is made, before the refetch lands', () => {
    expect(currentItem(queue, new Set(['d1']))?.id).toBe('d2');
    expect(currentItem(queue, new Set(['d1', 'd2']))?.id).toBe('d3');
  });

  it('honours a document the owner picked from the up-next list', () => {
    expect(currentItem(queue, new Set(), 'd3')?.id).toBe('d3');
  });

  it('ignores a picked document that has since been decided', () => {
    expect(currentItem(queue, new Set(['d3']), 'd3')?.id).toBe('d1');
  });

  it('is null once everything is decided — the finished state', () => {
    expect(currentItem(queue, new Set(['d1', 'd2', 'd3']))).toBeNull();
  });
});

describe('queueProgress', () => {
  it('counts what is left and which one this is', () => {
    const queue = flattenQueue(groups);
    expect(queueProgress(queue, new Set(['d1']))).toEqual({ remaining: 2, tenants: 2, decided: 1 });
    expect(queueProgress(queue, new Set(['d1', 'd2']))).toEqual({ remaining: 1, tenants: 1, decided: 2 });
  });
});

describe('upNext', () => {
  it('lists the rest, not the one on screen and not decided ones', () => {
    const queue = flattenQueue(groups);
    expect(upNext(queue, new Set(['d1']), 'd2').map((i) => i.id)).toEqual(['d3']);
  });
});
