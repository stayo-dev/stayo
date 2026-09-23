import type { PartnerEnquiryRow, PartnerPortal } from '@features/partner/api';

/**
 * What the partner portal says, decided apart from how it is drawn.
 *
 * The frontend test suite is node-only and never renders a component, so
 * every judgement worth checking lives here and the pages stay thin.
 */

export type QuotaSummary = {
  delivered: number;
  quota: number;
  remaining: number;
  exhausted: boolean;
  line: string;
};

/**
 * The counter is the conversion mechanism, not decoration: seeing "2 of 3"
 * on arrival is what makes the gate feel expected rather than like a
 * bait-and-switch when it closes.
 */
export function summariseQuota(input: { delivered: number; quota: number }): QuotaSummary {
  const delivered = Math.max(0, Math.floor(Number(input.delivered) || 0));
  const quota = Math.max(0, Math.floor(Number(input.quota) || 0));
  const remaining = Math.max(0, quota - delivered);

  const line = remaining > 0
    ? `${delivered} of ${quota} free enquiries used`
    : `All ${quota} free enquiries used`;

  return { delivered, quota, remaining, exhausted: remaining === 0, line };
}

export type EnquiryView = {
  id: string;
  locked: boolean;
  /** A locked row is still a real enquiry, so it is never hidden. */
  title: string;
  detail: string;
  href: string | null;
};

/**
 * A locked enquiry shows that it exists and roughly who it is from, and
 * withholds the contact. Hiding it would make the gate look like a
 * malfunction; showing the number would make it pointless.
 */
export function toEnquiryView(row: PartnerEnquiryRow): EnquiryView {
  const locked = row.state === 'HELD';
  const name = row.student_name?.trim() || 'A student';

  return {
    id: row.id,
    locked,
    title: locked ? `${name} — locked` : name,
    detail: locked
      ? 'Activate your Stayo account to see their number'
      : (row.student_phone ?? 'No number provided'),
    href: row.token ? `/partner/enquiry/${row.token}` : null,
  };
}

/**
 * Locked enquiries first.
 *
 * They are the only rows the partner cannot act on, so burying them under
 * the ones they can would hide the single thing this page exists to show.
 * Within each group, newest first.
 */
export function orderEnquiries(rows: PartnerEnquiryRow[]): PartnerEnquiryRow[] {
  const byNewest = (a: PartnerEnquiryRow, b: PartnerEnquiryRow) =>
    new Date(b.received_at).getTime() - new Date(a.received_at).getTime();

  const locked = (rows ?? []).filter((r) => r.state === 'HELD').sort(byNewest);
  const rest = (rows ?? []).filter((r) => r.state !== 'HELD').sort(byNewest);
  return [...locked, ...rest];
}

/** How many enquiries are waiting behind the gate. Drives the page's banner. */
export function countLocked(portal: Pick<PartnerPortal, 'enquiries'> | null | undefined): number {
  return (portal?.enquiries ?? []).filter((e) => e.state === 'HELD').length;
}
