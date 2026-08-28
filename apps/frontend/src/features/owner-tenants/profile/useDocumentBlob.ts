import { useEffect, useState } from 'react';
import { documentFileService, apiBaseUrl } from '../api/documentFiles';
import { resolveDocumentSource } from './documentSource';

/**
 * An object URL for a tenant document, fetched with the caller's real session.
 *
 * Revokes the URL on unmount and whenever the source changes — an object URL
 * that is never revoked pins the whole file in memory for the life of the tab,
 * which matters here because these are photographs of ID documents.
 */

export type DocumentBlobStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DocumentBlobState {
  /** An object URL for an authenticated fetch, or the URL itself when direct. */
  objectUrl: string | null;
  contentType: string | null;
  /** How the URL was resolved — `direct` means no credentials were sent. */
  mode: 'authenticated' | 'direct' | null;
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
    mode: null,
    status: 'idle',
    error: null,
  });

  useEffect(() => {
    const source = resolveDocumentSource(url, apiBaseUrl);

    if (!source) {
      setState({ objectUrl: null, contentType: null, mode: null, status: 'idle', error: null });
      return;
    }

    // A vault document is a raw ImageKit URL on a third-party host. Fetching
    // it through the API client would attach the viewer's bearer token to
    // someone else's server (the interceptor does not check the host), so it
    // is handed to the <img>/<object> directly instead.
    if (source.mode === 'direct') {
      setState({ objectUrl: source.url, contentType: null, mode: 'direct', status: 'ready', error: null });
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;

    setState({ objectUrl: null, contentType: null, mode: 'authenticated', status: 'loading', error: null });

    documentFileService
      .fetchBlob(source.url)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setState({
          objectUrl: createdUrl,
          contentType: blob.type || null,
          mode: 'authenticated',
          status: 'ready',
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ objectUrl: null, contentType: null, mode: 'authenticated', status: 'error', error: describe(error) });
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url]);

  return state;
}
