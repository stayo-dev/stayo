import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { guardianVerificationApi } from './api';

export const guardianVerificationKey = () => ['tenant', 'guardian-verification'];

/**
 * The tenant's own guardian-verification state (ADR-212).
 *
 * Every judgement in the response — the state, the deadline, whether the wall
 * is due right now — is computed server-side from one shared module, so this
 * hook deliberately returns it unprocessed. A second opinion formed here is
 * exactly the drift this feature was built to avoid.
 */
export function useGuardianVerification(enabled = true) {
  return useQuery({
    queryKey: guardianVerificationKey(),
    queryFn: guardianVerificationApi.status,
    enabled,
    staleTime: 60_000,
  });
}

export function useRequestGuardianConfirmation() {
  const qc = useQueryClient();
  return useMutation({
    // Takes the number explicitly rather than passing the API function
    // straight through, so callers inside the app — where the stored number is
    // the only number — can call `mutate()` with nothing and let the backend
    // read it off the tenancy.
    mutationFn: (guardianPhone?: string) => guardianVerificationApi.requestConfirmation(guardianPhone),
    onSuccess: () => qc.invalidateQueries({ queryKey: guardianVerificationKey() }),
  });
}

export function useDismissGuardianWall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: guardianVerificationApi.dismiss,
    onSuccess: () => qc.invalidateQueries({ queryKey: guardianVerificationKey() }),
  });
}
