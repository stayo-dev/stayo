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
 * because "what happens when rent is late" spans all three and an owner does
 * not know or care which object holds which field.
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

export function hostelSettingsGroups(hostelId: string): HostelSettingGroup[] {
  const hostel = `/owner/hostels/${hostelId}`;

  return [
    {
      label: 'This hostel',
      rows: [
        { key: 'identity', label: 'Name, address & logo', hint: 'What tenants and receipts show', route: '/owner/more/hostel' },
        { key: 'rooms', label: 'Rooms & beds', hint: 'Floors, rooms and how many share each', route: `${hostel}/rooms` },
      ],
    },
    {
      label: 'Rent & money',
      rows: [
        { key: 'rent-due', label: 'When rent is due', hint: 'Due day, grace period and when rent is raised', route: `${CONFIG}/finance/rent-schedule` },
        { key: 'late', label: 'What happens when rent is late', hint: 'Late fees and when they start', route: `${CONFIG}/finance/late-fees` },
        { key: 'how-they-pay', label: 'How tenants pay', hint: 'Full or part payments, and your UPI', route: `${CONFIG}/finance/part-payments` },
        { key: 'deposit', label: 'Deposits', hint: 'What you collect at move-in, and whether it comes back', route: `${CONFIG}/finance/deposit` },
        { key: 'receipts', label: 'Receipts', hint: 'Numbering, GST and what the footer says', route: `${CONFIG}/finance/receipt-footer` },
      ],
    },
    {
      label: 'Tenants',
      rows: [
        { key: 'invite-defaults', label: 'Defaults for new tenants', hint: 'Filled in for you every time you invite someone', route: `${CONFIG}/hostel/tenant-defaults` },
        { key: 'agreements', label: 'Agreements', hint: 'Your rental agreement, its clauses and versions', route: `${CONFIG}/agreements` },
      ],
    },
    {
      label: 'Messages & automation',
      rows: [
        { key: 'reminders', label: 'Reminders', hint: 'What we send tenants, and on which days', route: `${CONFIG}/notifications` },
        { key: 'automation', label: 'What Stayo does on its own', hint: 'Raising rent, applying late fees, sending receipts', route: `${CONFIG}/automation` },
      ],
    },
  ];
}
