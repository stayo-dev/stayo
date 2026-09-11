import { describe, expect, it } from 'vitest';
import { looksLikePdf, resolveDocumentSource } from './documentSource';

/**
 * Whether a document URL may be fetched with the viewer's session.
 *
 * Two kinds of document URL reach the preview, and they must be handled
 * differently:
 *
 *  - Tenant KYC documents arrive as `…/api/tenants/:id/documents/:docId/download`
 *    — our own auth-guarded proxy, which needs the bearer token.
 *  - Vault documents (`identity_documents.file_url`) arrive as a raw ImageKit
 *    URL on a third-party host.
 *
 * `lib/api-client`'s request interceptor attaches
 * `Authorization: Bearer <supabase access token>` to **every** request that
 * isn't one of a short list of public auth paths — it does not check the host.
 * So fetching an ImageKit URL through it would hand the user's live session
 * token to ImageKit. This decides that, rather than leaving it to whoever
 * next passes a URL to the preview sheet.
 */

const API = 'https://api.stayo.test/api';

describe('resolveDocumentSource', () => {
  it('authenticates a URL on our own API', () => {
    const source = resolveDocumentSource(`${API}/tenants/t1/documents/d1/download`, API);
    expect(source?.mode).toBe('authenticated');
  });

  it('authenticates a same-origin relative path', () => {
    const source = resolveDocumentSource('/api/tenants/t1/documents/d1/download', '/api');
    expect(source?.mode).toBe('authenticated');
  });

  it('never authenticates a third-party host', () => {
    // The whole point: an ImageKit URL must not carry the session token.
    const source = resolveDocumentSource('https://ik.imagekit.io/stayo/doc.jpg', API);
    expect(source?.mode).toBe('direct');
  });

  it('does not authenticate a look-alike host', () => {
    // "api.stayo.test.evil.com" must not match "api.stayo.test".
    const source = resolveDocumentSource('https://api.stayo.test.evil.com/api/x', API);
    expect(source?.mode).toBe('direct');
  });

  it('does not authenticate a different path on the same host', () => {
    // Only the API prefix is ours; a bare file served from the same domain
    // is not a route that needs, or should receive, the token.
    const source = resolveDocumentSource('https://api.stayo.test/uploads/doc.jpg', API);
    expect(source?.mode).toBe('direct');
  });

  it('treats a relative path as direct when the API base is absolute', () => {
    // A relative URL resolves against the app's origin, not the API host, so
    // it is not our API and gets no token.
    const source = resolveDocumentSource('/uploads/doc.jpg', API);
    expect(source?.mode).toBe('direct');
  });

  it('returns null for nothing to show', () => {
    expect(resolveDocumentSource('', API)).toBeNull();
    expect(resolveDocumentSource(null, API)).toBeNull();
    expect(resolveDocumentSource(undefined, API)).toBeNull();
  });

  it('refuses a non-http scheme rather than rendering it', () => {
    // `javascript:` and `data:` in an <img src>/<object data> are not things
    // to hand a viewer because a server said so.
    expect(resolveDocumentSource('javascript:alert(1)', API)).toBeNull();
    expect(resolveDocumentSource('data:text/html,<script>', API)).toBeNull();
  });

  it('hands the API client a path relative to its base, so it is never joined twice', () => {
    // The client prefixes its own base. Passing it "/api/tenants/…" under a
    // "/api" base requested "/api/api/tenants/…".
    expect(resolveDocumentSource(`${API}/tenants/t1/documents/d1/download`, API)?.url).toBe('/tenants/t1/documents/d1/download');
    expect(resolveDocumentSource('/api/tenants/t1/documents/d1/download', '/api')?.url).toBe('/tenants/t1/documents/d1/download');
  });

  it('keeps a query string on the request path', () => {
    expect(resolveDocumentSource(`${API}/tenants/t1/documents/d1/download?v=2`, API)?.url).toBe('/tenants/t1/documents/d1/download?v=2');
  });
});

describe('resolveDocumentSource — production: a same-origin "/api" base', () => {
  /*
   * Production is built with VITE_API_URL="/api" (proxied to the backend),
   * while the backend writes download links as absolute URLs on its own public
   * host. The old rule — "under a same-origin base an absolute URL is never
   * ours" — sent every tenant document to an <img src> with no session, and
   * the API answered 401. Seen on /owner/tenants/verifications, 2026-09-11.
   */
  const BASE = '/api';

  it('authenticates our backend’s absolute download link, and fetches it through our own base', () => {
    const source = resolveDocumentSource('https://api.yourstayo.com/api/tenants/t1/documents/d1/download', BASE);
    expect(source).toEqual({ mode: 'authenticated', url: '/tenants/t1/documents/d1/download' });
  });

  it('still never authenticates a third-party file', () => {
    expect(resolveDocumentSource('https://ik.imagekit.io/stayo/doc.jpg', BASE)?.mode).toBe('direct');
  });

  it('is safe even for a hostile host with an /api path — the request goes to our base, not to it', () => {
    // The session is attached to a request against OUR origin; the named host
    // receives nothing. The url returned has no host at all.
    const source = resolveDocumentSource('https://evil.example/api/tenants/t1/documents/d1/download', BASE);
    expect(source?.url.startsWith('/')).toBe(true);
    expect(source?.url).not.toContain('evil.example');
  });

  it('does not authenticate a sibling path that merely starts with "/api"', () => {
    expect(resolveDocumentSource('https://api.yourstayo.com/apiary/x.jpg', BASE)?.mode).toBe('direct');
  });
});

describe('looksLikePdf', () => {
  it('trusts an explicit content type', () => {
    expect(looksLikePdf('https://x/y', 'application/pdf')).toBe(true);
    expect(looksLikePdf('https://x/y.pdf', 'image/jpeg')).toBe(false);
  });

  it('falls back to the extension when there is no content type', () => {
    // A direct vault URL arrives with no response to read a type from — the
    // filename is all there is, and guessing wrong renders a PDF as a broken
    // <img>.
    expect(looksLikePdf('https://ik.imagekit.io/s/agreement.pdf', null)).toBe(true);
    expect(looksLikePdf('https://ik.imagekit.io/s/aadhaar.jpg', null)).toBe(false);
  });

  it('ignores a query string when reading the extension', () => {
    expect(looksLikePdf('https://ik.imagekit.io/s/doc.pdf?tr=w-800', null)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(looksLikePdf('https://ik.imagekit.io/s/DOC.PDF', null)).toBe(true);
  });

  it('assumes an image when it cannot tell', () => {
    // Images are the overwhelming majority of ID documents, and a wrong <img>
    // shows a broken thumbnail while a wrong <object> shows a blank pane.
    expect(looksLikePdf('https://ik.imagekit.io/s/file', null)).toBe(false);
  });
});
