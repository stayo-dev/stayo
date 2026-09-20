import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  NOINDEX_FOLLOW_PREFIXES,
  PRIVATE_PATH_PREFIXES,
} from "@/src/services/seo/seo-links";

/**
 * Crawl directives are declared in two places that must agree:
 *
 *   - `PRIVATE_PATH_PREFIXES` in `seo-links.ts`, which generates `robots.txt`
 *   - the `X-Robots-Tag` headers in `apps/frontend/vercel.json`
 *
 * They were written by hand once and drifted, and the result was live in
 * production: `https://yourstayo.com/owner/dashboard` was served
 * `X-Robots-Tag: index, follow` — every owner, admin and tenant URL marked
 * indexable by a blanket rule nobody remembered adding.
 *
 * This reads both as text. No client, no database. ADR-224.
 */

const VERCEL_JSON = path.resolve(__dirname, "../../frontend/vercel.json");

function loadConfig() {
  return JSON.parse(fs.readFileSync(VERCEL_JSON, "utf8"));
}

function robotsValueFor(config: any, source: string): string | null {
  for (const block of config.headers ?? []) {
    if (block.source !== source) continue;
    for (const header of block.headers ?? []) {
      if (String(header.key).toLowerCase() === "x-robots-tag") return String(header.value);
    }
  }
  return null;
}

describe("the blanket rule is gone", () => {
  it("serves no site-wide X-Robots-Tag at all", () => {
    // `index, follow` is the crawler default — a blanket rule buys nothing and
    // is what marked the whole app indexable.
    expect(robotsValueFor(loadConfig(), "/(.*)")).toBeNull();
  });

  it("keeps the rest of the security header block untouched", () => {
    const config = loadConfig();
    const blanket = (config.headers ?? []).find((block: any) => block.source === "/(.*)");
    const keys = (blanket?.headers ?? []).map((header: any) => header.key);

    expect(keys).toContain("Content-Security-Policy");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("Referrer-Policy");
  });
});

describe("every private path is noindex", () => {
  const config = loadConfig();

  it.each(PRIVATE_PATH_PREFIXES.map((prefix) => [prefix]))(
    "%s is noindex, nofollow — as an exact path and as a subtree",
    (prefix) => {
      // Both matchers are needed: in Vercel, `/login` and `/login/:path*` are
      // different rules, and covering only one leaves the other on the default.
      expect(robotsValueFor(config, prefix)).toBe("noindex, nofollow");
      expect(robotsValueFor(config, `${prefix}/:path*`)).toBe("noindex, nofollow");
    },
  );

  it("covers the owner dashboard that was live-indexable", () => {
    expect(robotsValueFor(config, "/owner/:path*")).toBe("noindex, nofollow");
  });
});

describe("the SPA's public surfaces are noindex but followable", () => {
  const config = loadConfig();

  it.each(NOINDEX_FOLLOW_PREFIXES.map((prefix) => [prefix]))(
    "%s keeps follow so its links reach the canonical pages",
    (prefix) => {
      const value = robotsValueFor(config, `${prefix}/:path*`);
      expect(value).toBe("noindex, follow");
    },
  );

  it("never marks them nofollow — that would strand the link equity", () => {
    for (const prefix of NOINDEX_FOLLOW_PREFIXES) {
      expect(robotsValueFor(config, `${prefix}/:path*`)).not.toContain("nofollow");
    }
  });
});

describe("the indexable tree is actually routed", () => {
  const config = loadConfig();
  const rewrites: { source: string; destination: string }[] = config.rewrites ?? [];
  const sources = rewrites.map((rewrite) => rewrite.source);

  it.each([
    ["/hostels"],
    ["/hostels/:slug"],
    ["/sitemap.xml"],
    ["/sitemaps/:shard"],
    ["/robots.txt"],
  ])("%s is rewritten to the backend", (source) => {
    const rewrite = rewrites.find((entry) => entry.source === source);
    expect(rewrite, `missing rewrite for ${source}`).toBeTruthy();
    expect(rewrite!.destination).toContain("api.yourstayo.com");
  });

  it("rewrites Next's own assets, or the pages arrive unstyled", () => {
    // CSP `script-src 'self'` rules out loading these from the API host
    // directly, so this rewrite is required rather than an optimisation.
    const rewrite = rewrites.find((entry) => entry.source === "/_next/:path*");
    expect(rewrite).toBeTruthy();
  });

  it("keeps the SPA catch-all last — Vercel matches rewrites in array order", () => {
    const last = rewrites[rewrites.length - 1];
    expect(last.destination).toContain("index.html");

    for (const source of ["/hostels/:slug", "/sitemap.xml", "/_next/:path*"]) {
      expect(sources.indexOf(source)).toBeLessThan(rewrites.length - 1);
    }
  });

  it("redirects a trailing slash so one hostel is not two URLs", () => {
    const redirect = (config.redirects ?? []).find(
      (entry: any) => entry.source === "/hostels/:slug/",
    );
    expect(redirect).toBeTruthy();
    expect(redirect.permanent).toBe(true);
  });
});

describe("the static files that would shadow the dynamic routes are gone", () => {
  // On Vercel the filesystem is checked BEFORE rewrites, so either of these
  // existing silently defeats the generated versions — the live sitemap was a
  // hand-written 9-URL file with no hostels in it for exactly this reason.
  it.each([
    ["../../frontend/public/sitemap.xml"],
    ["../../frontend/public/robots.txt"],
    ["../public/sitemap.xml"],
  ])("%s does not exist", (relative) => {
    expect(fs.existsSync(path.resolve(__dirname, relative))).toBe(false);
  });
});
