/**
 * Tab model for the Hostel Listings screen.
 *
 * The fourth tab, "Content review", is the marketing-revision queue that used
 * to live at /admin/marketing-reviews. Per ADR-076 these remain two different
 * gates — listing approval decides whether a hostel is discoverable at all,
 * content review decides whether its copy is publishable, and a live listing
 * needs both. Folding it in as a tab keeps that distinction visible without
 * spending a second sidebar entry on it.
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */

export type ListingTabKey = 'pending' | 'approved' | 'rejected' | 'content' | 'stayo';

export const LISTING_TABS: { key: ListingTabKey; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'content', label: 'Content review' },
  { key: 'stayo', label: 'Stayo-listed' },
];

const KEYS = LISTING_TABS.map((t) => t.key);

export function resolveListingTab(raw: string | null): ListingTabKey {
  if (raw && (KEYS as string[]).includes(raw)) return raw as ListingTabKey;
  return 'pending';
}

const VERIFICATION: Record<string, string> = {
  pending: 'PENDING',
  approved: 'VERIFIED',
  rejected: 'REJECTED',
};

/** `null` means the tab does not query hostels at all. */
export function listingFilterFor(tab: ListingTabKey): { verification: string } | null {
  const verification = VERIFICATION[tab];
  return verification ? { verification } : null;
}
