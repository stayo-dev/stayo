/**
 * Topbar title + subtitle per route, copied from the design's own META block
 * in `Stayo Admin.dc.html` so the console's language matches the design
 * exactly rather than being paraphrased.
 */
export const PAGE_HEADERS: Record<string, { title: string; subtitle: string }> = {
  '/admin': { title: 'Overview', subtitle: 'Platform health across leads, revenue & operations' },
  '/admin/leads': { title: 'Leads', subtitle: 'Owner sign-ups from the landing page' },
  '/admin/owners': { title: 'Owners', subtitle: 'Every owner and the hostels they hold' },
  '/admin/kyc': { title: 'KYC Approvals', subtitle: 'Verify owner onboarding before they go live' },
  // '/admin/listings' (Hostel Listings) shelved for v1 — ADR-170.
  '/admin/reviews': { title: 'Reviews', subtitle: 'Resident reviews — nothing reaches a listing until you publish it' },
  '/admin/revenue': { title: 'Revenue & Analytics', subtitle: 'Platform earnings, GMV and commission' },
  '/admin/settlements': { title: 'Settlements', subtitle: 'Pay collected rent out to owners · nightly run' },
  '/admin/subscriptions': { title: 'Subscriptions', subtitle: 'Owner plans and recurring revenue' },
  '/admin/reports': { title: 'Reports & Bugs', subtitle: 'Issues raised by owners, tenants and reservations' },
  '/admin/broadcasts': { title: 'Broadcasts', subtitle: 'Announcements to your owner base' },
  '/admin/settings': { title: 'Settings', subtitle: 'Admins, templates and support details' },
};

export function headerFor(pathname: string): { title: string; subtitle: string } {
  return PAGE_HEADERS[pathname] ?? { title: 'Stayo Admin', subtitle: '' };
}
