import { describe, it, expect } from "vitest";
import { shouldPush, pushLinkFor } from "@/src/services/notifications/push/push-policy";

describe("shouldPush", () => {
  it("pushes the money and commitment events", () => {
    for (const t of ["rent_reminder", "payment", "announcement", "service_request",
                     "agreement_lifecycle", "renewal_offer", "move_out_dispute",
                     "tenancy_claim", "food_poll_opened", "food_voting_opened",
                     "lead", "marketing", "document_rejected",
                     "payout_collected", "payout_sent", "payout_paid", "payout_failed"]) {
      expect(shouldPush(t), t).toBe(true);
    }
  });

  it("does not push routine good news or internal plumbing", () => {
    for (const t of ["food_schedule_published", "info",
                     "platform_broadcast", "tenant_analytics",
                     // Briefings are WhatsApp-only and never reach createNotification.
                     "daily_briefing"]) {
      expect(shouldPush(t), t).toBe(false);
    }
  });

  it("defaults an unknown type to NO push, so a new type cannot silently acquire one", () => {
    expect(shouldPush("some_type_invented_next_month")).toBe(false);
  });

  it("matches case-insensitively, because createNotification lowercases the type", () => {
    expect(shouldPush("ANNOUNCEMENT")).toBe(true);
  });
});

describe("pushLinkFor", () => {
  it("deep-links a tenant rent reminder to the money tab", () => {
    expect(pushLinkFor("rent_reminder")).toBe("/tenant/money");
  });

  it("deep-links an owner lead to the alerts screen", () => {
    expect(pushLinkFor("lead")).toBe("/owner/alerts");
  });

  it("deep-links every payout stage to the money screen", () => {
    for (const t of ["payout_collected", "payout_sent", "payout_paid", "payout_failed"]) {
      expect(pushLinkFor(t), t).toBe("/owner/money");
    }
  });

  it("falls back to the notifications list for a type with no specific home", () => {
    expect(pushLinkFor("unmapped_type")).toBe("/tenant/notifications");
  });
});
