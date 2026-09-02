/**
 * The owner's Profile as a flat list of grouped rows.
 *
 * This screen has been subtracted from twice. It was first nine stacked
 * blocks — a progress ring, six module *cards*, a recent-changes strip, a
 * quick-actions row duplicating the modules above it, and an "Advanced"
 * expander whose six rows were permanent "Not available yet" placeholders —
 * none of which answered the question the screen exists to answer: *where do
 * I go to change this?* That collapsed to grouped rows carrying a label and a
 * chevron, ~44px instead of ~90px.
 *
 * It is now cut to **the owner's own account**, four rows. What left, and
 * why:
 *
 * - **Notices** moved to the hostel's Settings tab. Announcements and events
 *   belong to a hostel, and this screen read `session.primaryHostelId` to
 *   decide which — so a two-hostel owner posted to whichever came first, with
 *   nothing on screen saying so.
 * - **Requests** is deleted. `/owner/alerts/requests` is the same queue over
 *   the same service, plus search, a tenant chat sheet and deep-links from
 *   notifications. Two doors to one queue, one of them worse.
 * - **About** folded into Help — it was three links and a version string
 *   read from `@shared/mocks`.
 * - **Search** and **needs attention** went with them: both pointed almost
 *   entirely at per-hostel screens, and neither passed a hostel id. The
 *   attention checks survive on the hostel that owns them (see
 *   `attentionItems.ts`); the search index did not survive at all, because
 *   with four rows on screen there is nothing left to search for.
 *
 * A row's label is a single keyword. The heading above it already supplies the
 * context a sentence like "Where your money goes" was spelling out, and the
 * headings dropped their possessive because on the owner's own profile "Your
 * account" says "your" twice.
 *
 * Pure: the grouping is the design, and it should be assertable without
 * rendering anything.
 */

export interface HubRow {
  key: string;
  label: string;
  route: string;
}

export interface HubGroup {
  /** Small-caps heading. Absent for the trailing sign-out group. */
  label?: string;
  rows: HubRow[];
}

/**
 * Everything Profile links to, in the order it is shown.
 *
 * **One settings screen, not three.** "Settings" and "Account & security"
 * were separate menus that led back into the same places — an owner had to
 * know which of three screens held a given row. Both are deleted; their real
 * contents are listed here directly.
 *
 * **Nothing about a hostel.** Hostels are managed from Home, and everything
 * configurable about one lives on that hostel's own Settings tab
 * (`/owner/hostels/:id/settings`). Every row here is genuinely owner-level:
 * it applies wherever they go, whichever hostel they are looking at, and none
 * of it needs a hostel id to be correct.
 */
export function hubGroups(): HubGroup[] {
  return [
    {
      label: 'Account',
      rows: [
        { key: 'profile', label: 'Details', route: '/owner/more/profile' },
        { key: 'password', label: 'Password', route: '/owner/more/password' },
        { key: 'payout', label: 'Payouts', route: '/owner/more/payout-account' },
      ],
    },
    {
      label: 'Support',
      rows: [{ key: 'help', label: 'Help', route: '/owner/more/help' }],
    },
  ];
}
