import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';

/**
 * Owner-private notes on a tenant.
 *
 * `tenant_notes` and its full GET/POST/DELETE API have existed all along, but
 * no frontend surface called them — the invited-tenant screen kept notes in
 * component state seeded with two invented examples, so nothing an owner typed
 * survived a refresh and every tenant appeared to carry the same two notes.
 */

export interface TenantNote {
  id: string;
  content: string;
  createdAt: string;
}

function toNote(raw: Record<string, any>): TenantNote {
  return {
    id: String(raw.id),
    content: String(raw.content ?? ''),
    createdAt: String(raw.created_at ?? ''),
  };
}

export function tenantNotesKey(tenantId: string) {
  return ['owner', 'tenant', tenantId, 'notes'] as const;
}

export function useTenantNotes(tenantId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: tenantNotesKey(tenantId),
    queryFn: async () => {
      const result = await tenantService.getNotes(tenantId);
      const rows = Array.isArray(result?.notes) ? result.notes : Array.isArray(result) ? result : [];
      return rows.map(toNote);
    },
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: tenantNotesKey(tenantId) });

  const addNote = useMutation({
    mutationFn: (content: string) => tenantService.addNote(tenantId, content),
    onSuccess: invalidate,
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: string) => tenantService.deleteNote(tenantId, noteId),
    onSuccess: invalidate,
  });

  return {
    notes: query.data ?? [],
    isLoading: query.isLoading,
    addNote,
    deleteNote,
  };
}
