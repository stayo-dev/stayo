import { formatInr } from '../owners/ownerRows';

/**
 * Shapes the Overview screen's panels from real endpoint data.
 *
 * The design (`Stayo Admin.dc.html`, OVERVIEW section) ships hardcoded
 * numbers. Where the backend has an equivalent metric this module maps onto
 * it; where it does not, the card is marked `unavailable` and renders an em
 * dash rather than a zero. A zero here would read as "no work waiting",
 * which is a different and much more dangerous claim than "not measured".
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */

export type KpiCard = {
  key: string;
  label: string;
  value: string;
  sub: string;
  delta?: string;
  deltaTone?: 'green' | 'amber';
  unavailable?: boolean;
  /** Present when the card should navigate somewhere on click. */
  to?: string;
};

type DashboardKpis = {
  new_leads?: number;
  active_hostels?: number;
  owners_total?: number;
  collections?: number;
  pending_approvals?: number;
};

const DASH = '—';

function num(value: number | undefined): string {
  return value == null ? DASH : Number(value).toLocaleString('en-IN');
}

export function buildKpis(kpis: DashboardKpis | undefined, openReports?: number): KpiCard[] {
  const k = kpis ?? {};

  return [
    {
      key: 'revenue',
      // The design says "Revenue today". /platform-admin/dashboard returns
      // `collections`, which is month-to-date — so the label follows the data,
      // not the mockup. Same number under the design's label would misreport
      // the business by roughly 30x. ADR-172: this is Stayo subscription
      // revenue (what owners pay Stayo), not tenant rent.
      label: 'Subscription revenue',
      value: k.collections == null ? DASH : formatInr(k.collections),
      sub: 'owner plans, this month',
      to: '/admin/revenue',
    },
    {
      key: 'leads',
      label: 'New leads',
      value: num(k.new_leads),
      sub: 'from the landing page',
      to: '/admin/leads',
    },
    // 'Pending KYC' removed with the KYC Approvals screen it linked to.
    {
      key: 'hostels',
      label: 'Live hostels',
      value: num(k.active_hostels),
      sub: 'discoverable to tenants',
      // No dedicated hostel-listings screen exists in v1 (marketplace admin
      // shelved — ADR-170); Owners is where a hostel's status actually
      // surfaces today, via the owner drawer.
      to: '/admin/owners',
    },
    {
      key: 'owners',
      label: 'Active owners',
      value: num(k.owners_total),
      sub: 'on the platform',
      to: '/admin/owners',
    },
    {
      key: 'reports',
      label: 'Open reports',
      value: num(openReports),
      sub: 'from owners, tenants & reservations',
      to: '/admin/reports',
    },
  ];
}

export type FunnelRow = { key: string; label: string; count: number; width: string; fill: string };

/**
 * The owner-acquisition funnel, built from real `PlatformLeadStatus` counts.
 *
 * Cumulative by construction: a lead that is LIVE also passed through
 * captured, reviewed and activated. Counting each status in isolation would
 * draw a funnel that widens at the bottom the moment leads progress, which is
 * the classic way these charts end up lying.
 *
 * The design's first row, "Landing visitors", is deliberately absent — that
 * needs web analytics this platform does not collect, and inventing it would
 * make every conversion rate below it fictional.
 *
 * Every `PlatformLeadStatus` must land in exactly one bucket below, or a lead
 * sitting in that status is silently dropped from the funnel entirely
 * (including "Leads captured", which is meant to be the full inflow).
 * CONTACTED / DEMO / NEGOTIATING sit between the initial review and a formal
 * approval decision, so they fold into "In review" alongside UNDER_REVIEW.
 */
export function buildFunnel(counts: Record<string, number>): FunnelRow[] {
  const c = (key: string) => Number(counts?.[key] ?? 0);

  const live = c('LIVE');
  const created = live + c('HOSTEL_CREATED');
  const activated = created + c('OWNER_ACTIVATED');
  const invited = activated + c('INVITE_SENT') + c('APPROVED');
  const reviewed = invited + c('UNDER_REVIEW') + c('CONTACTED') + c('DEMO') + c('NEGOTIATING');
  const captured = reviewed + c('NEW') + c('LOST');

  const rows: Omit<FunnelRow, 'width'>[] = [
    { key: 'captured', label: 'Leads captured', count: captured, fill: '#C7BEB2' },
    { key: 'reviewed', label: 'In review', count: reviewed, fill: '#D9A98F' },
    { key: 'invited', label: 'Approved & invited', count: invited, fill: '#CE8E6E' },
    { key: 'activated', label: 'Account activated', count: activated, fill: '#BF7455' },
    { key: 'live', label: 'Live on Stayo', count: live, fill: '#1F7A52' },
  ];

  const max = rows[0].count;
  return rows.map((r) => ({
    ...r,
    width: max > 0 ? `${Math.round((r.count / max) * 100)}%` : '0%',
  }));
}

export function conversionRate(counts: Record<string, number>): string {
  const rows = buildFunnel(counts);
  const captured = rows[0].count;
  const live = rows[rows.length - 1].count;
  if (captured <= 0) return DASH;
  return `${((live / captured) * 100).toFixed(1)}%`;
}

export type ReviewRow = {
  key: string;
  title: string;
  sub: string;
  count: number | string;
  to: string;
  tint: string;
  border: string;
  ink: string;
  unavailable?: boolean;
};

export function buildReviewQueue({ reports }: { reports: number }): ReviewRow[] {
  return [
    // The 'Owner KYC to verify' row was removed with the KYC Approvals
    // screen it linked to. The 'Hostels to publish' row (Stayo Discover
    // approval queue) was removed in v1 — ADR-170, marketplace shelved.
    {
      key: 'reports',
      title: 'Open reports',
      sub: 'From owners, tenants & reservations',
      count: reports,
      to: '/admin/reports',
      tint: '#FBEFE9',
      border: '#EFD6CE',
      ink: '#B3402F',
    },
  ];
}
