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
 * Per-hostel settings still live under `/owner/more/configuration/*`. The
 * approved structure moves them into the hostel's own Settings tab, but that
 * tab does not exist yet — moving them now would leave rent, agreements and
 * reminders with no home at all. See the spec's decomposition.
 */
export function hubGroups(): HubGroup[] {
  return [
    {
      label: 'Your hostel',
      rows: [
        { key: 'hostel', label: 'Hostel details', route: '/owner/more/hostel' },
        { key: 'finance', label: 'Rent & finance', route: '/owner/more/configuration/finance' },
        { key: 'agreements', label: 'Agreements', route: '/owner/more/configuration/agreements' },
        { key: 'notifications', label: 'Reminders', route: '/owner/more/configuration/notifications' },
        { key: 'automation', label: 'Automation', route: '/owner/more/configuration/automation' },
      ],
    },
    {
      label: 'Your account',
      rows: [
        { key: 'account', label: 'Account & security', route: '/owner/more/configuration/account' },
        { key: 'settings', label: 'Profile, notices & requests', route: '/owner/more/settings' },
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
