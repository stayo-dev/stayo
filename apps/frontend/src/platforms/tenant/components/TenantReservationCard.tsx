import { Link } from 'react-router-dom';
import { AlertCircle, BedDouble, CheckCircle, CreditCard } from 'lucide-react';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

interface TenantReservationCardProps {
  reservationStatus?: any;
  /** True once the tenant has an active/overdue rent balance — the move-in
   * congratulations card only talks about the one-time deposit/maintenance,
   * so it's collapsed to a small badge rather than a full card in that case
   * to avoid reading as "everything is fine" next to the rent-due banner. */
  hasOngoingRentDue?: boolean;
}

export function TenantReservationCard({ reservationStatus, hasOngoingRentDue }: TenantReservationCardProps) {
  if (!reservationStatus) return null;

  const {
    status,
    requiredDeposit,
    paidDeposit,
    depositOutstanding,
    requiredMaintenance,
    paidMaintenance,
    maintenanceOutstanding,
    threshold
  } = reservationStatus;

  if (status === 'MOVE_IN_READY') {
    if (hasOngoingRentDue) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/40 px-3.5 py-2">
          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-xs font-semibold text-emerald-800">Move-in deposit fully cleared — room confirmed</p>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-emerald-900">Bed Reservation: Move-in Ready!</p>
            <p className="mt-1 text-xs text-emerald-700 leading-relaxed">
              Your room is guaranteed and your move-in deposit is fully cleared. Welcome to your new home!
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'RESERVED') {
    return (
      <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
            <BedDouble className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-blue-900">Bed Reservation: Confirmed & Reserved</p>
            <p className="mt-1 text-xs text-blue-700 leading-relaxed">
              Your bed is reserved! To complete your onboarding and make it Move-in Ready, please clear your remaining maintenance dues.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-blue-100/80 px-2.5 py-1 font-semibold text-blue-800">
                Deposit Paid: {fmt(paidDeposit)} / {fmt(requiredDeposit)}
              </span>
              {maintenanceOutstanding > 0 && (
                <span className="rounded-md bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
                  Maintenance Due: {fmt(maintenanceOutstanding)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Link
            to="/tenant/financials?pay=1"
            className="flex items-center justify-center gap-1.5 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors"
          >
            <CreditCard className="w-4 h-4" />
            Pay Remaining Dues
          </Link>
        </div>
      </div>
    );
  }

  // PAYMENT_PENDING
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center shrink-0">
          <AlertCircle className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900">Bed Reservation: Payment Pending</p>
          <p className="mt-1 text-xs text-amber-700 leading-relaxed">
            Your HMS account is activated, but your bed reservation is pending. A minimum payment of{' '}
            <strong className="text-amber-900">{fmt(threshold)}</strong> is required to guarantee your room.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
              Paid: {fmt(paidDeposit)} / Required: {fmt(threshold)}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3">
        <Link
          to="/tenant/financials?pay=1"
          className="flex items-center justify-center gap-1.5 w-full py-3 rounded-xl bg-accent text-accent-foreground font-bold text-sm hover:opacity-90 transition-opacity"
        >
          <CreditCard className="w-4 h-4" />
          Pay Reservation Deposit ({fmt(Math.max(0, threshold - paidDeposit))})
        </Link>
      </div>
    </div>
  );
}
