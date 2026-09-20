import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Freshness coverage.
 *
 * The architectural invariant check catches a FORBIDDEN call — `revalidateTag`
 * reached for directly. It cannot catch a MISSING one, and a missing one is
 * the failure that actually happens: an owner changes a photo, the write
 * succeeds, nothing errors, and the public page keeps showing the old one
 * until the ISR ceiling expires an hour later. There is no signal anywhere.
 *
 * This reads the write paths as text and asserts each one still calls the
 * helper. Text-reading rather than execution because these paths need a
 * database and there is none. Precedent: `tests/whatsapp-prisma-accessors.test.ts`,
 * `tests/hostel-identity-field-round-trip.test.ts`. ADR-226.
 */

const BACKEND = path.resolve(__dirname, "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(BACKEND, relative), "utf8");
}

/** Every path that changes what a public hostel page says or whether it exists. */
const WRITE_PATHS: { file: string; why: string; visibilityChanged: boolean }[] = [
  {
    file: "src/services/marketing/marketing-review-service.ts",
    why: "approving a revision IS publishing the page's content",
    visibilityChanged: false,
  },
  {
    file: "app/api/platform-admin/hostels/[id]/approve-listing/route.ts",
    why: "LIVE + VERIFIED is what makes the page exist at all",
    visibilityChanged: true,
  },
  {
    file: "app/api/platform-admin/hostels/[id]/suspend-listing/route.ts",
    why: "the hostel leaves Discovery, so its page must stop resolving",
    visibilityChanged: true,
  },
  {
    file: "app/api/platform-admin/hostels/[id]/reject-listing/route.ts",
    why: "losing VERIFIED drops the hostel out of DISCOVERABLE",
    visibilityChanged: true,
  },
];

describe("every write path that changes a public page busts its cache", () => {
  it.each(WRITE_PATHS.map((entry) => [entry.file, entry.why] as const))(
    "%s — %s",
    (file) => {
      const source = read(file);
      expect(source).toContain("invalidatePublicListing");
      expect(source).toContain("@/lib/cache/public-listing-cache");
    },
  );

  it.each(WRITE_PATHS.filter((entry) => entry.visibilityChanged).map((entry) => [entry.file] as const))(
    "%s changes WHICH pages exist, so it must bust the sitemap",
    (file) => {
      expect(read(file)).toContain("visibilityChanged: true");
    },
  );

  it("does not bust the sitemap on an ordinary content approval", () => {
    // Otherwise every photo upload invalidates every sitemap shard.
    const source = read("src/services/marketing/marketing-review-service.ts");
    expect(source).not.toContain("visibilityChanged: true");
  });

  it("passes the slug, since the cache is keyed by it and not by id", () => {
    for (const { file } of WRITE_PATHS) {
      expect(read(file)).toMatch(/slug:\s*\w+(\.\w+)*,/);
    }
  });
});

describe("the helper busts both caches, not just Next's", () => {
  const source = read("lib/cache/public-listing-cache.ts");

  it("invalidates the Redis read the page renders through", () => {
    // Busting only the ISR tag re-renders from a cache up to 180s stale, and
    // the page looks unchanged for no visible reason.
    expect(source).toContain("publicHostelTag");
  });

  it("invalidates the Next ISR tag", () => {
    expect(source).toContain("revalidateTag");
  });

  it("only touches the sitemap when visibility changed", () => {
    expect(source).toMatch(/if \(input\.visibilityChanged\) revalidateTag\(seoTags\.sitemap\(\)\)/);
  });

  it("never throws — a cache miss must not roll back the write that caused it", () => {
    expect(source).toContain("catch");
    expect(source).toContain("Promise.allSettled");
  });
});

describe("the ISR ceiling is the backstop for a missed call", () => {
  it("caps how stale a hostel page can get at one hour", () => {
    const page = read("app/(seo)/hostels/[slug]/page.tsx");
    expect(page).toMatch(/export const revalidate = 3600/);
  });

  it("re-renders a hostel listed after the last build instead of 404ing it", () => {
    const page = read("app/(seo)/hostels/[slug]/page.tsx");
    expect(page).toMatch(/export const dynamicParams = true/);
  });
});
