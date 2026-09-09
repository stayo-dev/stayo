/**
 * Clerk publishable-key resolution for the Vite SPA (ADR-176, Phase 2).
 *
 * Deliberately **does not throw** the way `supabaseClient.ts` does for its own
 * config. Supabase is the live session authority — without it there is no app,
 * so failing at import is correct there. Clerk in Phase 2 is additive: nothing
 * authenticates through it yet, and an unset key must leave the product working
 * exactly as before rather than white-screening every user over a provider we
 * have not switched to. `ClerkAuthProvider` renders its children unwrapped when
 * this returns `configured: false`.
 *
 * Vite only inlines `VITE_`-prefixed vars into the client bundle, so the key
 * must be `VITE_CLERK_PUBLISHABLE_KEY` in `apps/frontend/.env` — **not** the
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` that Clerk's own Next.js quickstart tells
 * you to set. That mistake is silent (the var simply does not exist in the
 * bundle), so it is detected and named here rather than surfacing as "Clerk is
 * not configured" with no explanation.
 *
 * PURE — takes the env bag as an argument, reads no globals.
 */

/** Clerk publishable keys are `pk_test_…` (development) or `pk_live_…` (production). */
const PUBLISHABLE_KEY_PREFIXES = ["pk_test_", "pk_live_"] as const;

export const CLERK_KEY_VAR = "VITE_CLERK_PUBLISHABLE_KEY";
/** The Next.js-flavoured name from Clerk's own docs. Never readable from a Vite bundle. */
export const CLERK_KEY_WRONG_VAR = "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";

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

export type ClerkConfigProblem =
  | "missing"
  | "wrong_env_prefix"
  | "malformed";

type EnvBag = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveClerkConfig(env: EnvBag): ClerkConfigResult {
  const key = str(env[CLERK_KEY_VAR]);

  if (key) {
    if (!PUBLISHABLE_KEY_PREFIXES.some((p) => key.startsWith(p))) {
      return {
        configured: false,
        publishableKey: "",
        reason: "malformed",
        // Naming the likely mix-up matters: the secret key is the adjacent
        // value in the Clerk dashboard, and pasting it into a client bundle
        // would publish it to every visitor.
        message:
          `${CLERK_KEY_VAR} does not look like a Clerk publishable key ` +
          `(expected it to start with ${PUBLISHABLE_KEY_PREFIXES.join(" or ")}). ` +
          `Check you have not pasted the secret key (sk_…), which must never reach the browser.`,
      };
    }
    return { configured: true, publishableKey: key, reason: null, message: "" };
  }

  if (str(env[CLERK_KEY_WRONG_VAR])) {
    return {
      configured: false,
      publishableKey: "",
      reason: "wrong_env_prefix",
      message:
        `${CLERK_KEY_WRONG_VAR} is set but ${CLERK_KEY_VAR} is not. This app is Vite, not ` +
        `Next.js: only VITE_-prefixed vars reach the browser bundle. Copy the value to ` +
        `${CLERK_KEY_VAR} in apps/frontend/.env.`,
    };
  }

  return {
    configured: false,
    publishableKey: "",
    reason: "missing",
    message:
      `${CLERK_KEY_VAR} is not set, so Clerk sign-in is unavailable. ` +
      `Supabase Auth is unaffected — see apps/frontend/.env.example.`,
  };
}

/** Convenience wrapper over the live Vite env. Not pure; kept trivial on purpose. */
export function readClerkConfig(): ClerkConfigResult {
  return resolveClerkConfig(import.meta.env as unknown as EnvBag);
}
