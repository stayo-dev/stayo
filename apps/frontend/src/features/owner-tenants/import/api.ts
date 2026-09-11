import api from '@lib/api-client';

/**
 * The bulk-import endpoints, in one place.
 *
 * This is the only layer that knows their shapes — `check-architecture.mjs`
 * fails the build on a raw fetch or axios anywhere else in the feature tree.
 */

export interface ImportIssue {
  code: string;
  severity: 'BLOCKER' | 'NEEDS_CHOICE' | 'NOTICE';
  row: number;
  title: string;
  detail: string;
  field?: string;
  fix: { kind: string; options?: string[] };
}

export interface ImportRow {
  row: number;
  data: Record<string, unknown>;
  issues: ImportIssue[];
}

export interface UploadResult {
  batch_id: string;
  filename: string;
  validation: {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    duplicate_rows: number;
    warnings: number;
    blockers: number;
    choices: number;
    requires_historical_join_date_confirmation: boolean;
  };
  rooms?: { to_create: number; to_update: number; unchanged: number; issues: ImportIssue[] };
  preview: { valid: ImportRow[]; invalid: ImportRow[]; duplicates: ImportRow[] };
}

export interface ConfirmResult {
  batch_id: string;
  hostel: { id: string; name: string };
  progress: {
    total: number;
    processed: number;
    remaining: number;
    succeeded: number;
    failed: number;
    stage: 'ROOMS' | 'TENANTS' | 'DONE';
  };
  rooms: { created: number; updated: number; errors: Array<{ room_no: string; error: string }> };
  result: {
    total_requested: number;
    success_count: number;
    failure_count: number;
    email_failure_count: number;
    errors: Array<{ row: number; error: string }>;
  };
}

/**
 * The workbook is built from one hostel's rooms, so it needs the hostel.
 * Returned as a Blob — the caller saves it.
 */
export async function downloadTemplate(hostelId: string): Promise<Blob> {
  const response = await api.get('/bulk-import/template', {
    params: { hostel_id: hostelId },
    responseType: 'blob',
  });
  return response.data;
}

export async function uploadWorkbook(hostelId: string, file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('hostel_id', hostelId);
  const response = await api.post('/bulk-import/upload', form);
  return response.data?.data ?? response.data;
}

export async function fetchBatch(batchId: string) {
  const response = await api.get(`/bulk-import/${batchId}/confirm`);
  return response.data?.data ?? response.data;
}

/** One chunk. The caller re-posts while `progress.remaining > 0`. */
export async function confirmChunk(
  batchId: string,
  options: { confirmHistoricalJoinDates?: boolean; chunkSize?: number } = {}
): Promise<ConfirmResult> {
  const response = await api.post(`/bulk-import/${batchId}/confirm`, {
    ...(options.confirmHistoricalJoinDates ? { confirm_historical_join_dates: true } : {}),
    ...(options.chunkSize ? { chunk_size: options.chunkSize } : {}),
  });
  return response.data?.data ?? response.data;
}

/** Re-validate edited rows in place, keeping the same batch. */
export async function revalidateRows(input: {
  batchId: string;
  hostelId: string;
  rows: Array<Record<string, unknown>>;
}): Promise<UploadResult> {
  const response = await api.post('/bulk-import/revalidate', {
    batch_id: input.batchId,
    hostel_id: input.hostelId,
    rows: input.rows,
  });
  return response.data?.data ?? response.data;
}

/** Send the invitations this import queued — all of them, or a wave. */
export async function sendInvitations(
  batchId: string,
  options: { limit?: number; invitationIds?: string[] } = {}
): Promise<{ sent: number; failed: number; remaining: number; errors: Array<{ invitation_id: string; error: string }> }> {
  const response = await api.post(`/bulk-import/${batchId}/dispatch`, {
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.invitationIds?.length ? { invitation_ids: options.invitationIds } : {}),
  });
  return response.data?.data ?? response.data;
}
