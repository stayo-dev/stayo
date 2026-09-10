/*
 * Fails the build on the legal-content rules that must never regress silently.
 *
 * Structural rules (every document has a version, an effective date, a summary,
 * a resolvable route) live in src/content/legal/*.test.ts, which can import the
 * registry directly. This file covers what only a text scan can see, and every
 * rule here guards a mistake this repo has already made:
 *
 *  1. A payment gateway named in shipped code. "Razorpay" was scattered through
 *     six documents and a pay sheet, and the public homepage said "Secure
 *     Payments via PhonePe" — a provider Stayo does not use.
 *  2. An unresolved placeholder shipping in published legal copy.
 *  3. A GSTIN claimed by Stayo, a sole proprietorship that is not GST-registered.
 *  4. Analytics appearing after the Cookie Notice told users there is none —
 *     which would silently turn a true published statement into a false one.
 *
 * Precision matters more than coverage: a guard that fires on false positives
 * gets switched off. So each pattern targets a real integration or a real
 * claim, not a bare word. Specifically:
 *
 *  - Test files are skipped. They are never shipped, and they necessarily
 *    contain the very strings they assert against.
 *  - PhonePe, Paytm and GPay are UPI apps a payer may use, so "GPay, PhonePe,
 *    Paytm and more" is accurate checkout copy. What is forbidden is presenting
 *    one of them as the processor ("payments via PhonePe") — rule 1b.
 *  - The GSTIN rule is scoped to Stayo's published legal content. A hostel's
 *    own GSTIN, which owners enter and which prints on their receipts, is
 *    correct and appears elsewhere in the owner app.
 *  - Analytics is matched by how it is actually loaded or called (hostnames,
 *    imports, `gtag('…')`), so a comment that documents the grep command used to
 *    verify its absence does not trip it.
 *
 * Sibling of scripts/check-architecture.mjs and scripts/check-brand-fossils.mjs;
 * all three run from `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const SOURCE = /\.(tsx?|jsx?|mjs|cjs|html)$/i;
const TEST_FILE = /\.test\.(tsx?|jsx?)$/i;
const failures = [];

/**
 * The only shipped files allowed to contain a gateway name, and why.
 * Everything else must describe the aggregator, never name it.
 */
const GATEWAY_NAME_ALLOWLIST = new Map([
  ['src/content/company.ts', 'PAYMENT_PARTNER.name — the one internal reference; published copy uses .descriptor'],
  ['src/features/help-center/helpCenter.ts', 'keyword lists matching what a user types; never rendered'],
]);

/** 1a. Payment gateways and aggregators. */
const GATEWAYS = /\b(razorpay|easebuzz|cashfree|payu|ccavenue|billdesk|instamojo|juspay|stripe)\b/i;
/** 1b. A UPI app presented as the processor, e.g. "Secure Payments via PhonePe". */
const PROCESSOR_CLAIM = /\b(secured?|powered|processed|payments?)\s+(by|via|through)\s+(phonepe|paytm|g-?pay|google\s?pay|bhim)\b/i;
/** 2. Placeholders left in published legal copy. */
const PLACEHOLDERS = /\bTBD\b|\bTODO\b|\bXXX\b|\[PROPRIETOR|\[ADDRESS|\[GRIEVANCE|\[NAME\]/i;
/** 3. A GSTIN claim (the word, or a GSTIN-shaped identifier). Case-sensitive. */
const GSTIN = /\bGSTIN\b|\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b/;
/** 4. Analytics, advertising or tracking — matched by how it is loaded or called. */
const ANALYTICS = new RegExp(
  [
    String.raw`googletagmanager\.com`,
    String.raw`google-analytics\.com`,
    String.raw`\bgtag\(\s*['"]`,
    String.raw`\bfbq\(\s*['"]`,
    String.raw`connect\.facebook\.net`,
    String.raw`posthog\.(?:init|capture)`,
    String.raw`from\s+['"]posthog`,
    String.raw`mixpanel\.(?:init|track)`,
    String.raw`from\s+['"]mixpanel`,
    String.raw`static\.hotjar\.com`,
    String.raw`clarity\.ms\/`,
    String.raw`cdn\.segment\.(?:com|io)`,
    String.raw`cdn\.amplitude\.com`,
    String.raw`from\s+['"]@vercel\/analytics`,
    String.raw`from\s+['"]@amplitude`,
    String.raw`from\s+['"]@segment`,
  ].join('|'),
  'i',
);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full);
    return SOURCE.test(entry.name) ? [full] : [];
  });
}

const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'index.html')].filter(
  (file) => fs.existsSync(file) && !TEST_FILE.test(file),
);

for (const file of files) {
  const rel = path.relative(ROOT, file).replaceAll(path.sep, '/');
  const source = fs.readFileSync(file, 'utf8');
  const isLegalContent = rel.startsWith('src/content/');

  if (!GATEWAY_NAME_ALLOWLIST.has(rel)) {
    const gateway = source.match(GATEWAYS);
    if (gateway) {
      failures.push(
        `${rel}: names the payment gateway "${gateway[0]}". Published copy must describe the aggregator (PAYMENT_PARTNER.descriptor in src/content/company.ts), never name it.`,
      );
    }
  }

  const claim = source.match(PROCESSOR_CLAIM);
  if (claim) {
    failures.push(
      `${rel}: "${claim[0]}" presents a UPI app as the payment processor. Say payments are secure and RBI-authorised without naming a provider.`,
    );
  }

  if (isLegalContent) {
    const placeholder = source.match(PLACEHOLDERS);
    if (placeholder) failures.push(`${rel}: unresolved placeholder "${placeholder[0]}" in published legal content`);

    if (GSTIN.test(source)) {
      failures.push(`${rel}: claims a GSTIN — Trishul Solutions is a sole proprietorship that is not GST-registered`);
    }
  }

  const tracker = source.match(ANALYTICS);
  if (tracker) {
    failures.push(
      `${rel}: third-party analytics or tracking ("${tracker[0]}"). The Cookie Notice states Stayo sets no analytics cookies and shows no consent banner, so this would make it false. Update src/content/legal/cookies.ts and revisit the consent-banner decision (spec §6.6) before shipping this.`,
    );
  }
}

if (failures.length) {
  console.error(`Legal content check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Legal content check passed (${files.length} files)`);
