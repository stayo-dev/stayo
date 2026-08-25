import { describe, expect, it } from "vitest";
import {
  INVITATION_EXPIRY_REMINDER_TEMPLATE,
  activationTokenFrom,
  buildInvitationExpiryReminderPayload,
  hoursRemaining,
} from "@/lib/services/notifications/providers/whatsapp/invitation-expiry-reminder-contract";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const TOKEN = "d86e7e3ff592cdc061e1669717c6862f135f964b59951926d4eaac58719d3904";
const LINK = `https://yourstayo.com/activate/${TOKEN}`;

describe("the button parameter is the token, not the link", () => {
  // Meta stores the `/activate/` base and appends what we send. Sending a full
  // URL produces a doubled path and a dead button — the same rule the approved
  // invitation template already follows.
  it("extracts the token from a full activation link", () => {
    expect(activationTokenFrom(LINK)).toBe(TOKEN);
  });

  it("passes a bare token through unchanged", () => {
    expect(activationTokenFrom(TOKEN)).toBe(TOKEN);
  });

  it("ignores a query string", () => {
    expect(activationTokenFrom(`${LINK}?utm_source=whatsapp`)).toBe(TOKEN);
  });

  it("returns empty for empty input rather than a stray slash", () => {
    expect(activationTokenFrom("")).toBe("");
  });
});

describe("hours remaining", () => {
  it("floors, so the number is a promise we can keep", () => {
    // 23h59m must read as 23, not 24 — rounding up overstates the window.
    expect(hoursRemaining(new Date("2026-08-26T11:59:00.000Z"), NOW)).toBe(23);
    expect(hoursRemaining(new Date("2026-08-26T12:00:00.000Z"), NOW)).toBe(24);
  });

  // "Expires in 0 hours" on a link that still works reads as already dead. The
  // reminder exists to get someone moving, not to tell them they are too late.
  it("never says zero while the link still works", () => {
    expect(hoursRemaining(new Date("2026-08-25T12:20:00.000Z"), NOW)).toBe(1);
  });

  it("does not go negative for an already-expired link", () => {
    expect(hoursRemaining(new Date("2026-08-25T09:00:00.000Z"), NOW)).toBe(1);
  });
});

describe("the payload", () => {
  const payload = buildInvitationExpiryReminderPayload({
    tenantName: "Shiva",
    hostelName: "Sri Adithya Boys Hostel",
    activationLink: LINK,
    expiresAt: new Date("2026-08-26T12:00:00.000Z"),
    now: NOW,
  });

  it("fills exactly the three body variables the template declares", () => {
    const body = payload.components.find((c) => c.type === "body");
    expect(body?.parameters).toEqual([
      { type: "text", text: "Shiva" },
      { type: "text", text: "Sri Adithya Boys Hostel" },
      { type: "text", text: "24" },
    ]);
    // A mismatch here is Meta error #132000 on every send.
    expect(body?.parameters).toHaveLength(INVITATION_EXPIRY_REMINDER_TEMPLATE.bodyParameters.length);
  });

  it("sends one url button parameter at index 0", () => {
    const button = payload.components.find((c) => c.type === "button");
    expect(button).toMatchObject({ sub_type: "url", index: "0" });
    expect(button?.parameters).toEqual([{ type: "text", text: TOKEN }]);
    expect(button?.parameters).toHaveLength(INVITATION_EXPIRY_REMINDER_TEMPLATE.buttonParameters.length);
  });

  it("falls back rather than sending an empty greeting", () => {
    const fallback = buildInvitationExpiryReminderPayload({
      tenantName: "  ",
      hostelName: "",
      activationLink: LINK,
      expiresAt: new Date("2026-08-26T12:00:00.000Z"),
      now: NOW,
    });
    const body = fallback.components.find((c) => c.type === "body");
    expect(body?.parameters?.[0]).toEqual({ type: "text", text: "there" });
    expect(body?.parameters?.[1]).toEqual({ type: "text", text: "your hostel" });
  });
});
