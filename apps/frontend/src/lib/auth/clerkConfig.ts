/**
 * Clerk publishable-key resolution for the Vite SPA (ADR-176).
 *
 * Reads exactly one variable, `VITE_CLERK_PUBLISHABLE_KEY`, off
 * `import.meta.env`. The `VITE_` prefix is not a style choice: Vite exposes
 * *only* prefixed vars to browser code, so a differently-named variable is not
 * merely discouraged here, it is invisible. A production build inlines
 * `import.meta.env` as, literally:
 *
 *   {BASE_URL, DEV, MODE, PROD, SSR, VITE_API_URL, VITE_SUPABASE_*, …}
 *
 * — nothing else is in the object at runtime. An earlier version of this file
 * tried to detect a Next.js-style variable name and explain the mistake; that
 * check could never fire, because the name it looked for is absent from
 * `import.meta.env` by construction. The lookup is gone rather than left in
 * place looking like a safety net.
 *
 * Secrets never appear here. `CLERK_SECRET_KEY` is backend-only and is not read
 * by this app at all — anything inlined into `import.meta.env` is served to
 * every visitor, which is why a `sk_` value is rejected outright below.
 *
 * Deliberately **does not throw**, unlike `supabaseClient.ts`. Supabase is the
 * live session authority — without it there is no app, so failing at import is
 * correct there. Clerk is additive: an unset key must leave the product working
 * exactly as before rather than white-screening every user over a provider we
 * have not switched to. `ClerkAuthProvider` renders its children unwrapped when
 * this returns `configured: false`.
 */

/** Clerk publishable keys are `pk_test_…` (development) or `pk_live_…` (production). */
const PUBLISHABLE_KEY_PREFIXES = ["pk_test_", "pk_live_"] as const;

/** The only Clerk variable this app reads. */
export const CLERK_KEY_VAR = "VITE_CLERK_PUBLISHABLE_KEY";

export type ClerkConfigProblem = "missing" | "malformed";

/**
 * A flat shape rather than a discriminated union on `configured`, because this
 * project compiles with `strict: false` — and without `strictNullChecks`,
 * TypeScript does not narrow a union by a boolean-literal discriminant. The
 * union version compiled here and failed at every call site.
 */
export interface ClerkConfigResult {
  configured: boolean;
  /** The key when configured; empty string otherwise. */
  publishableKey: string;
  /** `null` when configured. */
  reason: ClerkConfigProblem | null;
  /** Empty when configured; the diagnostic to show or log otherwise. */
  message: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Pure: decides what a given key value means. Takes the value rather than an
 * env bag so the one place that touches `import.meta.env` is `readClerkConfig`
 * below, and so this stays trivially testable in a node-only suite.
 */
export function resolveClerkConfig(rawKey: unknown): ClerkConfigResult {
  const key = str(rawKey);

  if (!key) {
    return {
      configured: false,
      publishableKey: "",
      reason: "missing",
      message:
        `${CLERK_KEY_VAR} is not set, so Clerk sign-in is unavailable. ` +
        `Only VITE_-prefixed variables reach the browser bundle, and this app ` +
        `reads its own apps/frontend/.env — not the repo-root one. ` +
        `Supabase Auth is unaffected — see apps/frontend/.env.example.`,
    };
  }

  if (!PUBLISHABLE_KEY_PREFIXES.some((p) => key.startsWith(p))) {
    return {
      configured: false,
      publishableKey: "",
      reason: "malformed",
      // Naming the likely mix-up matters: the secret key is the adjacent value
      // in the Clerk dashboard, and pasting it here would inline it into the
      // client bundle and publish it to every visitor.
      message:
        `${CLERK_KEY_VAR} does not look like a Clerk publishable key ` +
        `(expected it to start with ${PUBLISHABLE_KEY_PREFIXES.join(" or ")}). ` +
        `Check you have not pasted the secret key (sk_…), which is backend-only ` +
        `and must never reach the browser.`,
    };
  }

  return { configured: true, publishableKey: key, reason: null, message: "" };
}

/**
 * The single point of contact with `import.meta.env`.
 *
 * Written as a static property access — `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY`
 * — rather than a dynamic lookup on the env object, so Vite replaces it with
 * the key's literal value at build time.
 */
export function readClerkConfig(): ClerkConfigResult {
  return resolveClerkConfig(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
}
