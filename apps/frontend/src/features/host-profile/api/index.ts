import api from '@lib/api-client';
import type { AdminHost, EditableHost, HostAdminPatch, HostDraft } from '../model/types';

/**
 * Meet your host (ADR-200) — the only layer that knows these endpoints.
 * One feature for both ends, like hostel-marketing: the owner's screen and the
 * admin's drawer read and write the same record.
 */

function unwrap<T>(response: { data: any }): T {
  const body = response.data;
  return (body && body.success !== undefined ? body.data : body) as T;
}

export const hostProfileService = {
  getMine: async () => unwrap<EditableHost>(await api.get('/owner/me/host-profile')),
  saveMine: async (draft: HostDraft) => unwrap<EditableHost>(await api.put('/owner/me/host-profile', draft)),
  getForOwner: async (ownerId: string) =>
    unwrap<AdminHost>(await api.get(`/platform-admin/owners/${ownerId}/host-profile`)),
  updateForOwner: async (ownerId: string, patch: HostAdminPatch) =>
    unwrap<AdminHost>(await api.patch(`/platform-admin/owners/${ownerId}/host-profile`, patch)),
  replaceOwnerPhoto: async (ownerId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<{ photo_url: string | null }>(await api.post(`/platform-admin/owners/${ownerId}/photo`, form));
  },
  removeOwnerPhoto: async (ownerId: string) =>
    unwrap<{ photo_url: string | null }>(await api.delete(`/platform-admin/owners/${ownerId}/photo`)),
};

/** The server's own reason (e.g. "Remove the phone number — …"), or the fallback. */
export function hostProfileErrorMessage(error: unknown, fallback: string): string {
  const message = (error as any)?.response?.data?.error?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}
