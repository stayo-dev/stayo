import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@lib/api-client';
import { tenantPortalApi } from '@features/tenant-portal/api';
import { tenantService } from '@features/tenants/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';

const QUERY_KEY = ['tenant', 'portal-profile'] as const;
const DOCUMENTS_QUERY_KEY = ['tenant', 'documents-with-required'] as const;
const PROFILE_REQUESTS_QUERY_KEY = ['tenant', 'profile-requests'] as const;

/** Fields that need owner approval before they take effect — see `updateTenantSelfProfile` on the backend, which enforces this server-side too. Only phone and email are governed (2026-08-14 product decision, narrowed same day) — everything else saves directly. */
export const GOVERNED_PROFILE_FIELDS = ['phone_1', 'personal_email'] as const;
export type GovernedProfileField = (typeof GOVERNED_PROFILE_FIELDS)[number];

const DOC_TYPE_LABEL: Record<string, string> = {
  AADHAAR: 'Aadhaar card',
  COLLEGE_ID: 'College ID',
  WORK_ID: 'Work ID',
  RENTAL_AGREEMENT: 'Rental agreement',
};

/**
 * Full tenant profile payload — the same `GET /tenants/me/profile` composite
 * (tenant/profile/contacts/hostel/owner_contact/room/documents/verification)
 * the frozen `TenantProfilePortalPage` reads, shared here (same query key,
 * so both consumers dedupe) for the StayO Profile tab's hero, detail cards,
 * and documents list.
 */
export function useTenantProfile() {
  const session = useTenantSession();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => tenantPortalApi.getMyProfile(),
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  /** `GET /tenants/me/documents` — same underlying docs as `getMyProfile()`'s `documents[]`, but this is the only endpoint that also returns `required_documents` (profile-type-dependent), needed to show real missing-document rows instead of guessing. */
  const documentsQuery = useQuery({
    queryKey: DOCUMENTS_QUERY_KEY,
    queryFn: async () => {
      const response = await api.get('/tenants/me/documents');
      const body = response.data?.data ?? response.data ?? {};
      return { documents: body.documents ?? [], requiredDocuments: body.required_documents ?? [] };
    },
    enabled: session.isAuthenticated,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => tenantService.updateMyProfile(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => tenantPortalApi.uploadMyPhoto(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const documentMutation = useMutation({
    mutationFn: ({ docType, file, docNumber }: { docType: string; file: File; docNumber?: string }) =>
      tenantPortalApi.uploadMyDocument(docType, file, docNumber ?? ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
    },
  });

  /** Pending/recent change requests the tenant has submitted for governed fields (`GOVERNED_PROFILE_FIELDS`) — surfaced so the Profile tab can show "awaiting owner approval" instead of silently accepting a second edit. */
  const profileRequestsQuery = useQuery({
    queryKey: PROFILE_REQUESTS_QUERY_KEY,
    queryFn: async () => {
      const response = await api.get('/tenants/me/profile-requests');
      const body = response.data?.data ?? response.data ?? {};
      return body.requests ?? [];
    },
    enabled: session.isAuthenticated,
    staleTime: 15_000,
  });

  const changeRequestMutation = useMutation({
    mutationFn: async ({ fields, reason }: { fields: Partial<Record<GovernedProfileField, string>>; reason: string }) => {
      const response = await api.post('/tenants/me/profile-requests', { fields, reason });
      return response.data?.data ?? response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROFILE_REQUESTS_QUERY_KEY }),
  });

  const data = query.data ?? {};
  const uploadedDocuments = documentsQuery.data?.documents ?? [];
  const requiredDocuments: string[] = documentsQuery.data?.requiredDocuments ?? [];
  const uploadedTypes = new Set(uploadedDocuments.map((d: any) => d.doc_type));
  const missingDocuments = requiredDocuments
    .filter((type) => !uploadedTypes.has(type))
    .map((type) => ({ doc_type: type, doc_type_label: DOC_TYPE_LABEL[type] ?? type, document_status: 'MISSING' as const }));

  return {
    isLoading: query.isLoading,
    tenant: data.tenant ?? null,
    profile: data.profile ?? null,
    contacts: data.contacts ?? null,
    hostel: data.hostel ?? null,
    ownerContact: data.owner_contact ?? null,
    room: data.room ?? null,
    documents: uploadedDocuments,
    missingDocuments,
    docLabel: DOC_TYPE_LABEL,
    verification: data.verification ?? null,
    moveOut: data.move_out ?? null,
    advance: data.advance ?? null,
    updateProfile: (patch: Record<string, unknown>) => updateMutation.mutateAsync(patch),
    isUpdating: updateMutation.isPending,
    uploadPhoto: (file: File) => photoMutation.mutateAsync(file),
    isUploadingPhoto: photoMutation.isPending,
    uploadDocument: (args: { docType: string; file: File; docNumber?: string }) => documentMutation.mutateAsync(args),
    isUploadingDocument: documentMutation.isPending,
    pendingProfileRequest: (profileRequestsQuery.data ?? []).find((r: any) => r.status === 'PENDING') ?? null,
    submitChangeRequest: (args: { fields: Partial<Record<GovernedProfileField, string>>; reason: string }) => changeRequestMutation.mutateAsync(args),
    isSubmittingChangeRequest: changeRequestMutation.isPending,
  };
}
