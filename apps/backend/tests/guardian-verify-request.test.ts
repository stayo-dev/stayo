import { describe, it, expect, afterEach } from "vitest";
import {
  buildGuardianVerifyRequestPayload,
  guardianVerifyRequestTemplateName,
  guardianVerifyRequestTemplateLanguage,
  isGuardianVerifyRequestConfigured,
  isGuardianConfirmReply,
  GUARDIAN_VERIFY_REQUEST_TEMPLATE,
} from "@/lib/services/notifications/providers/whatsapp/guardian-verify-request-template-contract";
import {
  resolveGuardianConfirmation,
  guardianConfirmReply,
  selectGuardianRequestByReply,
  type PendingGuardianRequest,
} from "@/lib/services/notifications/command-center/guardian-confirm-resolution";

const ENV_KEYS = [
  GUARDIAN_VERIFY_REQUEST_TEMPLATE.envVar,
  GUARDIAN_VERIFY_REQUEST_TEMPLATE.languageEnvVar,
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("guardian verify-request template contract", () => {
  it("falls back to the default name and language", () => {
    // `guardian_invitation`, not a `stayo_*` name: the template was created by
    // hand under that name and Meta does not allow renaming. The default has to
    // match what actually exists on the WABA.
    expect(guardianVerifyRequestTemplateName()).toBe("guardian_invitation");
    expect(guardianVerifyRequestTemplateLanguage()).toBe("en");
  });

  it("lets the environment override both", () => {
    process.env[GUARDIAN_VERIFY_REQUEST_TEMPLATE.envVar] = "stayo_guardian_verify_v2";
    process.env[GUARDIAN_VERIFY_REQUEST_TEMPLATE.languageEnvVar] = "en_US";
    expect(guardianVerifyRequestTemplateName()).toBe("stayo_guardian_verify_v2");
    expect(guardianVerifyRequestTemplateLanguage()).toBe("en_US");
  });

  it("reports itself unconfigured until a template name is set, so the caller can fall back", () => {
    expect(isGuardianVerifyRequestConfigured()).toBe(false);
    process.env[GUARDIAN_VERIFY_REQUEST_TEMPLATE.envVar] = "guardian_invitation";
    expect(isGuardianVerifyRequestConfigured()).toBe(true);
  });

  it("recognises the static quick reply Meta actually echoes back", () => {
    // The submitted template uses a *static* quick reply, so a tap arrives as
    // the button's own text rather than as `quickReply.payload`. Both must
    // resolve, or the button does nothing.
    expect(isGuardianConfirmReply(GUARDIAN_VERIFY_REQUEST_TEMPLATE.quickReply.text)).toBe(true);
    expect(isGuardianConfirmReply(GUARDIAN_VERIFY_REQUEST_TEMPLATE.quickReply.payload)).toBe(true);
  });

  it("carries a quick reply whose payload is a keyword, not a CC: id", () => {
    // A `CC:`-style id would be dropped: extractMessageEvents turns a template
    // button into a *text* event that resolves through the command vocabulary.
    expect(GUARDIAN_VERIFY_REQUEST_TEMPLATE.quickReply.payload).toMatch(/^[A-Za-z]+$/);
  });

  describe("body parameters", () => {
    it("maps the three parameters in template order", () => {
      expect(
        buildGuardianVerifyRequestPayload({
          guardianName: "Lakshmi",
          tenantName: "Aarav",
          hostelName: "Sunrise Residency",
        }),
      ).toEqual(["Lakshmi", "Aarav", "Sunrise Residency"]);
    });

    it("never emits a blank parameter, which Meta rejects outright", () => {
      const payload = buildGuardianVerifyRequestPayload({
        guardianName: "",
        tenantName: null,
        hostelName: undefined,
      });
      expect(payload).toHaveLength(3);
      for (const value of payload) expect(value.trim()).not.toBe("");
    });

    it("strips a possessive from the tenant name", () => {
      // The body already says "has listed you as their parent/guardian", so
      // "Aarav's has listed you" is the failure this guards.
      expect(
        buildGuardianVerifyRequestPayload({
          guardianName: "Lakshmi",
          tenantName: "Aarav's",
          hostelName: "Sunrise",
        })[1],
      ).toBe("Aarav");
    });
  });

  describe("recognising the tap", () => {
    it("accepts the payload and the button's own text", () => {
      expect(isGuardianConfirmReply("ConfirmWard")).toBe(true);
      expect(isGuardianConfirmReply("Yes, I confirm")).toBe(true);
      expect(isGuardianConfirmReply("  confirmward  ")).toBe(true);
    });

    it("does not swallow unrelated messages", () => {
      expect(isGuardianConfirmReply("DUES")).toBe(false);
      expect(isGuardianConfirmReply("yes")).toBe(false);
      expect(isGuardianConfirmReply("")).toBe(false);
    });
  });
});

describe("resolveGuardianConfirmation", () => {
  const one: PendingGuardianRequest = {
    requestId: "r1",
    tenantId: "t1",
    tenantName: "Aarav",
    hostelName: "Sunrise",
  };
  const two: PendingGuardianRequest = {
    requestId: "r2",
    tenantId: "t2",
    tenantName: "Ishita",
    hostelName: "Sunrise",
  };

  it("treats a stale tap as nothing to do, not as an error", () => {
    const resolution = resolveGuardianConfirmation([]);
    expect(resolution.kind).toBe("NOTHING_PENDING");
    expect(guardianConfirmReply(resolution)).not.toMatch(/error|invalid|wrong/i);
  });

  it("confirms when exactly one request is outstanding", () => {
    const resolution = resolveGuardianConfirmation([one]);
    expect(resolution).toEqual({ kind: "CONFIRM", request: one });
    expect(guardianConfirmReply(resolution)).toContain("Aarav");
  });

  it("asks which ward rather than guessing when a parent has two", () => {
    const resolution = resolveGuardianConfirmation([one, two]);
    expect(resolution.kind).toBe("ASK_WHICH");
    const reply = guardianConfirmReply(resolution);
    expect(reply).toContain("1. Aarav");
    expect(reply).toContain("2. Ishita");
  });

  describe("selectGuardianRequestByReply", () => {
    const requests = [one, two];

    it("selects by position", () => {
      expect(selectGuardianRequestByReply(requests, "2")).toEqual(two);
      expect(selectGuardianRequestByReply(requests, " 1 ")).toEqual(one);
    });

    it("refuses an out-of-range or non-numeric reply rather than guessing", () => {
      expect(selectGuardianRequestByReply(requests, "3")).toBeNull();
      expect(selectGuardianRequestByReply(requests, "0")).toBeNull();
      expect(selectGuardianRequestByReply(requests, "Aarav")).toBeNull();
      expect(selectGuardianRequestByReply(requests, "")).toBeNull();
    });
  });
});
