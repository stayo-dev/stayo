import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@lib/api-client';
import { tenantPortalApi } from '@features/tenant-portal/api';
import { tenantService } from '@features/tenants/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';

const QUERY_KEY = ['tenant', 'portal-profile'] as const;
const DOCUMENTS_QUERY_KEY = ['tenant', 'documents-with-required'] as const;

/**
 * The two contact details a change has to be *proved* for — by the person
 * changing them, with a code sent to the new value.
 *
 * They used to be "governed": editable only with the hostel owner's approval,
 * through a queue that held 0 rows, ever. Nobody approves these now. The code
 * is not a permission — it is how we know the detail still reaches you
 * (ADR-119).
 */
export const VERIFIED_PROFILE_FIELDS = ['phone_1', 'personal_email'] as const;
export type VerifiedProfileField = (typeof VERIFIED_PROFILE_FIELDS)[number];

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
  };
}
