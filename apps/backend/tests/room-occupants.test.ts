import { describe, expect, it, vi } from 'vitest';

// Pure: the email helper's module imports the client, and nothing here queries it.
vi.mock('@/lib/db', () => ({ prisma: {} }));
import { activeOccupant, invitedOccupantsFromReservations } from '@/lib/services/property/room-occupants';

/**
 * The people in a room, as the owner's Rooms tab (the building, ADR-199)
 * receives them. Pure: the obligations summary is computed by the caller with
 * `financialService.getTenantPaymentSummary()` and passed in — composed, never
 * recalculated here.
 */

const summary = { pending_amount: 4000, payment_status: 'OVERDUE' as const };

describe('activeOccupant', () => {
  const allocation = {
    start_date: new Date('2026-08-01'),
    tenant: {
      id: 't1',
      monthly_rent: '8000',
      status: 'ACTIVE',
      photo_url: 'https://ik.imagekit.io/x/a.jpg',
      personal_email: null,
      phone_1: '999',
      profiles: { name: 'Arjun Reddy', email: 'arjun@example.com', phone: null },
      tenant_invitations: [],
    },
  };

  it('carries the photo and the backend’s own overdue verdict', () => {
    const o = activeOccupant(allocation, summary);
    expect(o.photo_url).toBe('https://ik.imagekit.io/x/a.jpg');
    expect(o.payment_status).toBe('OVERDUE');
    expect(o.pending_dues).toBe(4000);
    expect(o.rent).toBe(8000);
    expect(o.name).toBe('Arjun Reddy');
    expect(o.tenant_id).toBe('t1');
    expect(o.joined_date).toEqual(new Date('2026-08-01'));
  });

  it('falls back to the invitation name, then "Tenant"', () => {
    const noProfile = {
      ...allocation,
      tenant: { ...allocation.tenant, profiles: null, tenant_invitations: [{ name: 'Ravi', email: null, phone: null }] },
    };
    expect(activeOccupant(noProfile, summary).name).toBe('Ravi');
    const nothing = { ...allocation, tenant: { ...allocation.tenant, profiles: null } };
    expect(activeOccupant(nothing, summary).name).toBe('Tenant');
  });

  it('has no photo rather than an empty string', () => {
    const blank = { ...allocation, tenant: { ...allocation.tenant, photo_url: '' } };
    expect(activeOccupant(blank, summary).photo_url).toBeNull();
  });
});

describe('invitedOccupantsFromReservations', () => {
  const reservation = (status: string) => ({
    tenant_id: 't2',
    invitation_id: 'i1',
    reserved_at: new Date('2026-09-01'),
    invitation: { status, name: 'Suresh V', email: null, phone: '888' },
    tenant: {
      profile_id: null,
      photo_url: null,
      monthly_rent: '7000',
      joined_on: null,
      personal_email: null,
      phone_1: null,
      profiles: null,
    },
  });

  it('keeps live invitations, QUEUED included, and drops the rest', () => {
    const out = invitedOccupantsFromReservations([reservation('PENDING'), reservation('QUEUED'), reservation('CANCELLED')]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      occupant_type: 'INVITED',
      status: 'INVITED',
      name: 'Suresh V',
      photo_url: null,
      rent: 7000,
    });
  });

  it('is empty for no reservations', () => {
    expect(invitedOccupantsFromReservations()).toEqual([]);
  });
});
