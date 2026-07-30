import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { tenantPortalApi } from '@features/tenant-portal/api';

export const tenantQueryKeys = {
  dashboard: () => ['tenant', 'dashboard'] as const,
  profile: () => ['tenant', 'me', 'profile'] as const,
  dues: () => ['tenant', 'me', 'dues'] as const,
  readModel: () => ['tenant', 'me', 'financial-read-model'] as const,
  payments: () => ['tenant', 'me', 'payments'] as const,
  room: () => ['tenant', 'me', 'room'] as const,
  score: () => ['tenant', 'me', 'score'] as const,
  advance: () => ['tenant', 'me', 'advance'] as const,
  moveOut: () => ['tenant', 'me', 'move-out'] as const,
  notifications: () => ['tenant', 'me', 'notifications'] as const,
  documents: () => ['tenant', 'me', 'documents'] as const,
  agreementRenewal: () => ['tenant', 'me', 'agreement-renewal'] as const,
};

export function useTenantDashboard() {
  const [loadSecondary, setLoadSecondary] = useState(false);
  const profileQ = useQuery({
    queryKey: tenantQueryKeys.profile(),
    queryFn: () => tenantPortalApi.getMyProfile(),
    staleTime: 60_000,
  });

  const duesQ = useQuery({
    queryKey: tenantQueryKeys.dues(),
    queryFn: () => tenantPortalApi.getDuesBreakdown(),
    staleTime: 30_000,
  });

  const readModelQ = useQuery({
    queryKey: tenantQueryKeys.readModel(),
    queryFn: () => tenantPortalApi.getFinancialReadModel(),
    staleTime: 30_000,
  });

  const paymentsQ = useQuery({
    queryKey: tenantQueryKeys.payments(),
    queryFn: () => tenantPortalApi.getMyPaymentHistory(),
    staleTime: 30_000,
    enabled: loadSecondary,
  });

  const roomQ = useQuery({
    queryKey: tenantQueryKeys.room(),
    queryFn: () => tenantPortalApi.getMyRoom(),
    staleTime: 60_000,
    enabled: loadSecondary,
  });

  const criticalLoading = profileQ.isLoading;

  useEffect(() => {
    if (!criticalLoading) {
      const id = window.setTimeout(() => setLoadSecondary(true), 250);
      return () => window.clearTimeout(id);
    }
  }, [criticalLoading]);

  const scoreQ = useQuery({
    queryKey: tenantQueryKeys.score(),
    queryFn: () => tenantPortalApi.getMyScore(),
    staleTime: 120_000,
    enabled: loadSecondary,
  });

  const advanceQ = useQuery({
    queryKey: tenantQueryKeys.advance(),
    queryFn: () => tenantPortalApi.getAdvance(),
    staleTime: 60_000,
    enabled: loadSecondary,
  });

  const moveOutQ = useQuery({
    queryKey: tenantQueryKeys.moveOut(),
    queryFn: () => tenantPortalApi.getMoveOutStatus(),
    staleTime: 30_000,
    enabled: loadSecondary,
  });

  const notificationsQ = useQuery({
    queryKey: tenantQueryKeys.notifications(),
    queryFn: () => tenantPortalApi.getNotifications(),
    staleTime: 30_000,
    enabled: loadSecondary,
  });

  const documentsQ = useQuery({
    queryKey: tenantQueryKeys.documents(),
    queryFn: async () => {
      try {
        return await tenantPortalApi.getMyDocuments();
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
    enabled: loadSecondary,
  });

  const agreementRenewalQ = useQuery({
    queryKey: tenantQueryKeys.agreementRenewal(),
    queryFn: () => tenantPortalApi.getAgreementRenewal(),
    staleTime: 60_000,
    enabled: loadSecondary,
  });

  const renewalOfferQ = useQuery({
    queryKey: ['tenant', 'me', 'renewal-offer'],
    queryFn: () => tenantPortalApi.getTenantRenewalOffer(),
    staleTime: 60_000,
    enabled: loadSecondary,
  });

  const refetchAll = () => {
    profileQ.refetch();
    duesQ.refetch();
    readModelQ.refetch();
    paymentsQ.refetch();
    roomQ.refetch();
    scoreQ.refetch();
    advanceQ.refetch();
    moveOutQ.refetch();
    notificationsQ.refetch();
    documentsQ.refetch();
    agreementRenewalQ.refetch();
    renewalOfferQ.refetch();
  };

  return {
    profile: profileQ.data,
    dues: duesQ.data,
    readModel: readModelQ.data,
    payments: paymentsQ.data,
    room: roomQ.data,
    score: scoreQ.data,
    advance: advanceQ.data,
    moveOut: moveOutQ.data,
    notifications: notificationsQ.data,
    documents: documentsQ.data,
    agreementRenewal: agreementRenewalQ.data,
    renewalOffer: renewalOfferQ.data,
    isLoading: criticalLoading,
    refetchAll,
  };
}
