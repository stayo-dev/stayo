import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import {
  confirmChunk,
  downloadCorrected,
  downloadTemplate,
  revalidateRows,
  sendInvitations,
  uploadWorkbook,
  type ConfirmResult,
  type UploadResult,
} from './api';
import { editRow, mergeEdits, type RowEdits } from './rowEdits';
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
  const [edits, setEdits] = useState<RowEdits>({});
  const [busy, setBusy] = useState<null | 'template' | 'upload' | 'import' | 'send' | 'recheck' | 'corrected'>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ sent: number; remaining: number; failed: number } | null>(null);

  const state: ImportState = {
    hostelId,
    templateDownloaded,
    batchId: upload?.batch_id ?? null,
    imported: Boolean(confirmState && confirmState.progress.remaining === 0),
    importing: busy === 'import',
    anySent: (sendResult?.sent ?? 0) > 0,
    // progress.succeeded is the batch total; result.success_count is only
    // this chunk, which offered to send 15 of a 40-row import.
    queuedInvitations: confirmState ? Math.max(0, confirmState.progress.succeeded - (sendResult?.sent ?? 0)) : 0,
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
      // Appended, and the URL revoked on the next tick: a detached anchor
      // does not fire outside Chromium, and revoking synchronously can cancel
      // the download before it starts.
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
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

  const applyEdit = useCallback((row: number, field: string, value: string) => {
    setEdits((current) => editRow(current, row, field, value));
  }, []);

  /**
   * Runs the owner's in-screen fixes through the same checks as the file.
   *
   * `revalidate` re-runs the whole batch in place, so the corrected rows
   * replace the old ones rather than accumulating — and the batch keeps its
   * id, which is what lets the owner come back to it.
   */
  const recheck = useCallback(async () => {
    if (!upload?.batch_id || !hostelId || !queue) return;
    setBusy('recheck');
    setError(null);
    try {
      const result = await revalidateRows({
        batchId: upload.batch_id,
        hostelId,
        rows: mergeEdits(queue, edits),
      });
      setUpload((current) => (current ? { ...current, ...result } : result));
      setQueue(buildReviewQueue(result.preview));
      setEdits({});
    } catch (e: any) {
      setError(readError(e, "We couldn't re-check those changes. Nothing was lost — try again."));
    } finally {
      setBusy(null);
    }
  }, [upload, hostelId, queue, edits]);

  /** The owner's own file back, with the fixes in it. */
  const getCorrectedSheet = useCallback(async () => {
    if (!upload?.batch_id) return;
    setBusy('corrected');
    setError(null);
    try {
      const blob = await downloadCorrected(upload.batch_id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tenant-import-corrected.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e: any) {
      setError(readError(e, "We couldn't build that file. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  }, [upload]);

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

    // Only the owner's own acknowledgement counts. Sending true because the
    // server *asked* for confirmation would answer the question on their
    // behalf, which is the whole point of the gate.
    const confirmHistorical = acknowledged.includes('BACKFILL_CAPPED');

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
        // The route sends a bounded slice so a large batch cannot outrun the
        // function's time limit — so "send all" is a loop, like the import.
        let guard = 0;
        let total = 0;
        let last = { sent: 0, failed: 0, remaining: 0 };
        do {
          last = await sendInvitations(upload.batch_id, limit ? { limit } : {});
          total += last.sent;
          setSendResult((current) => ({
            sent: (current?.sent ?? 0) + last.sent,
            failed: last.failed,
            remaining: last.remaining,
          }));
          guard += 1;
        } while (!limit && last.remaining > 0 && last.sent > 0 && guard < 50);
        void total;
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
    setEdits({});
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
    edits,
    applyEdit,
    recheck,
    getCorrectedSheet,
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
