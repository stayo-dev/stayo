import api from '@lib/api-client';

/**
 * The API client's own normalized base, for deciding whether a document URL
 * belongs to us. Read off the instance rather than re-deriving it from
 * `VITE_API_URL`, so the two can never disagree.
 */
export const apiBaseUrl = String(api.defaults.baseURL ?? '');

/**
 * Fetching a tenant document's bytes, authenticated.
 *
 * `GET /api/tenants/:id/documents/:docId/download` is session-guarded like any
 * other route. The Documents tab reached it with `window.open()` and
 * `<a download>` — bare browser navigations that carry no `Authorization`
 * header, leaving auth to fall through to the `hms_session` cookie, which is
 * written once at login and never refreshed (Supabase refreshes into
 * localStorage). Going through the API client instead means the request
 * carries the same live token as every other call, and stops depending on a
 * cookie's staleness or on cross-site cookie policy.
 *
 * `<a download>` was independently broken: browsers ignore the `download`
 * attribute for cross-origin URLs and navigate instead.
 */
export const documentFileService = {
  /**
   * The document as a Blob. `url` is the absolute `download_url` the backend
   * puts on each document row — axios ignores `baseURL` for absolute URLs, and
   * the request interceptor still attaches the bearer token.
   */
  fetchBlob: async (url: string): Promise<Blob> => {
    const response = await api.get(url, { responseType: 'blob' });
    return response.data as Blob;
  },
};
