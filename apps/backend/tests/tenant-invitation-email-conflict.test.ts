import { describe, expect, it, vi } from 'vitest';

/**
 * Covers the resendInvitation() email-conflict guard in isolation — the
 * function itself needs no Prisma/transaction mocking, since it takes its DB
 * client as a parameter. `@/lib/db` still has to be mocked here purely to
 * satisfy tenant-invitation-lifecycle-service.ts's own module-scope `import
 * { prisma } from "../../../lib/db"` — lib/db.ts throws at import time
 * without DATABASE_URL_TEST, same pattern as admissions-lead-actions.test.ts.
 *
 * Reproduces the bug: a dangling ACTIVATION_STARTED invitation (found by
 * phone) can carry a profile_id whose email differs from the new
 * invitation's email, and that email can already belong to a *different*
 * profile (e.g. the lead's own seeker_profile_id from a prior Discovery
 * signup) — updating straight onto it trips profile.email's unique
 * constraint (raw Prisma P2002) unless guarded first.
 */
vi.mock('@/lib/db', () => ({ prisma: {}, supabase: {} }));
vi.mock('@/lib/services/email-service', () => ({ EmailService: { sendInvitation: vi.fn() } }));

import { assertEmailAvailableForProfile } from '@/src/services/tenants/tenant-invitation-lifecycle-service';
describe('assertEmailAvailableForProfile', () => {
  it('no existing profile owns the email — continues normally', async () => {
    const db = { profile: { findUnique: vi.fn().mockResolvedValue(null) } };
    await expect(
      assertEmailAvailableForProfile(db, 'profile-x', 'new@gmail.com')
    ).resolves.toBeUndefined();
    expect(db.profile.findUnique).toHaveBeenCalledWith({ where: { email: 'new@gmail.com' } });
  });

  it('the same profile already owns the target email — continues normally', async () => {
    const db = { profile: { findUnique: vi.fn().mockResolvedValue({ id: 'profile-x' }) } };
    await expect(
      assertEmailAvailableForProfile(db, 'profile-x', 'bvtej6@gmail.com')
    ).resolves.toBeUndefined();
  });

  it('a DIFFERENT profile owns the target email — throws a clean VALIDATION_ERROR, never a raw constraint error', async () => {
    const db = { profile: { findUnique: vi.fn().mockResolvedValue({ id: 'profile-y' }) } };
    await expect(
      assertEmailAvailableForProfile(db, 'profile-x', 'bvtej6@gmail.com')
    ).rejects.toThrow('VALIDATION_ERROR: An account with this email address already exists. Please use a different email address.');
  });
});
