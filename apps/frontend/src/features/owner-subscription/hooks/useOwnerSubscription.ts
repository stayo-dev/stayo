import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import {
  ownerSubscriptionApi,
  type FoundingRenewalPaymentInput,
  type SubmitPaymentInput,
} from '../api';

export function useOwnerSubscription() {
  return useQuery({
    queryKey: queryKeys.owner.subscription(),
    queryFn: () => ownerSubscriptionApi.getOverview(),
    staleTime: 30_000,
  });
}

export function useSubscriptionPlans(enabled = true) {
  return useQuery({
    queryKey: queryKeys.owner.subscriptionPlans(),
    queryFn: () => ownerSubscriptionApi.getPlans(),
    staleTime: 60_000,
    enabled,
  });
}

export function usePaymentContext(enabled = true) {
  return useQuery({
    queryKey: queryKeys.owner.subscriptionPaymentContext(),
    queryFn: () => ownerSubscriptionApi.getPaymentContext(),
    staleTime: 5 * 60_000,
    enabled,
  });
}

/**
 * Backend-computed prorated upgrade amount for `planId` (optionally with
 * `extraBeds`). Only enabled when a target is chosen. `planId` may be the
 * owner's own current plan when they're only adding extra beds.
 */
export function useUpgradePreview(planId: string | null, extraBeds = 0) {
  return useQuery({
    queryKey: queryKeys.owner.subscriptionUpgradePreview(planId ?? '', extraBeds),
    queryFn: () => ownerSubscriptionApi.getUpgradePreview(planId as string, extraBeds),
    enabled: Boolean(planId),
    retry: false,
    staleTime: 30_000,
  });
}

export function useSubmitSubscriptionPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { input: SubmitPaymentInput; proofFile?: File | null }) => {
      let proofUrl = args.input.proof_file_url;
      if (args.proofFile) {
        const uploaded = await ownerSubscriptionApi.uploadProof(args.proofFile);
        proofUrl = uploaded.url;
      }
      return ownerSubscriptionApi.submitPayment({ ...args.input, proof_file_url: proofUrl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.subscription() });
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.subscriptionPlans() });
    },
  });
}

export function useScheduleDowngrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => ownerSubscriptionApi.scheduleDowngrade(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.subscription() });
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.subscriptionPlans() });
    },
  });
}

export function useCancelDowngrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ownerSubscriptionApi.cancelDowngrade(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.subscription() });
    },
  });
}

/** Founding Partner Phase 1 — the current usage-derived renewal amount. Read-only. */
export function useFoundingRenewalPreview(enabled = true) {
  return useQuery({
    queryKey: queryKeys.owner.subscriptionFoundingRenewalPreview(),
    queryFn: () => ownerSubscriptionApi.getFoundingRenewalPreview(),
    enabled,
    staleTime: 15_000,
  });
}

export function useSubmitFoundingRenewalPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { input: FoundingRenewalPaymentInput; proofFile?: File | null }) => {
      let proofUrl = args.input.proof_file_url;
      if (args.proofFile) {
        const uploaded = await ownerSubscriptionApi.uploadProof(args.proofFile);
        proofUrl = uploaded.url;
      }
      return ownerSubscriptionApi.submitFoundingRenewalPayment({ ...args.input, proof_file_url: proofUrl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.subscription() });
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.subscriptionFoundingRenewalPreview() });
    },
  });
}
