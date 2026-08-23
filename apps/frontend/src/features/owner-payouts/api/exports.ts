import api from '@lib/api-client';
import type { ExportDocumentId, PeriodPresetId } from '@features/owner-money/export/exportDocuments';

/**
 * The owner's Money exports. The only layer that knows these endpoint shapes.
 *
 * Period presets are sent by NAME, never as resolved dates — "this financial
 * year" then means April–March because the server says so, not because a
 * browser agreed. That is the mistake this feature is most likely to make
 * silently, and an accountant would find it months later.
 */

export type ExportParams = {
  document: ExportDocumentId;
  preset: PeriodPresetId;
  from?: string;
  to?: string;
  hostelId?: string | null;
};

function toQuery(params: ExportParams): Record<string, string> {
  const query: Record<string, string> = { document: params.document };
  if (params.preset === 'custom') {
    query.from = params.from ?? '';
    query.to = params.to ?? '';
  } else {
    query.preset = params.preset;
  }
  if (params.hostelId) query.hostelId = params.hostelId;
  return query;
}

export type ExportPreview = { count: number; total: number; noun: string; period: { label: string } };

export const ownerExportService = {
  async preview(params: ExportParams): Promise<ExportPreview> {
    const res = await api.get('/owner/exports/preview', { params: toQuery(params) });
    const body = res.data;
    return body?.data !== undefined ? body.data : body;
  },

  /** The finished file, plus the name the server gave it. */
  async download(params: ExportParams): Promise<{ blob: Blob; filename: string }> {
    const res = await api.get('/owner/exports', { params: toQuery(params), responseType: 'blob' });
    const disposition = String(res.headers?.['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: res.data as Blob, filename: match?.[1] ?? 'stayo-export' };
  },
};
