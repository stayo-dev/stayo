/*
 * Fails the build if the retired pre-Stayo brand reappears anywhere under
 * `src/` or in `index.html`.
 *
 * Why a script and not code review: this exact regression has shipped three
 * times (see docs/obsidian/Bugs.md and the 2026-07-24 Changelog entry). Each
 * time the mechanism was the same — a screen written against the design
 * tokens rendered somewhere the Stayo tokens did not reach, so it silently
 * resolved the old identity instead. ADR-172 removed that fallback by putting
 * the brand tokens on the unscoped `:root`; this file is what stops the old
 * values being pasted back in by hand, which is the other half of the same
 * problem — a screenshot of the old app is still the easiest thing to copy.
 *
 * Sibling of scripts/check-architecture.mjs; both run from `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS = ['src', 'index.html'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const TEXT = /\.(tsx?|jsx?|mjs|cjs|css|html)$/i;

/**
 * The retired identity, by value rather than by name — a hex is what actually
 * gets pasted in. Each entry names what to use instead, because "don't" on its
 * own has never been enough to stop this coming back.
 */
const FOSSILS = [
  [/#1B2D5B/i, 'retired navy', 'use `bg-primary`/`text-foreground` (Warm Clay #B46A55 / Charcoal)'],
  [/#243A72/i, 'retired navy tint', 'use `bg-primary` or `bg-primary/5`'],
  [/#2d5a96/i, 'retired navy gradient stop', 'use #A45D44 → #B46A55'],
  [/#F07B1D/i, 'retired saffron', 'use `bg-primary` (#B46A55) or Dusty Orange #D2986C for tints'],
  [/#FBB040/i, 'retired golden', 'use `--warning` (#B8792B)'],
  [/#FFFDF5/i, 'retired warm ivory', 'use `--background` (Cream #F7F3EE / #f7f3ef)'],
  [/#2C2C2A/i, 'retired charcoal', 'use `--foreground` (#221E1A) or brand Charcoal #2F2F2F'],
  [/#6B6259/i, 'retired neutral grey', 'use `--muted-foreground` (#8A7F75)'],
  [/\bPlayfair(\s|\+)?Display\b/i, 'retired display face', 'use Manrope via `--font-display`'],
  [/(['"`])Poppins\1|family=Poppins|\bPoppins\b/i, 'retired body face', 'use Inter via `--font-body`'],
];

const failures = [];

function scan(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [pattern, what, instead] of FOSSILS) {
      if (pattern.test(line)) {
        failures.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          what,
          instead,
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
}

function walk(entry) {
  const stat = fs.statSync(entry);
  if (stat.isFile()) {
    if (TEXT.test(entry)) scan(entry);
    return;
  }
  for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
    if (child.isDirectory() && SKIP_DIRS.has(child.name)) continue;
    walk(path.join(entry, child.name));
  }
}

for (const target of TARGETS) {
  const full = path.join(ROOT, target);
  if (fs.existsSync(full)) walk(full);
}

if (failures.length > 0) {
  console.error(
    `\n[brand-check] The retired pre-Stayo brand is back in ${failures.length} place(s).\n` +
      `Stayo's palette is Stayo-Brand-Assetes/color/colors.txt; the tokens are in src/styles/theme.css.\n`,
  );
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  ${f.what} — ${f.instead}`);
    console.error(`      ${f.text}`);
  }
  console.error('');
  process.exit(1);
}

console.log('[brand-check] No retired-brand values found.');
