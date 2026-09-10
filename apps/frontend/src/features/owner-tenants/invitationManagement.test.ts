import { describe, expect, it } from 'vitest';
import { showsInvitationManagement } from './invitationManagement';

describe('showsInvitationManagement', () => {
  it('shows it for a tenant who has been invited but has not accepted', () => {
    // ADR-165's authoritative signal. The tenancy is operationally live —
    // rent generating, bed occupied — but the person has not taken over their
    // account, which is exactly the window the owner needs levers for.
    expect(showsInvitationManagement({ acceptanceStatus: 'PENDING', status: 'active' })).toBe(true);
  });

  it('stops showing it the moment they accept', () => {
    expect(showsInvitationManagement({ acceptanceStatus: 'ACCEPTED', status: 'active' })).toBe(false);
  });

  it('still shows it for a legacy INVITED row', () => {
    // Pre-ADR-165 tenancies sat at status INVITED until activation. They are
    // rarer every day but must not lose the screen.
    expect(showsInvitationManagement({ acceptanceStatus: null, status: 'invited' })).toBe(true);
  });

  it('does not show it for an ordinary active tenant', () => {
    // The regression this fixes ran the other way: `status === 'invited'` can
    // never be true under ADR-165, so *every* invited tenant fell through to
    // the full profile. Guarding the opposite direction matters just as much —
    // an activated tenant must not be shown cancel/resend levers.
    expect(showsInvitationManagement({ acceptanceStatus: null, status: 'active' })).toBe(false);
    expect(showsInvitationManagement({ acceptanceStatus: 'NOT_REQUIRED', status: 'active' })).toBe(false);
  });

  it('does not show it for an owner-managed tenant who was never invited', () => {
    // An adopted tenancy has no invitation to cancel, resend or edit. Offering
    // those would be three buttons acting on nothing.
    expect(
      showsInvitationManagement({ acceptanceStatus: 'NOT_REQUIRED', status: 'active', accessMode: 'OWNER_MANAGED' }),
    ).toBe(false);
  });

  it('fails closed when the signals are missing entirely', () => {
    // An absent acceptance_status must mean "ordinary profile", never "invited".
    // Guessing the other way would show cancel and resend to a settled tenant.
    expect(showsInvitationManagement({})).toBe(false);
    expect(showsInvitationManagement({ acceptanceStatus: undefined, status: undefined })).toBe(false);
  });
});
