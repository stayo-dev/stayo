/**
 * Sitemap rendering and sharding.
 *
 * PURE MODULE — no I/O. The database reads live in `seo-service.ts`.
 *
 * ## Why a sitemap index from day one, with one hostel in it
 *
 * The protocol caps a single sitemap at 50,000 URLs / 50 MB, so a flat file
 * has to become an index eventually. Doing that later is a migration with a
 * live domain and an established Search Console property attached; doing it
 * now costs one extra HTTP route. The shard count comes from a `COUNT(*)`, so
 * the same code emits one shard today and two at 10,000 hostels — that is the
 * whole "scales without changing the architecture" requirement, and this is
 * where it is actually implemented.
 *
 * ## Why shards are ordered by creation, not by name or by update
 *
 * A shard is cached and re-fetched on its own schedule. If shards were ordered
 * by anything mutable, adding one hostel would reshuffle which hostel sits in
 * which shard and invalidate every shard at once — an N-file rewrite on every
 * onboarding. Ordered by `created_at ASC, id ASC`, a new hostel only ever
 * appends to the last shard, so exactly one file changes.
 *
 * See ADR-224.
 */

/** 5,000 per shard: an order of magnitude under the cap, small enough to fetch fast. */
export const URLS_PER_SHARD = 5000;

export interface SitemapEntry {
  /** Absolute URL. */
  loc: string;
  /** Real row timestamp. Omitted rather than faked — never `new Date()`. */
  lastmod?: Date | string | null;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  /** 0.0–1.0. Relative within this site only; Google largely ignores it. */
  priority?: number;
}

export interface ShardRef {
  /** Filename, e.g. `hostels-1.xml`. */
  name: string;
  lastmod?: Date | string | null;
}

export function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** W3C datetime. Invalid or missing input yields no `<lastmod>` at all. */
export function formatLastmod(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * How many shards a given URL count needs, and what they are called.
 *
 * Always at least one shard, even at zero URLs: an index pointing at an empty
 * urlset is a valid, honest "nothing here yet", whereas an index pointing at
 * nothing is a broken file.
 */
export function shardPlan(total: number, perShard: number = URLS_PER_SHARD): string[] {
  const safeTotal = Math.max(0, Math.floor(total || 0));
  const count = Math.max(1, Math.ceil(safeTotal / perShard));
  return Array.from({ length: count }, (_, index) => `hostels-${index + 1}.xml`);
}

/** Zero-based offset/limit for shard `n` (1-based), for the SQL query. */
export function shardWindow(
  shardNumber: number,
  perShard: number = URLS_PER_SHARD,
): { offset: number; limit: number } {
  const n = Math.max(1, Math.floor(shardNumber || 1));
  return { offset: (n - 1) * perShard, limit: perShard };
}

/** `hostels-3.xml` → 3. Null for anything that is not a hostel shard name. */
export function parseHostelShard(name: string): number | null {
  const match = /^hostels-(\d+)\.xml$/.exec(String(name ?? ""));
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function renderUrlSet(entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const lines = [`    <loc>${escapeXml(entry.loc)}</loc>`];

      const lastmod = formatLastmod(entry.lastmod);
      if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
      if (entry.changefreq) lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority != null) {
        lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      }

      return `  <url>\n${lines.join("\n")}\n  </url>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .concat("\n");
}

export function renderSitemapIndex(shards: ShardRef[], baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");

  const entries = shards
    .map((shard) => {
      const lines = [`    <loc>${escapeXml(`${base}/sitemaps/${shard.name}`)}</loc>`];
      const lastmod = formatLastmod(shard.lastmod);
      if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
      return `  <sitemap>\n${lines.join("\n")}\n  </sitemap>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</sitemapindex>",
  ].join("\n").concat("\n");
}
