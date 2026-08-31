import { describe, it, expect } from "vitest";
import { withinSendWindow } from "@/src/services/notifications/push/send-window";

/** IST is UTC+5:30, so 08:00 IST is 02:30 UTC and 21:00 IST is 15:30 UTC. */
describe("withinSendWindow", () => {
  it("allows a mid-morning IST send", () => {
    expect(withinSendWindow(new Date("2026-08-30T05:00:00.000Z"))).toBe(true); // 10:30 IST
  });

  it("blocks the middle of the night in IST", () => {
    expect(withinSendWindow(new Date("2026-08-30T21:00:00.000Z"))).toBe(false); // 02:30 IST
  });

  it("allows exactly the opening boundary", () => {
    expect(withinSendWindow(new Date("2026-08-30T02:30:00.000Z"))).toBe(true); // 08:00 IST
  });

  it("blocks one minute before opening", () => {
    expect(withinSendWindow(new Date("2026-08-30T02:29:00.000Z"))).toBe(false); // 07:59 IST
  });

  it("blocks exactly the closing boundary, so 21:00 IST is already quiet", () => {
    expect(withinSendWindow(new Date("2026-08-30T15:30:00.000Z"))).toBe(false); // 21:00 IST
  });

  it("allows one minute before closing", () => {
    expect(withinSendWindow(new Date("2026-08-30T15:29:00.000Z"))).toBe(true); // 20:59 IST
  });

  it("handles a UTC evening that is already the next IST morning", () => {
    expect(withinSendWindow(new Date("2026-08-30T19:00:00.000Z"))).toBe(false); // 00:30 IST
  });
});
