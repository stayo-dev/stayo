import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  assertTemplateMatchesContract,
  checkOtpTemplateContract,
  countPlaceholders,
  describeTemplateShape,
  resetOtpTemplateContractCache,
  verifyOtpTemplateContractOnce,
} from "@/lib/services/notifications/providers/whatsapp/otp-template-contract";
import { WhatsAppConfigError } from "@/lib/services/notifications/providers/whatsapp/errors";

vi.mock("@/lib/logger", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), metrics: vi.fn() };
  return { getLogger: () => logger };
});

/** The template exactly as Meta returns it today. */
const approvedTemplate = () => ({
  name: "otp",
  status: "APPROVED",
  category: "AUTHENTICATION",
  language: "en_US",
  components: [
    {
      type: "BODY",
      text: "OTP Code: {{1}}. This is your OTP code for {{2}}. For your security, do not share this code.",
    },
    { type: "FOOTER", text: "Expires in 5 minutes." },
    {
      type: "BUTTONS",
      buttons: [
        {
          type: "URL",
          text: "Copy code",
          url: "https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code_expiration_minutes=5&code=otp{{1}}",
        },
      ],
    },
  ],
});

describe("countPlaceholders", () => {
  it("counts distinct positional variables", () => {
    expect(countPlaceholders("{{1}} and {{2}}")).toBe(2);
    expect(countPlaceholders("code=otp{{1}}")).toBe(1);
    expect(countPlaceholders("no variables here")).toBe(0);
    expect(countPlaceholders("{{1}} then {{1}} again")).toBe(1);
  });
});

describe("describeTemplateShape", () => {
  it("reads the live template's shape", () => {
    expect(describeTemplateShape(approvedTemplate() as any)).toEqual({
      bodyParameterCount: 2,
      buttonParameterCount: 1,
      hasButtons: true,
      buttonType: "URL",
    });
  });
});

describe("assertTemplateMatchesContract", () => {
  beforeEach(() => {
    delete process.env.WHATSAPP_OTP_TEMPLATE_HAS_BUTTON;
  });

  it("accepts the currently approved template", () => {
    expect(() => assertTemplateMatchesContract(approvedTemplate() as any)).not.toThrow();
  });

  it("rejects a template edited down to one body variable", () => {
    const drifted = approvedTemplate();
    drifted.components[0].text = "{{1}} is your verification code.";

    expect(() => assertTemplateMatchesContract(drifted as any)).toThrow(WhatsAppConfigError);
    expect(() => assertTemplateMatchesContract(drifted as any)).toThrow(/body takes 1 parameter/);
  });

  it("rejects a template edited to add a third body variable", () => {
    const drifted = approvedTemplate();
    drifted.components[0].text = "{{1}} for {{2}} at {{3}}";

    expect(() => assertTemplateMatchesContract(drifted as any)).toThrow(/body takes 3 parameter/);
  });

  it("rejects a template whose button was removed", () => {
    const drifted = approvedTemplate();
    drifted.components = drifted.components.filter((c: any) => c.type !== "BUTTONS");

    expect(() => assertTemplateMatchesContract(drifted as any)).toThrow(/has no button/);
  });

  it("rejects a button that stopped carrying the code", () => {
    const drifted = approvedTemplate();
    (drifted.components[2] as any).buttons[0].url = "https://example.com/no-variable";

    expect(() => assertTemplateMatchesContract(drifted as any)).toThrow(/button takes 0 parameter/);
  });

  it("rejects a template that is no longer approved", () => {
    const drifted = approvedTemplate();
    drifted.status = "PAUSED";

    expect(() => assertTemplateMatchesContract(drifted as any)).toThrow(/status is PAUSED/);
  });

  it("flags the button flag contradicting the template", () => {
    process.env.WHATSAPP_OTP_TEMPLATE_HAS_BUTTON = "false";

    expect(() => assertTemplateMatchesContract(approvedTemplate() as any)).toThrow(
      /WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=false/
    );
  });

  it("names the template and the remedy so the error is actionable", () => {
    const drifted = approvedTemplate();
    drifted.components[0].text = "{{1}} only";

    expect(() => assertTemplateMatchesContract(drifted as any)).toThrow(/"otp" \(en_US\)/);
    expect(() => assertTemplateMatchesContract(drifted as any)).toThrow(/#132000/);
  });
});

describe("checkOtpTemplateContract", () => {
  let fetchSpy: any;

  beforeEach(() => {
    resetOtpTemplateContractCache();
    fetchSpy = vi.spyOn(global, "fetch");
    process.env.WHATSAPP_OTP_TEMPLATE = "otp";
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "waba-1";
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    delete process.env.WHATSAPP_OTP_TEMPLATE_HAS_BUTTON;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies against the live definition", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [approvedTemplate()] }),
    } as Response);

    const result = await checkOtpTemplateContract();

    expect(result).toMatchObject({ status: "OK", templateName: "otp" });
  });

  it("throws on drift — the whole point", async () => {
    const drifted = approvedTemplate();
    drifted.components[0].text = "{{1}} only";
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [drifted] }) } as Response);

    await expect(checkOtpTemplateContract()).rejects.toBeInstanceOf(WhatsAppConfigError);
  });

  it("throws when the template has been deleted or renamed", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) } as Response);

    await expect(checkOtpTemplateContract()).rejects.toThrow(/was not found on WABA/);
  });

  it("does NOT throw when the Graph API is unreachable — an outage is not drift", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("socket hang up"));

    await expect(checkOtpTemplateContract()).resolves.toMatchObject({ status: "UNVERIFIED" });
  });

  it("does NOT throw when Meta returns an API error", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: "Invalid OAuth access token" } }),
    } as Response);

    await expect(checkOtpTemplateContract()).resolves.toMatchObject({ status: "UNVERIFIED" });
  });

  it("skips cleanly when template delivery is not configured", async () => {
    delete process.env.WHATSAPP_OTP_TEMPLATE;

    await expect(checkOtpTemplateContract()).resolves.toMatchObject({ status: "SKIPPED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips plain-text mode", async () => {
    process.env.WHATSAPP_OTP_TEMPLATE = "text";

    await expect(checkOtpTemplateContract()).resolves.toMatchObject({ status: "SKIPPED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("checks once per process, not per send", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: [approvedTemplate()] }) } as Response);

    await verifyOtpTemplateContractOnce();
    await verifyOtpTemplateContractOnce();
    await verifyOtpTemplateContractOnce();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure instead of caching it forever", async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [approvedTemplate()] }) } as Response);

    await verifyOtpTemplateContractOnce();
    resetOtpTemplateContractCache();
    await verifyOtpTemplateContractOnce();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
