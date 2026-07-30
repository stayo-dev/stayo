/**
 * 🔤 Embedded Font Loader
 *
 * Reads locally bundled TTF font files and returns @font-face CSS
 * with base64-encoded data URIs. This eliminates ALL external font
 * requests, ensuring:
 * - Deterministic rendering (same output offline and online)
 * - No network dependency during PDF generation
 * - Faster rendering (no font fetch latency)
 *
 * Fonts are loaded once at module init and cached in memory.
 */

import fs from "fs";
import path from "path";

interface FontEntry {
  family: string;
  weight: number;
  file: string;
}

const FONTS: FontEntry[] = [
  { family: "DM Mono", weight: 400, file: "dm-mono-400.ttf" },
  { family: "DM Mono", weight: 500, file: "dm-mono-500.ttf" },
  { family: "Inter", weight: 400, file: "inter-400.ttf" },
  { family: "Inter", weight: 500, file: "inter-500.ttf" },
  { family: "Playfair Display", weight: 400, file: "playfair-400.ttf" },
  { family: "Playfair Display", weight: 700, file: "playfair-700.ttf" },
];

let _cachedCSS: string | null = null;

/**
 * Returns @font-face CSS block with all fonts base64-embedded.
 * Cached after first call — zero disk I/O on subsequent calls.
 */
export function getEmbeddedFontCSS(): string {
  if (_cachedCSS) return _cachedCSS;

  const fontsDir = path.join(__dirname, "fonts");
  const blocks: string[] = [];

  for (const font of FONTS) {
    const filePath = path.join(fontsDir, font.file);

    try {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString("base64");
      blocks.push(`@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: ${font.weight};
  font-display: block;
  src: url(data:font/truetype;base64,${base64}) format('truetype');
}`);
    } catch (err) {
      console.warn(`[fonts] Failed to load ${font.file}:`, err);
      // Fallback: reference Google Fonts for this specific font (graceful degradation)
    }
  }

  _cachedCSS = blocks.join("\n");
  return _cachedCSS;
}

/**
 * Returns the default logo as a base64 data URI for receipts
 * when no hostel logo is configured.
 */
let _cachedLogo: string | null = null;

export function getDefaultLogoDataUri(): string {
  if (_cachedLogo) return _cachedLogo;

  // Try multiple potential favicon locations
  const candidates = [
    path.resolve(process.cwd(), "..", "frontend", "public", "favicon-32x32.png"),
    path.resolve(process.cwd(), "public", "favicon-32x32.png"),
    path.resolve(process.cwd(), "..", "frontend", "public", "favicon.ico"),
    path.resolve(process.cwd(), "public", "favicon.ico"),
  ];

  for (const candidate of candidates) {
    try {
      const buffer = fs.readFileSync(candidate);
      const ext = candidate.endsWith(".ico") ? "x-icon" : "png";
      _cachedLogo = `data:image/${ext};base64,${buffer.toString("base64")}`;
      return _cachedLogo;
    } catch {
      // try next
    }
  }

  // Absolute fallback: empty string (template will use letter initial)
  _cachedLogo = "";
  return _cachedLogo;
}
