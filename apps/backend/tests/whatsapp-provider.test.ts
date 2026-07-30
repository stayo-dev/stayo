import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MetaWhatsAppProvider,
  normalizeWhatsAppPhone,
  validateWhatsAppConfiguration,
} from "@/lib/services/notifications/providers/whatsapp/meta-provider";
import { notificationService } from "@/lib/services/notification-service";
import { WhatsAppProviderError, WhatsAppValidationError } from "@/lib/services/notifications/providers/whatsapp/errors";

describe("WhatsApp Phone Normalization", () => {
  it("converts 10-digit number into Indian international format", () => {
    expect(normalizeWhatsAppPhone("7901070333")).toBe("917901070333");
  });

  it("strips leading 0 and converts to Indian international format", () => {
    expect(normalizeWhatsAppPhone("07901070333")).toBe("917901070333");
  });

  it("handles standard Indian E.164 without prefix", () => {
    expect(normalizeWhatsAppPhone("+917901070333")).toBe("917901070333");
    expect(normalizeWhatsAppPhone("917901070333")).toBe("917901070333");
  });

  it("accepts valid international numbers", () => {
    expect(normalizeWhatsAppPhone("+14155552671")).toBe("14155552671");
  });

  it("rejects invalid numbers", () => {
    expect(() => normalizeWhatsAppPhone("")).toThrow(WhatsAppValidationError);
    expect(() => normalizeWhatsAppPhone("123")).toThrow(WhatsAppValidationError);
    expect(() => normalizeWhatsAppPhone("abcdefgh")).toThrow(WhatsAppValidationError);
  });
});

describe("WhatsApp Startup Validation & Config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("crashes startup if OTP_PROVIDER=whatsapp and required vars are missing", () => {
    process.env.OTP_PROVIDER = "whatsapp";
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    delete process.env.WHATSAPP_OTP_TEMPLATE;

    expect(() => validateWhatsAppConfiguration()).toThrow("CRITICAL CONFIGURATION ERROR");
  });

  it("passes startup check if all required variables are set", () => {
    process.env.OTP_PROVIDER = "whatsapp";
    process.env.WHATSAPP_TOKEN = "token";
    process.env.PHONE_NUMBER_ID = "phone_id";
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "biz_id";
    process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";

    expect(() => validateWhatsAppConfiguration()).not.toThrow();
  });

  it("does not crash if OTP_PROVIDER=email even if credentials are missing", () => {
    process.env.OTP_PROVIDER = "email";
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;

    expect(() => validateWhatsAppConfiguration()).not.toThrow();
  });
});

describe("MetaWhatsAppProvider OTP Send & HTTP Mocking", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";
  });

  it("sends interactive reply buttons", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: "wamid.button" }] }),
      status: 200,
    } as Response);

    const provider = new MetaWhatsAppProvider({
      accessToken: "mock_token",
      phoneNumberId: "mock_phone_id",
      baseUrl: "https://graph.facebook.com/v19.0",
      timeoutMs: 1000,
      maxRetries: 0,
    });

    const result = await provider.sendButtonMessage("7901070333", "Tenant card", [
      { id: "TENANT_PAYMENTS:00000000-0000-0000-0000-000000000001", title: "Payments" },
      { id: "TENANT_DUES:00000000-0000-0000-0000-000000000001", title: "Dues" },
    ]);

    expect(result.providerMessageId).toBe("wamid.button");
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.type).toBe("interactive");
    expect(body.interactive.type).toBe("button");
    expect(body.interactive.action.buttons).toHaveLength(2);
    expect(body.interactive.action.buttons[0].reply.id).toContain("TENANT_PAYMENTS");
  });

  it("sends interactive list rows", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: "wamid.list" }] }),
      status: 200,
    } as Response);

    const provider = new MetaWhatsAppProvider({
      accessToken: "mock_token",
      phoneNumberId: "mock_phone_id",
      baseUrl: "https://graph.facebook.com/v19.0",
      timeoutMs: 1000,
      maxRetries: 0,
    });

    const result = await provider.sendListMessage("7901070333", "Found matches", [{
      title: "Matches",
      rows: [
        {
          id: "TENANT_CARD:00000000-0000-0000-0000-000000000001",
          title: "Rahul Kumar",
          description: "Active · Room G1",
        },
      ],
    }]);

    expect(result.providerMessageId).toBe("wamid.list");
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.type).toBe("interactive");
    expect(body.interactive.type).toBe("list");
    expect(body.interactive.action.sections[0].rows[0].id).toContain("TENANT_CARD");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits the correct payload to Meta API and returns success", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        messaging_product: "whatsapp",
        contacts: [{ input: "917901070333", wa_id: "917901070333" }],
        messages: [{ id: "wamid.HBgLOTExMTExMTExMTEVAgIGABgD" }]
      }),
      status: 200,
    } as Response);

    const provider = new MetaWhatsAppProvider({
      accessToken: "mock_token",
      phoneNumberId: "mock_phone_id",
      baseUrl: "https://graph.facebook.com/v19.0",
      timeoutMs: 1000,
      maxRetries: 0,
    });

    const result = await provider.sendOtp({
      to: "7901070333",
      otp: "123456",
      purpose: "Login",
    });

    expect(result.providerMessageId).toBe("wamid.HBgLOTExMTExMTExMTEVAgIGABgD");
    expect(result.attempts).toBe(1);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v19.0/mock_phone_id/messages");
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init?.body as string);
    expect(body.to).toBe("917901070333");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("otp_phone");
    expect(body.template.components).toHaveLength(2);
    expect(body.template.components[0]).toEqual({
      type: "body",
      parameters: [
        { type: "text", text: "123456" },
        { type: "text", text: "Login" },
      ],
    });
    expect(body.template.components[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [
        { type: "text", text: "123456" },
      ],
    });
  });

  it("retries on retryable status codes (e.g., 429) and eventually fails or succeeds", async () => {
    // Fail first with 429, then succeed
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ error: { message: "Rate limit hit", code: 429 } }),
        status: 429,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ messages: [{ id: "wamid.success" }] }),
        status: 200,
      } as Response);

    const provider = new MetaWhatsAppProvider({
      accessToken: "mock_token",
      phoneNumberId: "mock_phone_id",
      baseUrl: "https://graph.facebook.com/v19.0",
      timeoutMs: 1000,
      maxRetries: 1,
    });

    const result = await provider.sendOtp({
      to: "7901070333",
      otp: "123456",
      purpose: "Registration",
    });

    expect(result.providerMessageId).toBe("wamid.success");
    expect(result.attempts).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws WhatsAppProviderError if max retries are exceeded", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: { message: "Internal server error", code: 500 } }),
      status: 500,
    } as Response);

    const provider = new MetaWhatsAppProvider({
      accessToken: "mock_token",
      phoneNumberId: "mock_phone_id",
      baseUrl: "https://graph.facebook.com/v19.0",
      timeoutMs: 1000,
      maxRetries: 1,
    });

    await expect(
      provider.sendOtp({
        to: "7901070333",
        otp: "123456",
        purpose: "Login",
      })
    ).rejects.toThrow(WhatsAppProviderError);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // Initial attempt + 1 retry
  });
});

describe("NotificationService Routing", () => {
  it("routes sendOtp to whatsapp when OTP_PROVIDER=whatsapp", async () => {
    const originalProvider = process.env.OTP_PROVIDER;
    process.env.OTP_PROVIDER = "whatsapp";
    process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";

    const sendOtpSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendOtp").mockResolvedValueOnce({
      providerMessageId: "wamid.routed",
      raw: {},
      attempts: 1,
    });

    const result = await notificationService.sendOtp({
      phone: "7901070333",
      otp: "123456",
      purpose: "Login",
    });

    expect(sendOtpSpy).toHaveBeenCalledWith({
      to: "7901070333",
      otp: "123456",
      purpose: "Login",
    });
    expect(result.providerMessageId).toBe("wamid.routed");

    sendOtpSpy.mockRestore();
    process.env.OTP_PROVIDER = originalProvider;
  });

  it("throws on unsupported SMS/Email providers", async () => {
    const originalProvider = process.env.OTP_PROVIDER;
    process.env.OTP_PROVIDER = "sms";

    await expect(
      notificationService.sendOtp({
        phone: "7901070333",
        otp: "123456",
        purpose: "Login",
      })
    ).rejects.toThrow("CRITICAL CONFIGURATION ERROR");

    process.env.OTP_PROVIDER = originalProvider;
  });
});

describe("MetaWhatsAppProvider sendInvitation", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits the correct invitation template parameters to Meta API and returns success", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({
        messaging_product: "whatsapp",
        contacts: [{ input: "917901070333", wa_id: "917901070333" }],
        messages: [{ id: "wamid.invitation_test" }]
      }),
      status: 200,
    } as Response);

    const provider = new MetaWhatsAppProvider({
      accessToken: "mock_token",
      phoneNumberId: "mock_phone_id",
      baseUrl: "https://graph.facebook.com/v19.0",
      timeoutMs: 1000,
      maxRetries: 0,
    });

    const result = await provider.sendInvitation({
      to: "7901070333",
      tenantName: "John Doe",
      ownerName: "Owner Name",
      hostelName: "Hostel Name",
      roomNumber: "101",
      roomRent: 5000,
      activationLink: "http://localhost/activate/invite-token-123",
    });

    expect(result.providerMessageId).toBe("wamid.invitation_test");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.to).toBe("917901070333");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("tenant_account_activation_v2");
    expect(body.template.language.code).toBe("en_IN");
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "John Doe" },
      { type: "text", text: "Owner Name" },
      { type: "text", text: "101" },
      { type: "text", text: "5000" },
    ]);
    expect(body.template.components[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "invite-token-123" }],
    });
  });
});
