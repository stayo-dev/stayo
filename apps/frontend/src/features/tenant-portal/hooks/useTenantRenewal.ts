import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantPortalApi } from '@features/tenant-portal/api';
import { tenantQueryKeys } from './useTenantDashboard';

/**
 * Lean data source for the dedicated tenant renewal page — only the two
 * queries this feature needs, so the page isn't blocked on the dashboard's
 * unrelated profile/dues/payments/room/etc. fetches.
 */
export function useTenantRenewal() {
  const queryClient = useQueryClient();

  const agreementRenewalQ = useQuery({
    queryKey: tenantQueryKeys.agreementRenewal(),
    queryFn: () => tenantPortalApi.getAgreementRenewal(),
    staleTime: 30_000,
  });

  const renewalOfferQ = useQuery({
    queryKey: ['tenant', 'me', 'renewal-offer'],
    queryFn: () => tenantPortalApi.getTenantRenewalOffer(),
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: tenantQueryKeys.agreementRenewal() });
    queryClient.invalidateQueries({ queryKey: ['tenant', 'me', 'renewal-offer'] });
  };

  return {
    agreementRenewal: agreementRenewalQ.data as Record<string, any> | undefined,
    renewalOffer: renewalOfferQ.data as Record<string, any> | undefined,
    isLoading: agreementRenewalQ.isLoading || renewalOfferQ.isLoading,
    isError: agreementRenewalQ.isError || renewalOfferQ.isError,
    refetch: () => {
      agreementRenewalQ.refetch();
      renewalOfferQ.refetch();
    },
    invalidate,
  };
}
