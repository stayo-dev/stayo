import { useQuery } from '@tanstack/react-query';
import { Home } from 'lucide-react';
import { useAuth } from '@context/AuthContext';
import { moveOutService } from '@features/move-out/api';

/**
 * Where a tenancy ends.
 *
 * There was nothing here before. A tenant who moved out hit
 * `ProtectedTenantRoute`, failed `hasLiveTenancy`, and was redirected away —
 * no message, no explanation, dashboard tab gone from the nav. Someone
 * opening the app to check whether their deposit had come back landed
 * elsewhere as though they had never lived anywhere, and their own
 * settlement record went with it.
 *
 * So this screen says what happened and shows the money. The "browse for a
 * new place" card that used to sit at the foot of it was removed in v1
 * (ADR-170) along with the rest of the Stayo Discover marketplace. (ADR-122)
 */
export function TenantFarewellPage() {
  const { user } = useAuth();
  const requestId = user?.exit_request_id ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ['tenant', 'farewell', requestId],
    queryFn: () => moveOutService.getRequest(requestId!) as Promise<any>,
    enabled: Boolean(requestId),
    staleTime: 5 * 60_000,
  });

  const settlement = data?.settlement;
  const direction = settlement?.settlement_direction;
  const amount = Math.abs(Number(settlement?.confirmed_settlement_amount ?? 0));
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const pretty = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
            <Home className="h-6 w-6 text-muted-foreground" />
          </span>
          <h1 className="font-display text-xl font-extrabold text-foreground">
            You’ve moved out
          </h1>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {data?.hostel?.name
              ? `Your stay at ${data.hostel.name} has ended.`
              : 'Your stay has ended.'}{' '}
            Your room and payment pages are closed, but everything below stays here for you.
          </p>
        </div>

        {/* The receipt. This is the thing they came back for. */}
        {isLoading && (
          <div className="h-32 animate-pulse rounded-2xl bg-muted" />
        )}

        {!isLoading && data && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Your final settlement
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Row label="You left on" value={pretty(data.physical_exit_date ?? data.planned_exit_date)} />
              <Row label="Closed on" value={pretty(data.completed_at)} />
              {settlement && (
                <>
                  <Row
                    label="Deposit & advance"
                    value={rupees(Number(settlement.security_deposit_amount ?? 0) + Number(settlement.advance_balance ?? 0))}
                  />
                  {Number(settlement.total_deductions ?? 0) > 0 && (
                    <Row label="Deductions" value={`− ${rupees(Number(settlement.total_deductions))}`} />
                  )}
                  {Number(settlement.total_dues ?? 0) > 0 && (
                    <Row label="Unpaid rent" value={`− ${rupees(Number(settlement.total_dues))}`} />
                  )}
                  <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2.5">
                    <span className="font-display text-[13px] font-bold text-foreground">
                      {direction === 'OWNER_OWES_TENANT'
                        ? 'Refunded to you'
                        : direction === 'TENANT_OWES_OWNER'
                          ? 'Settled from your deposit'
                          : 'Nothing owed either way'}
                    </span>
                    <span className="font-display text-[16px] font-extrabold tabular-nums text-primary">
                      {amount > 0 ? rupees(amount) : '₹0'}
                    </span>
                  </div>
                  {settlement.payment_method && (
                    <p className="text-[11.5px] text-muted-foreground">
                      Paid by {String(settlement.payment_method).toLowerCase().replace(/_/g, ' ')}
                      {settlement.payment_reference ? ` · ${settlement.payment_reference}` : ''}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {!isLoading && !data && (
          <p className="rounded-2xl border border-border bg-card p-4 text-[12.5px] text-muted-foreground">
            We couldn’t load your settlement record. Your former hostel can send you a copy.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export default TenantFarewellPage;
