/**
 * The Clerk Backend API client (ADR-204).
 *
 * Clerk is the only authentication provider: it holds every password and every
 * session. This module is the one place a Backend API client is built, so the
 * secret key is read in exactly one spot and tests can swap the client for a
 * fake without mocking the SDK's module graph.
 *
 * Node-only. `middleware.ts` verifies session tokens with
 * `lib/auth/clerk-jwt-edge.ts`, which needs no Backend API client.
 */
import { createClerkClient } from "@clerk/backend";

/**
 * The slice of the Backend API this app uses. Declared structurally so a test
 * double only has to implement what is actually called — and so any new call
 * has to be added here, where it is visible, rather than reached for ad hoc.
 */
export interface ClerkBackend {
  users: {
    createUser(params: Record<string, unknown>): Promise<{ id: string }>;
    updateUser(userId: string, params: Record<string, unknown>): Promise<{ id: string }>;
    verifyPassword(params: { userId: string; password: string }): Promise<{ verified: true }>;
    getUserList(params: Record<string, unknown>): Promise<{ data: Array<{ id: string; externalId: string | null }> }>;
    deleteUser(userId: string): Promise<unknown>;
  };
  sessions: {
    getSessionList(params: { userId: string; status?: string; limit?: number }): Promise<{ data: Array<{ id: string }> }>;
    revokeSession(sessionId: string): Promise<unknown>;
  };
  signInTokens: {
    createSignInToken(params: { userId: string; expiresInSeconds: number }): Promise<{ token: string }>;
  };
}

let client: ClerkBackend | null = null;

export function getClerkBackend(): ClerkBackend {
  if (client) return client;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    // Fails closed. A password flow that cannot reach the credential store
    // must not report success — that is exactly the H2 bug (a reset that did
    // not reset).
    throw new Error("INTERNAL: CLERK_SECRET_KEY is not set — Clerk is the credential store");
  }
  client = createClerkClient({ secretKey }) as unknown as ClerkBackend;
  return client;
}

/** Test seam. Pass `null` to restore the real client. */
export function setClerkBackendForTests(fake: ClerkBackend | null) {
  client = fake;
}
