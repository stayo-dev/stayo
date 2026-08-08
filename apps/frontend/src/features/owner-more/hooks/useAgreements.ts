import { useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { configApi } from '../api/configApi';

/** Templates with their issued-agreement counts, for the Templates screen. */
export function useAgreementTemplates() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;

  const query = useQuery({
    queryKey: ['owner', 'agreement-templates', hostelId],
    queryFn: () => configApi.getAgreementTemplates(hostelId!),
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });

  return { templates: query.data ?? [], isLoading: query.isLoading, hostelId };
}

/**
 * The active template's full content, for the Agreements hub, the detail
 * preview and the clause manager. Prefers a draft's content when one exists —
 * that is what the owner last edited and what they expect to see.
 */
export function useAgreementTemplate() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;

  const query = useQuery({
    queryKey: ['owner', 'agreement-template', hostelId],
    queryFn: () => configApi.getAgreementTemplate(hostelId!),
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });

  const active = query.data?.active ?? null;
  const rules = query.data?.draft?.rules_content ?? active?.rules_content ?? null;

  return {
    active,
    rules,
    defaultRules: query.data?.default_rules ?? null,
    hasDraft: Boolean(query.data?.draft),
    signatureConfigured: Boolean(active?.owner_signature_url),
    isLoading: query.isLoading,
    hostelId,
  };
}
