/**
 * The CSP must let Clerk load, without loosening anything else (ADR-176).
 *
 * Production Clerk serves `clerk-js` from the instance's own Frontend API
 * origin — `https://clerk.yourstayo.com/npm/@clerk/clerk-js/...`. That origin
 * was not in `script-src`, so the browser refused the script with
 * `failed_to_load_clerk_js` and Google OAuth never started: Clerk was never
 * there to redirect.
 *
 * The CSP lives in `apps/frontend/vercel.json` — the only place it is defined.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const CLERK_FRONTEND_API = 'https://clerk.yourstayo.com';
const CLERK_BACKEND_API = 'https://api.clerk.com';

function directives(): Record<string, string[]> {
  const config = JSON.parse(fs.readFileSync(path.join(APP, 'vercel.json'), 'utf8'));
  const header = config.headers
    .flatMap((block: { headers: { key: string; value: string }[] }) => block.headers)
    .find((h: { key: string }) => h.key === 'Content-Security-Policy');

  expect(header, 'no Content-Security-Policy header in vercel.json').toBeTruthy();

  return Object.fromEntries(
    header.value
      .split(';')
      .map((part: string) => part.trim())
      .filter(Boolean)
      .map((part: string) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      }),
  );
}

describe('Clerk is allow-listed', () => {
  const csp = directives();

  it('serves clerk-js: the Frontend API origin is in script-src', () => {
    expect(csp['script-src']).toContain(CLERK_FRONTEND_API);
  });

  it('script-src-elem is present and includes Clerk', () => {
    // Chrome falls back to script-src when this is absent, but stating it
    // explicitly is what the production console asked for.
    expect(csp['script-src-elem']).toBeDefined();
    expect(csp['script-src-elem']).toContain(CLERK_FRONTEND_API);
  });

  it('the SDK can reach both Clerk hosts from connect-src', () => {
    expect(csp['connect-src']).toContain(CLERK_FRONTEND_API);
    expect(csp['connect-src']).toContain(CLERK_BACKEND_API);
  });
});

describe('nothing else was loosened', () => {
  const csp = directives();

  it('script-src-elem mirrors script-src rather than narrowing it', () => {
    // The trap: `script-src-elem` OVERRIDES `script-src` for <script> elements.
    // A Clerk-only value here would have silently blocked Razorpay's checkout
    // and Google's scripts while looking like a minimal, careful change.
    for (const source of csp['script-src']) {
      expect(csp['script-src-elem'], `script-src-elem drops ${source}`).toContain(source);
    }
  });

  it('keeps the existing Razorpay entries', () => {
    expect(csp['script-src']).toContain('https://checkout.razorpay.com');
    expect(csp['script-src-elem']).toContain('https://checkout.razorpay.com');
    expect(csp['connect-src']).toContain('https://api.razorpay.com');
    expect(csp['frame-src']).toContain('https://api.razorpay.com');
  });

  it('keeps the existing Google entries, including frame-src', () => {
    expect(csp['script-src']).toContain('https://accounts.google.com');
    expect(csp['connect-src']).toContain('https://accounts.google.com');
    expect(csp['frame-src']).toContain('https://accounts.google.com');
    expect(csp['frame-src']).toContain('https://www.google.com');
  });

  it('uses no Clerk wildcard', () => {
    // `https://*.clerk.com` would admit every Clerk tenant, not just ours.
    for (const [name, values] of Object.entries(csp)) {
      for (const value of values) {
        expect(value, `${name} contains a Clerk wildcard`).not.toMatch(/\*\.clerk\./);
      }
    }
  });

  it('leaves the hardening directives untouched', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['upgrade-insecure-requests']).toEqual([]);
  });

  it('does not admit Clerk anywhere it is not needed', () => {
    // Clerk uses a top-level redirect, not an iframe.
    expect(csp['frame-src']).not.toContain(CLERK_FRONTEND_API);
  });
});
