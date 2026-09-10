/**
 * POST /webhooks/clerk — endpoint invariants (ADR-176).
 *
 * Architectural invariant tests in the style of tests/auth-hardening-security.ts:
 * they read source as text to prove dangerous shapes do not exist, regardless of
 * runtime conditions. They exist because this endpoint's safety rests on facts
 * that live in *other* files — the middleware matcher, the frontend rewrite list
 * — and nothing else would notice if one of them moved.
 *
 * PURE — filesystem reads only, no database.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(backend, "../..");

const read = (p: string) => fs.readFileSync(path.join(backend, p), "utf8");

const ROUTE = "app/webhooks/clerk/route.ts";

/**
 * Every `data: { … }` literal in a source file — the object Prisma actually
 * writes — with braces balanced so nested objects are included.
 */
function dataLiterals(source: string): string[] {
  const blocks: string[] = [];
  const re = /\bdata:\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(source))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(start, i + 1));
  }
  return blocks;
}


describe("route placement", () => {
  it("serves exactly /webhooks/clerk", () => {
    expect(fs.existsSync(path.join(backend, ROUTE))).toBe(true);
  });

  it("sits outside the middleware matcher, so no session is ever demanded of Clerk", () => {
    // The route is public by construction rather than by allow-list. If the
    // matcher ever widens past /api, this endpoint starts 401-ing every genuine
    // delivery and Clerk's retries all fail — so pin the matcher here.
    const middleware = read("middleware.ts");
    const matcher = middleware.match(/matcher:\s*"([^"]+)"/);

    expect(matcher?.[1]).toBe("/api/:path*");
    expect(matcher?.[1].startsWith("/api")).toBe(true);
  });

  it("is reachable only on the api. subdomain, which is what Clerk must be pointed at", () => {
    // yourstayo.com rewrites /api/:path* to this backend and nothing else, so
    // https://yourstayo.com/webhooks/clerk would 404 against the SPA.
    const vercel = JSON.parse(fs.readFileSync(path.join(repo, "apps/frontend/vercel.json"), "utf8"));
    const sources: string[] = (vercel.rewrites ?? []).map((r: { source: string }) => r.source);

    expect(sources.some((s) => s.startsWith("/webhooks"))).toBe(false);
    expect(read(ROUTE)).toContain("https://api.yourstayo.com/webhooks/clerk");
  });

  it("runs on the Node.js runtime — signature verification needs node crypto", () => {
    expect(read(ROUTE)).toMatch(/export const runtime = "nodejs"/);
  });
});

describe("signature verification is unconditional", () => {
  it("verifies before interpreting the event", () => {
    const source = read(ROUTE);
    const verifyAt = source.indexOf("verifyClerkWebhook");
    const syncAt = source.indexOf("syncClerkUser(event)");

    expect(verifyAt).toBeGreaterThan(-1);
    expect(syncAt).toBeGreaterThan(verifyAt);
  });

  it("verifies the raw body, never a re-serialised one", () => {
    // JSON.parse → JSON.stringify does not round-trip byte-for-byte, and any
    // drift invalidates the HMAC.
    const source = read(ROUTE);
    expect(source).toContain("await req.text()");
    expect(source).not.toContain("await req.json()");
  });

  it("has no bypass flag — no env var can switch verification off", () => {
    const source = read(ROUTE);
    expect(source).not.toMatch(/SKIP_.*VERIF|DISABLE_.*VERIF|NODE_ENV\s*[!=]==?\s*['"]production/);
  });
});

describe("status codes are a retry protocol", () => {
  const source = read(ROUTE);

  it("returns 200 on successful processing", () => {
    expect(source).toMatch(/received:\s*true[\s\S]{0,60}status:\s*200/);
  });

  it("returns 401 on a bad signature, so Svix never retries a rejected caller", () => {
    expect(source).toMatch(/Invalid signature[\s\S]{0,40}status:\s*401/);
  });

  it("returns 500 on our own failure, so the delivery is retried", () => {
    // Answering 200 here would silently drop the user record.
    expect(source).toMatch(/Processing failed[\s\S]{0,40}status:\s*500/);
  });

  it("treats a missing signing secret as our fault (500), not a bad caller (401)", () => {
    expect(source).toMatch(/missing_secret[\s\S]*?status:\s*500/);
  });
});

describe("the webhook cannot escalate or destroy", () => {
  const service = read("src/services/auth/clerk-user-sync-service.ts");

  it("never deletes a user row", () => {
    expect(service).not.toMatch(/prisma\.users\.delete|deleteMany/);
  });

  it("never writes a role from a Clerk payload", () => {
    // Roles are ours. Clerk holds identity; authority is decided in our database.
    //
    // Checked against the *write payloads* rather than the whole file: the
    // service legitimately mentions `role` when it reads one back (a `select`,
    // and building the /me snapshot). An earlier version of this test matched
    // /role:\s/ anywhere and started failing the moment the handshake read a
    // role it never wrote — a false positive that would have been tempting to
    // silence rather than sharpen.
    for (const block of dataLiterals(service)) {
      expect(block).not.toMatch(/\brole\b/);
    }
  });

  it("has write payloads to check, so the assertion above is not vacuous", () => {
    expect(dataLiterals(service).length).toBeGreaterThanOrEqual(3);
  });

  it("never writes to profiles — the webhook reads them to link, nothing more", () => {
    expect(service).not.toMatch(/prisma\.profile\.(create|update|upsert|delete)/);
  });

  it("does not log the payload, which carries email and name", () => {
    const route = read(ROUTE);
    expect(route).not.toMatch(/logger\.\w+\([^)]*\brawBody\b/);
    expect(route).not.toMatch(/payload:\s*event/);
  });
});
