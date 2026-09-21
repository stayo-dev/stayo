import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Paths that an APPROVED WhatsApp template's URL button points at.
 *
 * A Meta template's button URL is fixed at approval time. Editing it
 * re-triggers review and strands every invitation already delivered, so when
 * a template's path and the app's path disagree, the app is what moves.
 *
 * These routes therefore cannot be deleted or renamed on our side alone. If
 * one goes, the link in somebody's WhatsApp 404s and there is no way to
 * notice except by them telling us.
 */
const TEMPLATE_LINK_PATHS = [
  // stayo_admin_invitation, stayo_admin_invitation_reminder (approved 2026-09-21)
  // -> redirects to /admin/manager-invitation/:token
  '/admin/activate/:token',
  // stayo_owner_invitation — the pre-existing owner funnel.
  '/owner-invite/:token',
  // stayo_owner_lead_received — the public enquiry status page.
  '/enquiry/:token',
  // stayo_partner_listing_live -> the partner's own view of their listing.
  '/partner/:token',
  // stayo_partner_new_enquiry -> one enquiry, with the student's number.
  '/partner/enquiry/:token',
  // stayo_partner_enquiry_locked -> the claim page.
  '/partner/activate/:token',
];

describe('routes referenced by approved WhatsApp templates', () => {
  const source = readFileSync(resolve(__dirname, 'PublicRoutes.tsx'), 'utf8');

  it.each(TEMPLATE_LINK_PATHS)('still serves %s', (path) => {
    expect(source).toContain(`path="${path}"`);
  });
});
