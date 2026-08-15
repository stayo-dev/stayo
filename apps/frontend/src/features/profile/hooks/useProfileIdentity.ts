import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@lib/queryKeys';
import { useAuth } from '@context/AuthContext';

import { profileService, type IdentityPatch, type ProfileIdentity } from '../api';

export function useProfileIdentity() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.profile.identity(),
    queryFn: () => profileService.getIdentity(),
    enabled: Boolean(user),
  });
}

export function useUpdateProfileIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: IdentityPatch) => profileService.updateIdentity(patch),
    onSuccess: (identity: ProfileIdentity) => {
      // The PATCH returns the merged record, so seed the cache with it rather
      // than round-tripping a refetch the server has already answered.
      queryClient.setQueryData(queryKeys.profile.identity(), identity);
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.documents() });
    },
  });
}

export function useResidencyHistory() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.profile.residencyHistory(),
    queryFn: () => profileService.getResidencyHistory(),
    enabled: Boolean(user),
  });
}

export function useDisclosures() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.profile.disclosures(),
    queryFn: () => profileService.getDisclosures(),
    enabled: Boolean(user),
  });
}

export function useSetDisclosure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ hostelId, status }: { hostelId: string; status: 'APPROVED' | 'DECLINED' | 'REVOKED' }) =>
      profileService.setDisclosure(hostelId, status),
    onSuccess: (disclosures) => {
      queryClient.setQueryData(queryKeys.profile.disclosures(), disclosures);
    },
  });
}

export function useVaultDocuments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.profile.documents(),
    queryFn: () => profileService.listDocuments(),
    enabled: Boolean(user),
  });
}
