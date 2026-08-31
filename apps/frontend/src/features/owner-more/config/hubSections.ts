/**
 * The configuration hub as a flat list of grouped rows.
 *
 * The hub used to be nine stacked blocks: a progress ring, an attention list,
 * six module *cards* each carrying an icon, a title, a subtitle, a status
 * badge and an area count, a recent-changes strip, a quick-actions row that
 * duplicated the modules directly above it, and an "Advanced" expander whose
 * six rows were all permanent "Not available yet" placeholders. An owner
 * scrolled past roughly three screens of furniture to reach a setting.
 *
 * None of that furniture answered the only question the screen exists to
 * answer — *where do I go to change this?* So the rows carry a label and
 * nothing else, grouped under headings in the owner's words. What used to be
 * a 90px card is now a 44px row.
 *
 * Pure: the grouping is the design, and it should be assertable without
 * rendering anything. See the configuration redesign spec.
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

export interface HubAttentionItem {
  title: string;
  sub: string;
  route: string;
}

/**
 * At most this many attention rows are shown. The list is genuinely useful —
 * it is derived from real gaps like a missing GST number or a late fee with no
 * amount — but it is not the point of the screen, and an unbounded list of
 * them recreates the wall of blocks this redesign removes.
 */
export const MAX_ATTENTION_ROWS = 2;

export function visibleAttention(items: HubAttentionItem[] | undefined): HubAttentionItem[] {
  return (items ?? []).slice(0, MAX_ATTENTION_ROWS);
}

/**
 * Everything the hub links to, in the order it is shown.
 *
 * **One settings screen, not three.** "Settings" (`MoreSettingsPage`) and
 * "Account & security" (`MoreConfigAccountPage`) were separate menus that led
 * back into the same places — an owner had to know which of three screens
 * held a given row. Their real contents are listed here directly; both are
 * deleted.
 *
 * **No hostel section.** Hostels are managed from Home, and everything
 * configurable about one now lives on that hostel's own Settings tab
 * (`/owner/hostels/:id/settings`). Configure holding a second hostel section
 * made an owner guess which of two places a setting lived in, and let a
 * multi-hostel owner edit one hostel's rules while a different hostel's name
 * sat in the header. What is left here is genuinely owner-level: it applies
 * wherever they go, whichever hostel they are looking at.
 */
export function hubGroups(): HubGroup[] {
  return [
    {
      label: 'Your account',
      rows: [
        { key: 'profile', label: 'Your details', route: '/owner/more/profile' },
        { key: 'password', label: 'Password', route: '/owner/more/password' },
        { key: 'payout', label: 'Where your money goes', route: '/owner/more/payout-account' },
      ],
    },
    {
      label: 'Your tenants',
      rows: [
        { key: 'notices', label: 'Notices & announcements', route: '/owner/more/notices' },
        { key: 'requests', label: 'Tenant requests', route: '/owner/more/service-requests' },
      ],
    },
    {
      label: 'Support',
      rows: [
        { key: 'help', label: 'Help', route: '/owner/more/help' },
        { key: 'about', label: 'About Stayo', route: '/owner/more/about' },
      ],
    },
  ];
}
