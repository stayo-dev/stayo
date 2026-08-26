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

  it('carries the url through unchanged', () => {
    const url = `${API}/tenants/t1/documents/d1/download`;
    expect(resolveDocumentSource(url, API)?.url).toBe(url);
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
