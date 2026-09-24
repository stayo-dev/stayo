import api from '@lib/api-client';
import type { GuardianConsent, MyStay, StayBoard, StayEventInput, StaySummary, TenantStay, TenantStayEventInput } from '../types';

/** `apiResponse` spreads object payloads at the top level; drop the envelope flag. */
function body<T>(response: { data: any }): T {
  const { success: _success, ...rest } = response.data ?? {};
  return rest as T;
}

export const stayApi = {
  getMine: async (): Promise<MyStay> => body<MyStay>(await api.get('/tenant/stay')),

  record: async (input: TenantStayEventInput): Promise<TenantStay> =>
    body<{ stay: TenantStay }>(await api.post('/tenant/stay/events', input)).stay,

  /** ADR-234. Posted separately from the event, so a declined consent survives a failed leave. */
  setGuardianConsent: async (granted: boolean, source: 'QR' | 'APP'): Promise<GuardianConsent | null> =>
    body<{ guardian: GuardianConsent | null }>(
      await api.post('/tenant/stay/guardian-consent', { granted, source }),
    ).guardian,

  getBoard: async (hostelId: string): Promise<StayBoard> => body<StayBoard>(await api.get(`/hostels/${hostelId}/stay`)),

  recordForResident: async (hostelId: string, tenantId: string, input: StayEventInput): Promise<TenantStay> =>
    body<{ stay: TenantStay }>(await api.post(`/hostels/${hostelId}/stay/tenants/${tenantId}/events`, input)).stay,

  getSummary: async (): Promise<StaySummary> => body<StaySummary>(await api.get('/owner/stay/summary')),

  downloadPoster: async (hostelId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await api.get(`/hostels/${hostelId}/stay/poster`, { responseType: 'blob' });
    const disposition = String((response.headers as any)?.['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: response.data as Blob, filename: match?.[1] ?? 'stay-qr.pdf' };
  },
};
