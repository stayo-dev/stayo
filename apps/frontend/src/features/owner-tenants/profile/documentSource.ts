/**
 * Whether a document URL may be fetched with the viewer's session.
 *
 * Two kinds of URL reach the preview sheet:
 *
 *  - Tenant KYC documents — `…/api/tenants/:id/documents/:docId/download`, our
 *    own auth-guarded proxy, which needs the bearer token.
 *  - Vault documents — `identity_documents.file_url`, a raw ImageKit URL on a
 *    third-party host.
 *
 * `lib/api-client`'s request interceptor attaches
 * `Authorization: Bearer <supabase access token>` to every request that isn't
 * one of a short list of public auth paths. It does not look at the host. So
 * fetching an ImageKit URL through that client would hand a live session token
 * to ImageKit. This module decides which mode a URL gets, so that call isn't
 * left to whoever next passes a URL to the preview.
 */

export type DocumentSourceMode = 'authenticated' | 'direct';

export interface DocumentSource {
  mode: DocumentSourceMode;
  url: string;
}

/** Only these are safe to put in an `<img src>` / `<object data>`. */
const RENDERABLE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * `apiBaseUrl` is `lib/api-client`'s normalized base — either an absolute
 * origin+path (`https://api.example.com/api`) or a same-origin path (`/api`).
 */
export function resolveDocumentSource(
  url: string | null | undefined,
  apiBaseUrl: string,
): DocumentSource | null {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return null;

  const relative = raw.startsWith('/');

  if (!relative) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    // Anything that is not plain http(s) — `javascript:`, `data:` — is not
    // something to render because a server said so.
    if (!RENDERABLE_PROTOCOLS.has(parsed.protocol)) return null;
  }

  return { mode: isOurApi(raw, apiBaseUrl, relative) ? 'authenticated' : 'direct', url: raw };
}

function isOurApi(url: string, apiBaseUrl: string, relative: boolean): boolean {
  const base = apiBaseUrl.trim().replace(/\/+$/, '');
  if (!base) return false;

  if (base.startsWith('/')) {
    // Same-origin API. A relative document URL is ours only if it sits under
    // the API path; an absolute one never is.
    return relative && isUnderPath(url, base);
  }

  // Absolute API base. A relative URL resolves against the app's origin, not
  // the API host, so it is not ours.
  if (relative) return false;

  let target: URL;
  let apiUrl: URL;
  try {
    target = new URL(url);
    apiUrl = new URL(base);
  } catch {
    return false;
  }

  // Compared as whole origins, so `api.stayo.test.evil.com` cannot match
  // `api.stayo.test` the way a `startsWith` on the string would.
  if (target.origin !== apiUrl.origin) return false;
  return isUnderPath(target.pathname, apiUrl.pathname.replace(/\/+$/, ''));
}

/** True when `path` is `prefix` itself or a segment beneath it — never a sibling sharing a prefix. */
function isUnderPath(path: string, prefix: string): boolean {
  if (!prefix || prefix === '/') return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Whether to render a document as a PDF rather than an image.
 *
 * A direct (vault) URL is handed straight to the element with no response to
 * read a `content-type` from, so the filename is the only signal. Guessing
 * wrong is visible either way — a PDF in an `<img>` is a broken thumbnail, an
 * image in an `<object>` is a blank pane — so when nothing indicates a PDF this
 * assumes an image, which is what almost every ID document is.
 */
export function looksLikePdf(url: string, contentType: string | null): boolean {
  if (contentType) return contentType.toLowerCase().includes('pdf');

  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.toLowerCase().endsWith('.pdf');
}
