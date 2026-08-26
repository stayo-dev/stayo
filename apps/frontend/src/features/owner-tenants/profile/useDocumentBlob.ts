import { useEffect, useState } from 'react';
import { documentFileService } from '../api/documentFiles';

/**
 * An object URL for a tenant document, fetched with the caller's real session.
 *
 * Revokes the URL on unmount and whenever the source changes — an object URL
 * that is never revoked pins the whole file in memory for the life of the tab,
 * which matters here because these are photographs of ID documents.
 */

export type DocumentBlobStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DocumentBlobState {
  objectUrl: string | null;
  contentType: string | null;
  status: DocumentBlobStatus;
  /** Owner-facing, and specific — a blank preview pane is indistinguishable from a bug. */
  error: string | null;
}

function describe(error: any): string {
  const status = error?.response?.status;
  if (status === 401 || status === 403) {
    return 'Your session expired while opening this. Sign in again to view it.';
  }
  if (status === 404) return 'This document is no longer available.';
  if (status === 502) return 'The stored file could not be reached. Ask the tenant to re-upload it.';
  return error?.response?.data?.error?.message || 'Could not open this document.';
}

export function useDocumentBlob(url: string | null | undefined): DocumentBlobState {
  const [state, setState] = useState<DocumentBlobState>({
    objectUrl: null,
    contentType: null,
    status: 'idle',
    error: null,
  });

  useEffect(() => {
    if (!url) {
      setState({ objectUrl: null, contentType: null, status: 'idle', error: null });
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;

    setState({ objectUrl: null, contentType: null, status: 'loading', error: null });

    documentFileService
      .fetchBlob(url)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setState({
          objectUrl: createdUrl,
          contentType: blob.type || null,
          status: 'ready',
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ objectUrl: null, contentType: null, status: 'error', error: describe(error) });
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url]);

  return state;
}
