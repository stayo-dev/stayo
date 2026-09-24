import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { paymentClaimsService } from '../api/paymentClaims';
import type { PaymentClaim } from '../components/collections/paymentClaims';

/**
 * The tenants waiting on the owner to confirm a UPI payment.
 *
 * Keyed by hostel as well as state: an owner with several hostels filtering to
 * one must not see another's claims served from cache. That is the same rule
 * the dashboard invariants enforce elsewhere, and it exists because picking the
 * wrong hostel silently has bitten this codebase before.
 */
export function usePaymentClaims(hostelId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const scope = hostelId && hostelId !== 'all' && hostelId !== 'business' ? hostelId : null;
  const key = ['owner', 'payment-claims', scope ?? 'all', 'PENDING'];

  const query = useQuery<PaymentClaim[]>({
    queryKey: key,
    queryFn: () => paymentClaimsService.list({ state: 'PENDING', hostelId: scope }),
    enabled,
    staleTime: 30_000,
  });

  /**
   * Confirming moves money, so everything downstream of the ledger is
   * invalidated rather than patched: dues, the collection queue and the money
   * screens all recompute from the same source instead of holding a local
   * guess about what a payment did.
   */
  const invalidateMoney = () => {
    for (const k of [
      ['owner', 'payment-claims'],
      ['owner', 'collection-queue'],
      ['owner', 'money'],
      ['owner', 'dashboard'],
    ]) {
      queryClient.invalidateQueries({ queryKey: k });
    }
  };

  const confirm = useMutation({
    mutationFn: (claimId: string) => paymentClaimsService.confirm(claimId),
    onSuccess: () => {
      stayoToast.success('Payment recorded');
      invalidateMoney();
    },
    onError: (err: any) => {
      stayoToast.error(
        err?.response?.data?.error?.message || "Couldn't record that payment. Please try again.",
      );
    },
  });

  const reject = useMutation({
    mutationFn: (vars: { claimId: string; reason?: string }) =>
      paymentClaimsService.reject(vars.claimId, vars.reason),
    onSuccess: () => {
      stayoToast.success('Marked as not received');
      invalidateMoney();
    },
    onError: (err: any) => {
      stayoToast.error(
        err?.response?.data?.error?.message || "Couldn't update that. Please try again.",
      );
    },
  });

  return {
    claims: query.data ?? [],
    isLoading: query.isLoading,
    confirm,
    reject,
    /** True while either verdict is in flight, so the row can lock. */
    isDeciding: confirm.isPending || reject.isPending,
  };
}
