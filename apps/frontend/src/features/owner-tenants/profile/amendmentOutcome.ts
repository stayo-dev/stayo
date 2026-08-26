/**
 * Whether an agreement amendment applied or is waiting on the tenant.
 *
 * `PUT /api/tenants/:id` answers **200 + the tenant record** when the change
 * applied immediately (Category A, or any field inside the pre-activation
 * correction window) and **202 + the change request** when the policy engine
 * classified it as needing tenant approval (Category B/L2, Category C/L3).
 *
 * Neither body carries an `applied` flag. The previous drawer inferred one
 * with `data?.applied !== false`, which is `true` for both shapes — so an
 * owner who submitted a contractual change requiring the tenant's consent was
 * told "Changes applied successfully." and had no reason to follow it up.
 *
 * Both signals are checked: the status code, and the shape. A wrapper that
 * discards the status must not be able to resurrect the false positive.
 */

export interface AmendmentOutcome {
  applied: boolean;
  changeRequestId: string | null;
  message: string;
}

/** Fields only a change request carries — a tenant record has neither. */
function looksLikeChangeRequest(body: Record<string, any>): boolean {
  return body.approvalLevel != null || body.changeCategory != null;
}

export function toAmendmentOutcome(
  httpStatus: number,
  body: Record<string, any> | null | undefined,
): AmendmentOutcome {
  const payload = body ?? {};
  const pending = httpStatus === 202 || looksLikeChangeRequest(payload);

  if (!pending) {
    return { applied: true, changeRequestId: null, message: 'Agreement updated.' };
  }

  return {
    applied: false,
    changeRequestId: payload.id ? String(payload.id) : null,
    message: typeof payload.message === 'string' && payload.message.trim()
      ? payload.message
      : 'Sent to the tenant for approval.',
  };
}
