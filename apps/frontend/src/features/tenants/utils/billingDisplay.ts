import type { NormalizedTenant } from '@features/tenants/utils/normalize';

const fmt = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

export interface TenantBillingDisplay {
  dueLabel: string;
  outstandingLabel: string;
  mobileLabel: string;
  title: string;
  dueClassName: string;
  outstandingClassName: string;
}

export function getTenantBillingDisplay(tenant: NormalizedTenant): TenantBillingDisplay {
  const paymentStatus = String(tenant.paymentStatus ?? '').toUpperCase();
  const outstandingAmount = Number(tenant.outstandingAmount || 0);

  if (paymentStatus === 'NOT_GENERATED') {
    return {
      dueLabel: 'Bill pending',
      outstandingLabel: 'Not billed',
      mobileLabel: 'Billing pending',
      title: 'Rent has not been generated for this tenant yet.',
      dueClassName: 'border-slate-200 bg-slate-50 text-slate-500',
      outstandingClassName: 'text-slate-500',
    };
  }

  if (paymentStatus === 'OVERDUE') {
    return {
      dueLabel: 'Overdue',
      outstandingLabel: fmt(outstandingAmount),
      mobileLabel: `Overdue ${fmt(outstandingAmount)}`,
      title: 'Tenant has an overdue balance.',
      dueClassName: 'border-red-200 bg-red-50 text-red-700 font-medium',
      outstandingClassName: 'text-destructive font-medium',
    };
  }

  if (outstandingAmount > 0) {
    const isPartial = paymentStatus === 'PARTIAL';

    return {
      dueLabel: isPartial ? 'Partial due' : 'Due',
      outstandingLabel: fmt(outstandingAmount),
      mobileLabel: `Due ${fmt(outstandingAmount)}`,
      title: isPartial ? 'Tenant has a partial outstanding balance.' : 'Tenant has an outstanding balance.',
      dueClassName: isPartial
        ? 'border-orange-200 bg-orange-50 text-orange-700'
        : 'border-amber-200 bg-amber-50 text-amber-700',
      outstandingClassName: isPartial ? 'text-orange-700' : 'text-amber-700',
    };
  }

  if (paymentStatus === 'PAID') {
    return {
      dueLabel: 'Paid',
      outstandingLabel: 'Clear',
      mobileLabel: 'Paid up',
      title: 'No outstanding rent due.',
      dueClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      outstandingClassName: 'text-emerald-600',
    };
  }

  return {
    dueLabel: 'No due',
    outstandingLabel: 'Clear',
    mobileLabel: 'No due',
    title: 'No outstanding amount is currently shown.',
    dueClassName: 'border-slate-200 bg-slate-50 text-slate-600',
    outstandingClassName: 'text-emerald-600',
  };
}
