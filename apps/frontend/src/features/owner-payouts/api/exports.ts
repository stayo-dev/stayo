import api from '@lib/api-client';
import { filenameFromContentDisposition } from '@shared/lib/downloadBlob';
import type { ExportPreviewData } from '@features/owner-money/export/exportDocuments';

/**
 * The owner's Money exports. The only layer that knows these endpoint shapes.
 *
 * The query is built by `owner-money/export/exportRequest.ts` and arrives here
 * finished — this module does not decide what is in the file, it only asks for
 * it. Period presets are therefore sent by NAME, never as resolved dates:
 * "this financial year" means April–March because the server says so, not
 * because a browser agreed. That is the mistake this feature is most likely to
 * make silently, and an accountant would find it months later.
 */

export type ExportQueryParams = Record<string, string>;

export type ExportPreview = ExportPreviewData & { period: { label: string } };

export const ownerExportService = {
  async preview(params: ExportQueryParams, signal?: AbortSignal): Promise<ExportPreview> {
    const res = await api.get('/owner/exports/preview', { params, signal });
    const body = res.data;
    return body?.data !== undefined ? body.data : body;
  },

  /** The finished file, plus the name the server gave it. */
  async download(params: ExportQueryParams): Promise<{ blob: Blob; filename: string }> {
    const res = await api.get('/owner/exports', { params, responseType: 'blob' });
    return {
      blob: res.data as Blob,
      filename: filenameFromContentDisposition(
        res.headers?.['content-disposition'] as string | undefined,
        'stayo-export.xlsx',
      ),
    };
  },
};
