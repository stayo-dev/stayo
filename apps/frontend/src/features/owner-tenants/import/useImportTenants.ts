import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import {
  confirmChunk,
  downloadTemplate,
  sendInvitations,
  uploadWorkbook,
  type ConfirmResult,
  type UploadResult,
} from './api';
import { buildReviewQueue, applyGroupDecision, type ReviewQueue } from './reviewQueue';
import { describeProgress, type ProgressView } from './importProgress';
import { stageFor, type ImportState, type Stage } from './importStages';

/**
 * The import, as one piece of state the screen renders.
 *
 * The chunk loop lives here rather than in a component: confirm processes a
 * bounded slice per request and the client re-posts until nothing remains, so
 * "import" is a loop, not a mutation. Keeping it here means the step component
 * stays a renderer, which is what makes the logic testable in a suite that
 * renders nothing.
 */
export function useImportTenants(hostelId: string | null) {
  const queryClient = useQueryClient();

  const [templateDownloaded, setTemplateDownloaded] = useState(false);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmResult | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | 'template' | 'upload' | 'import' | 'send'>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ sent: number; remaining: number; failed: number } | null>(null);

  const state: ImportState = {
    hostelId,
    templateDownloaded,
    batchId: upload?.batch_id ?? null,
    imported: Boolean(confirmState && confirmState.progress.remaining === 0),
    queuedInvitations: confirmState ? confirmState.result.success_count - (sendResult?.sent ?? 0) : 0,
  };

  const stage: Stage = stageFor(state);
  const progress: ProgressView = useMemo(
    () => describeProgress(confirmState?.progress, confirmState?.rooms),
    [confirmState]
  );

  const getTemplate = useCallback(async () => {
    if (!hostelId) return;
    setBusy('template');
    setError(null);
    try {
      const blob = await downloadTemplate(hostelId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tenant-import.xlsx';
      link.click();
      URL.revokeObjectURL(url);
      setTemplateDownloaded(true);
    } catch (e: any) {
      setError(readError(e, "We couldn't build your sheet. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  }, [hostelId]);

  const submitFile = useCallback(
    async (file: File) => {
      if (!hostelId) return;
      setBusy('upload');
      setError(null);
      try {
        const result = await uploadWorkbook(hostelId, file);
        setUpload(result);
        setQueue(buildReviewQueue(result.preview));
        setAcknowledged([]);
      } catch (e: any) {
        setError(readError(e, "We couldn't read that file."));
      } finally {
        setBusy(null);
      }
    },
    [hostelId]
  );

  const acknowledgeGroup = useCallback((code: string) => {
    setQueue((current) => (current ? applyGroupDecision(current, code) : current));
    setAcknowledged((current) => (current.includes(code) ? current : [...current, code]));
  }, []);

  /**
   * Runs the import to completion, one chunk at a time.
   *
   * Each response says what is left; the loop stops when nothing is. A guard
   * on total attempts means a server that stopped making progress ends the
   * loop rather than spinning forever.
   */
  const runImport = useCallback(async () => {
    if (!upload?.batch_id) return;
    setBusy('import');
    setError(null);

    const confirmHistorical =
      upload.validation.requires_historical_join_date_confirmation ||
      acknowledged.includes('BACKFILL_CAPPED');

    try {
      let guard = 0;
      let latest: ConfirmResult | null = null;
      do {
        latest = await confirmChunk(upload.batch_id, { confirmHistoricalJoinDates: confirmHistorical });
        setConfirmState(latest);
        guard += 1;
      } while (latest && latest.progress.remaining > 0 && guard < 200);

      if (hostelId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.tenants.all(hostelId) });
      }
    } catch (e: any) {
      setError(readError(e, 'The import stopped partway. Nothing already created was lost — try again to continue.'));
    } finally {
      setBusy(null);
    }
  }, [upload, acknowledged, hostelId, queryClient]);

  const send = useCallback(
    async (limit?: number) => {
      if (!upload?.batch_id) return;
      setBusy('send');
      setError(null);
      try {
        const result = await sendInvitations(upload.batch_id, limit ? { limit } : {});
        setSendResult((current) => ({
          sent: (current?.sent ?? 0) + result.sent,
          failed: result.failed,
          remaining: result.remaining,
        }));
      } catch (e: any) {
        setError(readError(e, "We couldn't send those invitations. Nothing was lost — try again."));
      } finally {
        setBusy(null);
      }
    },
    [upload]
  );

  const reset = useCallback(() => {
    setTemplateDownloaded(false);
    setUpload(null);
    setQueue(null);
    setConfirmState(null);
    setAcknowledged([]);
    setSendResult(null);
    setError(null);
    setBusy(null);
  }, []);

  return {
    stage,
    state,
    upload,
    queue,
    progress,
    sendResult,
    busy,
    error,
    getTemplate,
    submitFile,
    acknowledgeGroup,
    runImport,
    send,
    reset,
  };
}

/** The server's own message when it wrote one — it is better than ours. */
function readError(error: any, fallback: string): string {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    fallback
  );
}
