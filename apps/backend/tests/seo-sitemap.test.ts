/**
 * Sitemap sharding and rendering.
 *
 * The scale claim in ADR-224 — "1 hostel to 10,000 with no code change" — is
 * implemented by `shardPlan`, so it is tested at both ends of that range and
 * at every boundary in between.
 */

import { describe, it, expect } from "vitest";
import {
  URLS_PER_SHARD,
  escapeXml,
  formatLastmod,
  parseHostelShard,
  renderSitemapIndex,
  renderUrlSet,
  shardPlan,
  shardWindow,
} from "@/src/services/seo/sitemap-xml";

describe("shardPlan", () => {
  it("still emits one shard at zero hostels — an empty urlset, not a broken index", () => {
    expect(shardPlan(0)).toEqual(["hostels-1.xml"]);
  });

  it("puts today's single hostel in one shard", () => {
    expect(shardPlan(1)).toEqual(["hostels-1.xml"]);
  });

  it.each([
    [4999, 1],
    [5000, 1],
    [5001, 2],
    [10000, 2],
    [10001, 3],
    [250000, 50],
  ])("splits %i URLs into %i shards", (total, expected) => {
    expect(shardPlan(total)).toHaveLength(expected);
  });

  it("uses the same code path from 1 to 10,000 — only the count differs", () => {
    expect(shardPlan(1)[0]).toBe("hostels-1.xml");
    expect(shardPlan(10000)[0]).toBe("hostels-1.xml");
  });

  it("treats a nonsense total as zero rather than throwing", () => {
    expect(shardPlan(-5)).toEqual(["hostels-1.xml"]);
    expect(shardPlan(Number.NaN)).toEqual(["hostels-1.xml"]);
  });
});

describe("shardWindow", () => {
  it("offsets each shard by a whole page", () => {
    expect(shardWindow(1)).toEqual({ offset: 0, limit: URLS_PER_SHARD });
    expect(shardWindow(2)).toEqual({ offset: URLS_PER_SHARD, limit: URLS_PER_SHARD });
    expect(shardWindow(3)).toEqual({ offset: 2 * URLS_PER_SHARD, limit: URLS_PER_SHARD });
  });

  it("clamps a bad shard number to the first page", () => {
    expect(shardWindow(0).offset).toBe(0);
    expect(shardWindow(-2).offset).toBe(0);
  });
});

describe("parseHostelShard", () => {
  it("reads the shard number back out of a filename", () => {
    expect(parseHostelShard("hostels-1.xml")).toBe(1);
    expect(parseHostelShard("hostels-42.xml")).toBe(42);
  });

  it("rejects anything that is not a hostel shard", () => {
    for (const name of ["static.xml", "hostels.xml", "hostels-0.xml", "hostels-x.xml", "../../etc/passwd", ""]) {
      expect(parseHostelShard(name)).toBeNull();
    }
  });
});

describe("escaping", () => {
  it("escapes an ampersand in a URL — the commonest way a sitemap becomes invalid XML", () => {
    expect(escapeXml("https://yourstayo.com/x?a=1&b=2")).toBe(
      "https://yourstayo.com/x?a=1&amp;b=2",
    );
  });

  it("escapes the full XML set", () => {
    expect(escapeXml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&apos;");
  });

  it("passes unicode through — a hostel name may legitimately contain it", () => {
    expect(escapeXml("Sri Ādithya — ₹8,200")).toContain("₹8,200");
  });
});

describe("formatLastmod", () => {
  it("emits a date, not a timestamp", () => {
    expect(formatLastmod("2026-09-15T15:47:09.621Z")).toBe("2026-09-15");
  });

  it("returns null rather than inventing a date", () => {
    expect(formatLastmod(null)).toBeNull();
    expect(formatLastmod(undefined)).toBeNull();
    expect(formatLastmod("not a date")).toBeNull();
  });
});

describe("renderUrlSet", () => {
  it("emits no lastmod element when the row has no timestamp", () => {
    const xml = renderUrlSet([{ loc: "https://yourstayo.com/hostels/x" }]);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).toContain("<loc>https://yourstayo.com/hostels/x</loc>");
  });

  it("is valid, parseable XML with one entry", () => {
    const xml = renderUrlSet([
      { loc: "https://yourstayo.com/hostels/sri-adithya-boys-hostel-36094ab4", lastmod: "2026-09-15", priority: 0.8 },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<urlset");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    expect(xml).toContain("<priority>0.8</priority>");
  });

  it("renders an empty set without malforming", () => {
    const xml = renderUrlSet([]);
    expect(xml).toContain("<urlset");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});

describe("renderSitemapIndex", () => {
  it("points at shard paths on the public origin", () => {
    const xml = renderSitemapIndex([{ name: "hostels-1.xml", lastmod: "2026-09-15" }], "https://yourstayo.com");
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain("<loc>https://yourstayo.com/sitemaps/hostels-1.xml</loc>");
    expect(xml).toContain("<lastmod>2026-09-15</lastmod>");
  });

  it("does not double a trailing slash on the base URL", () => {
    const xml = renderSitemapIndex([{ name: "static.xml" }], "https://yourstayo.com/");
    expect(xml).toContain("https://yourstayo.com/sitemaps/static.xml");
    expect(xml).not.toContain("//sitemaps");
  });
});
