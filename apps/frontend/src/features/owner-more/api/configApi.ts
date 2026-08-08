import api from '@lib/api-client';
import type { ConfigChangeEntry } from '../hooks/useConfigChanges';
import type { AgreementTemplateSummary, RulesContent } from '../config/agreements';

/**
 * Configuration-hub endpoints. This is the only layer allowed to know the
 * endpoint shape for this feature (scripts/check-architecture.mjs enforces that
 * everything reaches the network through `@lib/api-client`).
 */
export const configApi = {
  getRecentChanges: async (limit = 8): Promise<ConfigChangeEntry[]> => {
    const response = await api.get('/owner/config-changes', { params: { limit } });
    return (response.data?.changes ?? []) as ConfigChangeEntry[];
  },

  /** Every template with its issued-agreement count — the Templates screen. */
  getAgreementTemplates: async (hostelId: string): Promise<AgreementTemplateSummary[]> => {
    const response = await api.get(`/owner/hostels/${hostelId}/agreement-templates`);
    return (response.data?.templates ?? []) as AgreementTemplateSummary[];
  },

  /**
   * The active template plus any draft and the shipped defaults. This is the
   * pre-existing endpoint the activation flow also uses — it carries the full
   * `rules_content` the detail and clause screens need.
   */
  getAgreementTemplate: async (hostelId: string) => {
    const response = await api.get(`/owner/hostels/${hostelId}/agreement-template`);
    return response.data as {
      active?: { id: string; title: string; rules_content: RulesContent | null; owner_signature_url: string | null; version_number: number; status: string } | null;
      draft?: { id: string; rules_content: RulesContent | null } | null;
      default_rules?: RulesContent;
    };
  },

  /** Saves clause edits as a draft. `publish` is a separate, deliberate action. */
  saveAgreementDraft: async (hostelId: string, rulesContent: RulesContent, title?: string) => {
    const response = await api.post(`/owner/hostels/${hostelId}/agreement-template`, {
      action: 'save_draft',
      rules_content: rulesContent,
      ...(title ? { title } : {}),
    });
    return response.data;
  },
};
