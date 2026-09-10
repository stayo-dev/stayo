import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configApi } from '@features/owner-more/api/configApi';
import { ownerService } from '@features/owners/api';
import { policyKey, useHostelPolicy } from '@features/settings/settingsHooks';

const templateKey = (hostelId: string) => ['owner', 'agreement-template', hostelId];

/**
 * The hostel's current agreement state, for the builder's agreement step.
 *
 * Deliberately takes an explicit `hostelId` rather than the owner's primary
 * hostel — `useAgreementTemplate` under `owner-more` assumes
 * `session.primaryHostelId`, which is wrong here: this has to work for
 * whichever hostel the builder is on, including the owner's 2nd or 3rd.
 */
export function useAgreementSetupState(hostelId: string | null) {
  const policyQuery = useHostelPolicy(hostelId);
  const templateQuery = useQuery({
    queryKey: hostelId ? templateKey(hostelId) : ['noop'],
    queryFn: () => configApi.getAgreementTemplate(hostelId!),
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });

  const agreementRequired = policyQuery.data?.policy?.tenant_rules?.agreement_required !== false;
  const signatureUrl = templateQuery.data?.active?.owner_signature_url ?? null;

  return {
    isLoading: policyQuery.isLoading || templateQuery.isLoading,
    agreementRequired,
    signatureConfigured: Boolean(signatureUrl),
    signatureUrl,
    hasActiveTemplate: Boolean(templateQuery.data?.active),
  };
}

export type SaveAgreementDecisionInput =
  | { choice: 'no' }
  | { choice: 'yes'; signatureFile: File; signatureUrl?: undefined; hasActiveTemplate: boolean }
  /** Reusing a signature already captured on another of this owner's hostels. */
  | { choice: 'yes'; signatureUrl: string; signatureFile?: undefined; hasActiveTemplate: boolean };

/**
 * Saves the owner's one-time answer to "does this hostel use a tenant
 * agreement?".
 *
 * "Yes" runs two requests in sequence, not parallel — publishing first,
 * then signing — because the signature route attaches to whichever template
 * is currently `is_active: true` on the hostel; publishing has to land before
 * signing can mean anything, and a partial failure (published but unsigned)
 * is a state the owner can retry from, not a silent race.
 */
export function useSaveAgreementDecision(hostelId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveAgreementDecisionInput) => {
      if (input.choice === 'no') {
        return ownerService.updateHostelPolicy(hostelId, { tenant_rules: { agreement_required: false } });
      }

      if (!input.hasActiveTemplate) {
        await configApi.publishAgreementTemplate(hostelId);
      }

      // Reuse points the new template at a signature this owner already
      // captured, rather than re-uploading the same image: the URL is already
      // in ImageKit, and fetching it back into a blob only to post it again
      // would spend a round trip and a duplicate asset to end up in the same
      // place.
      if (input.signatureUrl) {
        await configApi.reuseOwnerSignature(hostelId, input.signatureUrl);
      } else if (input.signatureFile) {
        await configApi.uploadOwnerSignature(hostelId, input.signatureFile);
      }

      return ownerService.updateHostelPolicy(hostelId, { tenant_rules: { agreement_required: true } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: policyKey(hostelId) });
      qc.invalidateQueries({ queryKey: templateKey(hostelId) });
    },
  });
}

/** Convenience: both hooks together, as the agreement step actually uses them. */
export function useAgreementSetup(hostelId: string | null) {
  const state = useAgreementSetupState(hostelId);
  const save = useSaveAgreementDecision(hostelId ?? '');
  return useMemo(() => ({ ...state, save }), [state, save]);
}
