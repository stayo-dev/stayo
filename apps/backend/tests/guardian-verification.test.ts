import { describe, it, expect } from "vitest";
import {
  resolveGuardianVerification,
  shouldShowGuardianWall,
  guardianDeadline,
  isGuardianDeferralReason,
  nextPromptAfterDismissal,
  GUARDIAN_SNOOZE_DAYS,
  readGuardianVerificationPolicy,
  GUARDIAN_GRACE_DAYS,
  type GuardianVerificationInput,
} from "@/src/services/tenants/guardian-verification";

const NOW = new Date("2026-09-16T10:00:00.000Z");

function input(overrides: Partial<GuardianVerificationInput> = {}): GuardianVerificationInput {
  return {
    policy: "MANDATORY",
    hasGuardianPhone: true,
    verified: false,
    guardianRequired: true,
    deferredAt: null,
    nextPromptAt: null,
    now: NOW,
    ...overrides,
  };
}

describe("resolveGuardianVerification", () => {
  it("is VERIFIED regardless of policy or deferral once proof exists", () => {
    for (const policy of ["MANDATORY", "OPTIONAL"] as const) {
      const status = resolveGuardianVerification(
        input({ policy, verified: true, deferredAt: new Date("2026-01-01T00:00:00.000Z") }),
      );
      expect(status.state).toBe("VERIFIED");
      expect(status.wallDue).toBe(false);
      expect(status.deadlineAt).toBeNull();
    }
  });

  it("is NOT_APPLICABLE for a tenant with no guardian number who needs none", () => {
    const status = resolveGuardianVerification(
      input({ hasGuardianPhone: false, guardianRequired: false }),
    );
    expect(status.state).toBe("NOT_APPLICABLE");
    expect(status.chased).toBe(false);
  });

  it("still chases a STUDENT who has not given a number yet", () => {
    const status = resolveGuardianVerification(
      input({ hasGuardianPhone: false, guardianRequired: true }),
    );
    expect(status.state).toBe("PENDING_GRACE");
    expect(status.chased).toBe(true);
  });

  describe("OPTIONAL hostels", () => {
    it("record the gap but never chase it", () => {
      const status = resolveGuardianVerification(input({ policy: "OPTIONAL" }));
      expect(status.state).toBe("PENDING_UNCHASED");
      expect(status.chased).toBe(false);
      expect(status.wallDue).toBe(false);
    });

    it("do not resurrect a deadline from a deferral made while MANDATORY", () => {
      // An owner who relaxes the policy must actually relax it — a clock left
      // ticking invisibly would produce a wall in a hostel that opted out.
      const longAgo = new Date("2026-01-01T00:00:00.000Z");
      const status = resolveGuardianVerification(input({ policy: "OPTIONAL", deferredAt: longAgo }));
      expect(status.state).toBe("PENDING_UNCHASED");
      expect(status.deadlineAt).toBeNull();
      expect(status.wallDue).toBe(false);
    });
  });

  describe("MANDATORY hostels", () => {
    it("has no deadline before the tenant has deferred", () => {
      const status = resolveGuardianVerification(input({ deferredAt: null }));
      expect(status.state).toBe("PENDING_GRACE");
      expect(status.deadlineAt).toBeNull();
      expect(status.wallDue).toBe(false);
    });

    it("stays in grace inside the promised window", () => {
      const deferredAt = new Date("2026-09-15T10:00:00.000Z");
      const status = resolveGuardianVerification(input({ deferredAt }));
      expect(status.state).toBe("PENDING_GRACE");
      expect(status.deadlineAt?.toISOString()).toBe("2026-09-22T10:00:00.000Z");
      expect(status.wallDue).toBe(false);
    });

    it("goes overdue exactly at the deadline, not a day later", () => {
      const deferredAt = new Date("2026-09-09T10:00:00.000Z");
      const atDeadline = resolveGuardianVerification(
        input({ deferredAt, now: new Date("2026-09-16T10:00:00.000Z") }),
      );
      expect(atDeadline.state).toBe("PENDING_OVERDUE");
      expect(atDeadline.wallDue).toBe(true);

      const oneSecondEarlier = resolveGuardianVerification(
        input({ deferredAt, now: new Date("2026-09-16T09:59:59.000Z") }),
      );
      expect(oneSecondEarlier.state).toBe("PENDING_GRACE");
      expect(oneSecondEarlier.wallDue).toBe(false);
    });
  });
});

describe("guardianDeadline", () => {
  it("is null with no deferral, so the screen can promise nothing it has not been told", () => {
    expect(guardianDeadline(null)).toBeNull();
  });

  it("is the grace window after the deferral", () => {
    const deferredAt = new Date("2026-09-16T10:00:00.000Z");
    const deadline = guardianDeadline(deferredAt)!;
    const days = (deadline.getTime() - deferredAt.getTime()) / 86_400_000;
    expect(days).toBe(GUARDIAN_GRACE_DAYS);
  });

  it("falls back to the original promise for a tenancy with no next prompt", () => {
    // Rows deferred before `next_prompt_at` existed get exactly what they were
    // told: seven days from the deferral.
    expect(guardianDeadline(new Date("2026-09-16T10:00:00.000Z"), null)?.toISOString())
      .toBe("2026-09-23T10:00:00.000Z");
  });

  it("crosses a month boundary correctly", () => {
    expect(guardianDeadline(new Date("2026-09-28T10:00:00.000Z"))?.toISOString())
      .toBe("2026-10-05T10:00:00.000Z");
  });
});

describe("shouldShowGuardianWall", () => {
  const overdue = resolveGuardianVerification(
    input({ deferredAt: new Date("2026-09-01T10:00:00.000Z") }),
  );

  it("never shows when the wall is not due", () => {
    const grace = resolveGuardianVerification(input({ deferredAt: new Date("2026-09-15T10:00:00.000Z") }));
    expect(shouldShowGuardianWall(grace)).toBe(false);
  });

  it("shows once it comes due", () => {
    expect(overdue.wallDue).toBe(true);
    expect(shouldShowGuardianWall(overdue)).toBe(true);
  });

  it("comes back after a dismissal, rather than being silenced for ever", () => {
    // Regression. The back-off was a counter incremented on dismissal and
    // gated on `promptCount % 3`, so: 0 -> shown -> dismissed -> 1, and
    // 1 % 3 !== 0 blocked it permanently while the count could never advance.
    // The wall appeared exactly once per tenancy. A counter that only moves on
    // the event it gates cannot gate that event — so the back-off is a date.
    const dismissedAt = new Date("2026-09-16T10:00:00.000Z");
    const nextPromptAt = nextPromptAfterDismissal(dismissedAt);

    const rightAfterDismissing = resolveGuardianVerification(
      input({ deferredAt: new Date("2026-09-01T10:00:00.000Z"), nextPromptAt, now: dismissedAt }),
    );
    expect(shouldShowGuardianWall(rightAfterDismissing)).toBe(false);

    const afterTheSnooze = resolveGuardianVerification(
      input({
        deferredAt: new Date("2026-09-01T10:00:00.000Z"),
        nextPromptAt,
        now: new Date(nextPromptAt.getTime() + 1000),
      }),
    );
    expect(shouldShowGuardianWall(afterTheSnooze)).toBe(true);
  });

  it("snoozes by less than the original grace window", () => {
    // A first deferral is "not at this desk, right now" and earns a week; a
    // dismissal is "not this time" and earns a few days.
    expect(GUARDIAN_SNOOZE_DAYS).toBeLessThan(7);
    const from = new Date("2026-09-16T10:00:00.000Z");
    const days = (nextPromptAfterDismissal(from).getTime() - from.getTime()) / 86_400_000;
    expect(days).toBe(GUARDIAN_SNOOZE_DAYS);
  });

  it("prefers an explicit next prompt over the original deferral's deadline", () => {
    const status = resolveGuardianVerification(
      input({
        deferredAt: new Date("2026-09-01T10:00:00.000Z"),
        nextPromptAt: new Date("2026-09-20T10:00:00.000Z"),
      }),
    );
    expect(status.deadlineAt?.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(status.state).toBe("PENDING_GRACE");
  });
});

describe("isGuardianDeferralReason", () => {
  it("accepts the fixed set and nothing else", () => {
    expect(isGuardianDeferralReason("TRAVELLING")).toBe(true);
    expect(isGuardianDeferralReason("NO_WHATSAPP")).toBe(true);
    expect(isGuardianDeferralReason("because i said so")).toBe(false);
    expect(isGuardianDeferralReason(undefined)).toBe(false);
  });
});

describe("readGuardianVerificationPolicy", () => {
  it("defaults to MANDATORY when the hostel predates the setting", () => {
    expect(readGuardianVerificationPolicy(null)).toBe("MANDATORY");
    expect(readGuardianVerificationPolicy({})).toBe("MANDATORY");
    expect(readGuardianVerificationPolicy({ tenant_rules: {} })).toBe("MANDATORY");
  });

  it("reads a raw preferences_config and a normalized policy alike", () => {
    expect(readGuardianVerificationPolicy({ tenant_rules: { guardian_verification: "OPTIONAL" } })).toBe("OPTIONAL");
    expect(readGuardianVerificationPolicy({ policy: { tenant_rules: { guardian_verification: "OPTIONAL" } } })).toBe("OPTIONAL");
  });

  it("does not let an unrecognised value quietly mean OPTIONAL", () => {
    expect(readGuardianVerificationPolicy({ tenant_rules: { guardian_verification: "optionall" } })).toBe("MANDATORY");
    expect(readGuardianVerificationPolicy({ tenant_rules: { guardian_verification: false } })).toBe("MANDATORY");
  });
});
