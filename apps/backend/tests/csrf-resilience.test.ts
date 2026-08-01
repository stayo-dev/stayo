import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  csrfCookieValues,
  getCsrfCookieOptions,
  isValidCsrfPair,
  matchesAnyCsrfCookie,
} from "../lib/security/csrf";

/**
 * CSRF resilience — "Security check failed" when an owner sent an invitation.
 *
 * The double-submit mechanism itself was verified correct against production
 * (no pair → 403, matching pair → 200). The failures come from the token being
 * a moving target and from the cookie being unreadable or duplicated:
 *
 *  1. `GET /api/auth/me` minted a brand-new token on every call, and
 *     `AuthContext` calls it on every Supabase auth-state change — so any
 *     unsafe request in flight could carry a token that had just been
 *     replaced.
 *  2. A browser can hold more than one `hms_csrf` cookie (a host-only one plus
 *     a `Domain=.yourstayo.com` one left over from an earlier deploy config).
 *     Both are sent; the server read exactly one and compared against a header
 *     built from the other.
 *  3. `secure: true` is derived from NODE_ENV, so a production build served
 *     over plain http (localhost) sets a Secure cookie the browser silently
 *     discards — leaving a header with no cookie, forever.
 */

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV };
});

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

describe("isValidCsrfPair", () => {
  it("accepts a matching pair", () => {
    expect(isValidCsrfPair(TOKEN_A, TOKEN_A)).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(isValidCsrfPair(TOKEN_A, TOKEN_B)).toBe(false);
  });

  it("rejects a missing side", () => {
    expect(isValidCsrfPair(undefined, TOKEN_A)).toBe(false);
    expect(isValidCsrfPair(TOKEN_A, undefined)).toBe(false);
  });

  it("rejects a token too short to be one of ours", () => {
    expect(isValidCsrfPair("short", "short")).toBe(false);
  });
});

describe("csrfCookieValues — a browser may send more than one hms_csrf", () => {
  it("reads a single cookie", () => {
    expect(csrfCookieValues(`hms_csrf=${TOKEN_A}`)).toEqual([TOKEN_A]);
  });

  it("reads every hms_csrf value when the browser sends duplicates", () => {
    const header = `hms_session=xyz; hms_csrf=${TOKEN_A}; other=1; hms_csrf=${TOKEN_B}`;

    expect(csrfCookieValues(header)).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("is not confused by a cookie whose name merely ends with the same text", () => {
    expect(csrfCookieValues(`not_hms_csrf=${TOKEN_B}; hms_csrf=${TOKEN_A}`)).toEqual([TOKEN_A]);
  });

  it("tolerates a missing or empty header", () => {
    expect(csrfCookieValues(undefined)).toEqual([]);
    expect(csrfCookieValues("")).toEqual([]);
  });
});

describe("matchesAnyCsrfCookie", () => {
  // The duplicate-cookie case: the header legitimately matches one of the
  // cookies the browser sent, just not whichever one was read first.
  it("accepts a header matching the second of two cookies", () => {
    const header = `hms_csrf=${TOKEN_A}; hms_csrf=${TOKEN_B}`;

    expect(matchesAnyCsrfCookie(header, TOKEN_B)).toBe(true);
  });

  it("accepts a header matching the first", () => {
    expect(matchesAnyCsrfCookie(`hms_csrf=${TOKEN_A}; hms_csrf=${TOKEN_B}`, TOKEN_A)).toBe(true);
  });

  it("still rejects a header matching neither", () => {
    expect(matchesAnyCsrfCookie(`hms_csrf=${TOKEN_A}; hms_csrf=${TOKEN_B}`, "c".repeat(64))).toBe(false);
  });

  it("rejects when no cookie was sent at all", () => {
    expect(matchesAnyCsrfCookie("", TOKEN_A)).toBe(false);
    expect(matchesAnyCsrfCookie(undefined, TOKEN_A)).toBe(false);
  });

  it("rejects a missing header even when cookies exist", () => {
    expect(matchesAnyCsrfCookie(`hms_csrf=${TOKEN_A}`, undefined)).toBe(false);
  });
});

describe("getCsrfCookieOptions — Secure must follow the actual protocol", () => {
  // A Secure cookie sent over http is silently discarded by the browser, which
  // leaves the client with a header and no cookie and fails every unsafe
  // request with no way to recover.
  it("does not mark the cookie Secure for an insecure origin", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getCsrfCookieOptions(60, { isSecureRequest: false }).secure).toBe(false);
  });

  it("marks it Secure for an https origin", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getCsrfCookieOptions(60, { isSecureRequest: true }).secure).toBe(true);
  });

  it("defaults to the NODE_ENV behaviour when the protocol is unknown", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getCsrfCookieOptions(60).secure).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    expect(getCsrfCookieOptions(60).secure).toBe(false);
  });

  it("keeps the cookie readable by script — the client must echo it back", () => {
    expect(getCsrfCookieOptions(60).httpOnly).toBe(false);
  });
});
