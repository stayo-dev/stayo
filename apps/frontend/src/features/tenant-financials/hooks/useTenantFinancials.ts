import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantFinancialsService } from '@features/tenant-financials/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';

export type PayStage = 'closed' | 'form' | 'paying' | 'paid';

/**
 * Shared tenant financial data + the real payment-intent flow — used by both
 * the Home tab's rent-due hero and the Money tab's full breakdown, so there
 * is exactly one "Pay" implementation. Composes the canonical
 * `FinancialReadModel` (`GET /tenants/me/financial-read-model`, same source
 * the owner side reads) rather than deriving amounts independently, and the
 * real billing timeline / payment history.
 */
export function useTenantFinancials() {
  const session = useTenantSession();
  const queryClient = useQueryClient();

  const readModelQuery = useQuery({
    queryKey: ['tenant', 'financial-read-model'],
    queryFn: () => tenantFinancialsService.getReadModel(),
    enabled: session.isAuthenticated,
    staleTime: 15_000,
  });

  const timelineQuery = useQuery({
    queryKey: ['tenant', 'billing-timeline'],
    queryFn: () => tenantFinancialsService.getBillingTimeline(),
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  const historyQuery = useQuery({
    queryKey: ['tenant', 'payment-history'],
    queryFn: () => tenantFinancialsService.getPaymentHistory(),
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  const billingFrequencyQuery = useQuery({
    queryKey: ['tenant', 'billing-frequency'],
    queryFn: () => tenantFinancialsService.getBillingFrequency(),
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const [payStage, setPayStage] = useState<PayStage>('closed');
  const [payError, setPayError] = useState<string | null>(null);

  const payMutation = useMutation({
    mutationFn: () => {
      const readModel = readModelQuery.data;
      const amount = readModel?.current_payable_amount ?? 0;
      return tenantFinancialsService.createPaymentIntent({ payment_type: 'RENT', amount });
    },
    onMutate: () => {
      setPayStage('paying');
      setPayError(null);
    },
    onSuccess: (intent: any) => {
      if (intent?.checkout_url) {
        window.location.href = intent.checkout_url;
        return;
      }
      // No redirect URL (e.g. already-settled edge case) — treat as done.
      setPayStage('paid');
      queryClient.invalidateQueries({ queryKey: ['tenant', 'financial-read-model'] });
      queryClient.invalidateQueries({ queryKey: ['tenant', 'billing-timeline'] });
      queryClient.invalidateQueries({ queryKey: ['tenant', 'payment-history'] });
    },
    onError: (err: any) => {
      setPayError(err?.response?.data?.error?.message || err?.message || 'Could not start payment');
      setPayStage('form');
    },
  });

  const readModel = readModelQuery.data ?? null;
  const items = useMemo(() => timelineQuery.data?.items ?? [], [timelineQuery.data]);
  const history = useMemo(() => historyQuery.data?.payments ?? [], [historyQuery.data]);

  return {
    isLoading: readModelQuery.isLoading,
    readModel,
    amountDue: readModel?.current_payable_amount ?? 0,
    isOverdue: (readModel?.overdue_amount ?? 0) > 0,
    overdueDays: readModel?.overdue_days ?? 0,
    securityDeposit: readModel?.security_deposit ?? { configured: 0, paid: 0, due: 0 },
    timeline: items,
    history,
    billingFrequency: billingFrequencyQuery.data ?? null,
    payStage,
    payError,
    openPay: () => setPayStage('form'),
    closePay: () => setPayStage('closed'),
    confirmPay: () => payMutation.mutate(),
    isPaying: payMutation.isPending,
  };
}
