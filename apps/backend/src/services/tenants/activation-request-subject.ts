import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getActiveTenancy } from "@/lib/tenancy/active-tenancy";
import { resolveActivationSubject, type ActivationSubjectRef } from "./activation-subject";

/**
 * Turn an incoming activation request into the credential it is presenting.
 *
 * The token is read first and, when present, short-circuits everything below —
 * no session lookup, no extra query, no behaviour change for the invited-tenant
 * flow. See `activation-subject.ts` for why a second way in exists at all.
 *
 * The session branch resolves the tenancy through `getActiveTenancy`, never by
 * trusting a tenancy id from the client. That matters twice over: it is the
 * blessed "which tenancy" helper the backend invariants check exists to
 * enforce, and it means a session can only ever act on *its own* live tenancy.
 * See ADR-155.
 */
export async function activationSubjectFromRequest(
  req: NextRequest,
  token: string | null | undefined,
): Promise<ActivationSubjectRef> {
  const presented = String(token ?? "").trim();
  if (presented) return resolveActivationSubject({ token: presented });

  const session = await getSession(req).catch(() => null);
  if (!session || session.role !== "TENANT") return resolveActivationSubject({});

  const tenancy = await getActiveTenancy(session.sub).catch(() => null);
  return resolveActivationSubject({ sessionTenantId: tenancy?.id ?? null });
}
