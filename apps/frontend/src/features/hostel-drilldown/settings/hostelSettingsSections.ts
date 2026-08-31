/**
 * Everything configurable about one hostel, grouped as the owner thinks of it.
 *
 * These settings used to live in the Configure section, one level away from
 * the hostel they belong to. That had two costs. A multi-hostel owner could
 * edit one hostel's rent rules while the header named a different hostel —
 * the same class of mistake the backend's architectural invariants forbid
 * server-side ("never fall back to the first hostel"). And hostels are managed
 * from Home, so Configure was a second, competing place to manage them.
 *
 * Here the hostel is established by navigation: you are inside a hostel, so
 * every row on this screen is about that hostel and nothing else.
 *
 * Grouping follows the owner's question, not the storage shape. `billing`,
 * `reminders` and `automation` each supply rows to more than one group,
 * because late rent spans all three and an owner does not know or care which
 * object holds which field.
 *
 * **A row is a keyword, not a sentence.** These read as questions at first —
 * "What happens when rent is late" — which is how an owner thinks but not how
 * anyone scans a list: a column of full sentences has to be read line by line,
 * while one-word labels are found at a glance. The sentence moves into the
 * hint underneath, where it does the same explaining without slowing the scan.
 *
 * **No rooms row.** Rooms are the tab immediately to the left of Settings, so
 * listing them here was a second door to a screen already one tap away.
 */

export interface HostelSettingRow {
  key: string;
  label: string;
  /** What this row governs, in one short line. Shown under the label. */
  hint: string;
  route: string;
}

export interface HostelSettingGroup {
  label: string;
  rows: HostelSettingRow[];
}

const CONFIG = '/owner/more/configuration';

/**
 * Every configuration screen must be told which hostel it is editing.
 *
 * They all read `session.primaryHostelId` before this — so opening a second
 * hostel's Settings and changing its late fee edited the *first* hostel's,
 * with the second hostel's name in the header. `useConfiguredHostelId` reads
 * this query; without it the fallback silently wins. See that hook.
 */
const forHostel = (route: string, hostelId: string) =>
  hostelId ? `${route}?hostelId=${encodeURIComponent(hostelId)}` : route;

export function hostelSettingsGroups(hostelId: string): HostelSettingGroup[] {
  const hostel = `/owner/hostels/${hostelId}`;

  return [
    {
      label: 'Hostel',
      rows: [
        {
          key: 'identity',
          label: 'Identity',
          hint: 'Name, address, phone and logo — what tenants and receipts show',
          route: forHostel('/owner/more/hostel', hostelId),
        },
      ],
    },
    {
      label: 'Rent & money',
      rows: [
        {
          key: 'rent-due',
          label: 'Rent',
          hint: "When it's raised, the day it's due and the grace period",
          route: forHostel(`${CONFIG}/finance/rent-schedule`, hostelId),
        },
        {
          key: 'late',
          label: 'Late fees',
          hint: "What's charged when rent is overdue, and when it starts",
          route: forHostel(`${CONFIG}/finance/late-fees`, hostelId),
        },
        {
          key: 'how-they-pay',
          label: 'Payments',
          hint: 'Whether a due can be paid in parts, and your UPI',
          route: forHostel(`${CONFIG}/finance/part-payments`, hostelId),
        },
        {
          key: 'deposit',
          label: 'Deposits',
          hint: 'What you collect at move-in, and whether it comes back',
          route: forHostel(`${CONFIG}/finance/deposit`, hostelId),
        },
        {
          key: 'receipts',
          label: 'Receipts',
          hint: 'Numbering, GST and the footer',
          route: forHostel(`${CONFIG}/finance/receipt-footer`, hostelId),
        },
      ],
    },
    {
      label: 'Tenants',
      rows: [
        {
          key: 'invite-defaults',
          label: 'Invite defaults',
          hint: 'Filled in for you every time you invite someone',
          route: forHostel(`${CONFIG}/hostel/tenant-defaults`, hostelId),
        },
        {
          key: 'agreements',
          label: 'Agreements',
          hint: 'Your rental agreement, its clauses and versions',
          route: forHostel(`${CONFIG}/agreements`, hostelId),
        },
      ],
    },
    {
      label: 'Messages',
      rows: [
        {
          key: 'reminders',
          label: 'Reminders',
          hint: 'What tenants are sent, and on which days',
          route: forHostel(`${CONFIG}/notifications`, hostelId),
        },
        {
          key: 'automation',
          label: 'Automation',
          hint: 'What Stayo does without asking you',
          route: forHostel(`${CONFIG}/automation`, hostelId),
        },
      ],
    },
  ];
}
