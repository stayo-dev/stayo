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

  /**
   * Publishes an agreement template.
   *
   * **`rulesContent` is required whenever the owner has written anything.**
   * The route resolves `rules_content = body.rules_content ||
   * DEFAULT_AGREEMENT_TEMPLATE` and, in the same transaction, *deletes the
   * draft*. Publishing without content therefore throws away everything the
   * owner wrote and publishes Stayo's stock template over it.
   *
   * Omitting it is correct in exactly one place: the Add Hostel builder's
   * agreement step, for a hostel that has never published and has no draft,
   * where the default clauses are the intended content. `owner_name` stays
   * omitted either way — the route falls back to the hostel's own profile
   * name.
   */
  publishAgreementTemplate: async (hostelId: string, rulesContent?: RulesContent) => {
    const response = await api.post(`/owner/hostels/${hostelId}/agreement-template`, {
      action: 'publish',
      ...(rulesContent ? { rules_content: rulesContent } : {}),
    });
    return response.data;
  },

  /**
   * Points this hostel's active template at a signature the owner already
   * captured on another hostel. Same field `uploadOwnerSignature` writes, set
   * from an existing URL rather than a fresh upload — the image is already in
   * ImageKit, and re-posting it would create a duplicate asset to reach the
   * same result.
   */
  reuseOwnerSignature: async (hostelId: string, ownerSignatureUrl: string) => {
    const response = await api.post(`/owner/hostels/${hostelId}/agreement-template`, {
      action: 'publish',
      owner_signature_url: ownerSignatureUrl,
    });
    return response.data;
  },

  /**
   * The owner's most recent signature across their hostels, so the builder can
   * offer to reuse it instead of asking them to draw the same mark again.
   */
  existingOwnerSignature: async () => {
    const response = await api.get('/owner/signature');
    return response.data?.data ?? response.data;
  },

  /**
   * Uploads the owner's signature stamp, captured once per hostel. The
   * backend attaches it to the hostel's currently-active template — publish
   * this template first if one does not exist yet, or the upload has nothing
   * to attach to.
   */
  uploadOwnerSignature: async (hostelId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post(`/owner/hostels/${hostelId}/agreement-template/signature`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};
