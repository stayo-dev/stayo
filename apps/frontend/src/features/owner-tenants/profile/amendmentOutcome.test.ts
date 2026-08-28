import { describe, expect, it } from 'vitest';
import { toAmendmentOutcome } from './amendmentOutcome';

/**
 * Did the amendment apply, or is it waiting on the tenant?
 *
 * `PUT /api/tenants/:id` answers 200 + the tenant when the change applied and
 * 202 + the change request when it needs tenant approval. Neither body carries
 * an `applied` flag, so the old drawer's `data?.applied !== false` was true in
 * both cases — a change request awaiting tenant consent was reported to the
 * owner as "Changes applied successfully."
 */

describe('toAmendmentOutcome', () => {
  it('reads a 202 as awaiting the tenant', () => {
    const outcome = toAmendmentOutcome(202, {
      id: 'cr-1',
      status: 'PENDING',
      approvalLevel: 'L3',
      changeCategory: 'C',
      message: 'Update requires tenant verification',
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.changeRequestId).toBe('cr-1');
  });

  it('reads a 200 as applied', () => {
    const outcome = toAmendmentOutcome(200, { id: 'tenant-1', name: 'Sharan', monthly_rent: 8000 });
    expect(outcome.applied).toBe(true);
    expect(outcome.changeRequestId).toBeNull();
  });

  it('treats an approval level in the body as pending even without the status code', () => {
    // Any wrapper that drops the HTTP status must not turn a pending request
    // into a false "applied" — the shape alone has to be enough.
    const outcome = toAmendmentOutcome(200, { id: 'cr-1', status: 'PENDING', approvalLevel: 'L2' });
    expect(outcome.applied).toBe(false);
  });

  it('does not mistake a tenant record for a change request', () => {
    const outcome = toAmendmentOutcome(200, { id: 't1', status: 'ACTIVE', name: 'Sharan' });
    expect(outcome.applied).toBe(true);
  });

  it('explains an applied change in the owner’s terms', () => {
    expect(toAmendmentOutcome(200, { id: 't1' }).message).toBe('Agreement updated.');
  });

  it('says who is being waited on when approval is needed', () => {
    expect(toAmendmentOutcome(202, { id: 'cr-1', approvalLevel: 'L3' }).message).toBe(
      'Sent to the tenant for approval.',
    );
  });

  it('prefers the server’s own message when it sends one', () => {
    const outcome = toAmendmentOutcome(202, {
      id: 'cr-1',
      approvalLevel: 'L3',
      message: 'Contractual change — tenant must accept the new terms.',
    });
    expect(outcome.message).toBe('Contractual change — tenant must accept the new terms.');
  });

  it('handles a missing body without throwing', () => {
    const outcome = toAmendmentOutcome(200, null);
    expect(outcome.applied).toBe(true);
    expect(outcome.changeRequestId).toBeNull();
  });
});
