import {
  parseCoverageRequest,
  type RecordCoverageRequestInput,
} from "./coverage-request-rules";

export interface CoverageHandlerDeps {
  checkLimit: (ip: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  resolveSeekerProfileId: () => Promise<string | null>;
  record: (input: RecordCoverageRequestInput) => Promise<{ id: string; willNotify: boolean }>;
}

export type CoverageHandlerResult =
  | { status: 201; body: { recorded: true; will_notify: boolean; id: string } }
  | { status: 400; body: { error: "INVALID_AREA" | "INVALID_CONTACT" | "INVALID_HOSTEL" } }
  | { status: 429; body: { error: "RATE_LIMITED"; retry_after_seconds: number } };

/**
 * The decision behind `POST /api/discover/coverage-requests`.
 *
 * Rate limiting runs first so a flood of junk is capped before it is parsed.
 * The seeker lookup is best-effort: a signed-in submission is nicer to have
 * attributed, but an auth hiccup must never cost us the signal, which is the
 * entire reason this endpoint exists.
 *
 * Dependency-injected so the decision is testable without a database or Redis.
 */
export async function handleCoverageRequest(
  body: unknown,
  ip: string,
  deps: CoverageHandlerDeps,
): Promise<CoverageHandlerResult> {
  const limit = await deps.checkLimit(ip);
  if (!limit.allowed) {
    return { status: 429, body: { error: "RATE_LIMITED", retry_after_seconds: limit.retryAfterSeconds } };
  }

  const parsed = parseCoverageRequest(body);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } };
  }

  let seekerProfileId: string | null = null;
  try {
    seekerProfileId = await deps.resolveSeekerProfileId();
  } catch {
    seekerProfileId = null;
  }

  const saved = await deps.record({ ...parsed.value, seekerProfileId });
  // The id comes back so a referral can be completed in a second step: the row
  // is already banked, so abandoning that step costs the signal nothing.
  return { status: 201, body: { recorded: true, will_notify: saved.willNotify, id: saved.id } };
}
