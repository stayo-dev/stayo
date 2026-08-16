import { tintForId } from '../theme/palette';

/**
 * Shapes `/platform-admin/owners` rows for the console's owners table.
 *
 * PURE MODULE — no I/O, runs under vitest's node environment.
 */

export type OwnerRow = {
  id: string;
  name: string;
  city: string;
  hostels: number;
  beds: number;
  gmv: string;
  plan: string;
  status: 'Active' | 'Paused';
  statusTone: 'green' | 'muted';
  initials: string;
  tint: string;
};

/**
 * Indian money formatting. Lakh notation above ₹1L, plain grouping below.
 *
 * Zero renders as ₹0 rather than a dash: an owner who collected nothing this
 * month is a real, actionable fact, and blanking it would hide it.
 */
export function formatInr(amount: number): string {
  const n = Number(amount) || 0;
  if (Math.abs(n) >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function toOwnerRows(apiOwners: any[]): OwnerRow[] {
  return (apiOwners ?? []).map((o) => {
    const active = Boolean(o.is_active);
    return {
      id: String(o.id),
      name: String(o.name ?? 'Unnamed owner'),
      // An em dash, not a blank — a missing city should read as "we don't
      // know", not as an empty column the reader glosses over.
      city: o.city ? String(o.city) : '—',
      hostels: Number(o.hostels ?? 0),
      beds: Number(o.beds ?? 0),
      gmv: formatInr(Number(o.monthly_revenue ?? 0)),
      plan: o.plan ? String(o.plan) : 'Unassigned',
      status: active ? 'Active' : 'Paused',
      statusTone: active ? 'green' : 'muted',
      initials: initialsOf(String(o.name ?? '?')),
      tint: tintForId(String(o.id)),
    };
  });
}

export function ownerStats(rows: OwnerRow[]): { label: string; value: string; sub: string }[] {
  const hostels = rows.reduce((sum, r) => sum + r.hostels, 0);
  const beds = rows.reduce((sum, r) => sum + r.beds, 0);
  const active = rows.filter((r) => r.status === 'Active').length;
  return [
    { label: 'Total owners', value: String(rows.length), sub: 'on this page' },
    { label: 'Active', value: String(active), sub: 'currently trading' },
    { label: 'Hostels', value: String(hostels), sub: 'across all owners' },
    { label: 'Beds', value: beds.toLocaleString('en-IN'), sub: 'total capacity' },
  ];
}
