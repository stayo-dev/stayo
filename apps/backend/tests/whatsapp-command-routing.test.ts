import { describe, expect, it } from "vitest";
import { resolveCommandKey, buildHelpText } from "@/lib/services/notifications/whatsapp-webhook-event-service";

describe("resolveCommandKey", () => {
  it("matches an exact command, any casing or padding", () => {
    for (const body of ["DUES", "dues", "  Dues  ", "dUeS"]) {
      expect(resolveCommandKey(body), body).toBe("DUES");
    }
  });

  it("matches on the first word", () => {
    expect(resolveCommandKey("help me please")).toBe("HELP");
    expect(resolveCommandKey("PAY now")).toBe("PAY");
  });

  it("matches a command appearing later in the message — the reported 'test help' case", () => {
    expect(resolveCommandKey("test help")).toBe("HELP");
    expect(resolveCommandKey("please send my dues")).toBe("DUES");
  });

  it("strips punctuation around a command", () => {
    expect(resolveCommandKey("help!")).toBe("HELP");
    expect(resolveCommandKey("hi, dues?")).toBe("DUES");
  });

  it("prefers the leading word when the message opens with a command", () => {
    // "pay" leads, so honour it even though "dues" also appears.
    expect(resolveCommandKey("pay or dues?")).toBe("PAY");
    expect(resolveCommandKey("bal and status")).toBe("BAL");
  });

  it("refuses to guess when two commands appear and neither leads", () => {
    expect(resolveCommandKey("should I pay or check dues")).toBeNull();
    expect(resolveCommandKey("is my bal or status ready")).toBeNull();
  });

  it("still matches when the same command repeats", () => {
    expect(resolveCommandKey("dues dues")).toBe("DUES");
  });

  it("returns null for text with no command, so the caller can fall back", () => {
    for (const body of ["", "   ", "hello there", "when is rent due"]) {
      expect(resolveCommandKey(body), JSON.stringify(body)).toBeNull();
    }
  });

  it("does not match a command hidden inside a longer word", () => {
    expect(resolveCommandKey("payment")).toBeNull();
    expect(resolveCommandKey("helpful")).toBeNull();
  });
});

describe("buildHelpText", () => {
  it("lists every command for a resolved resident", () => {
    const text = buildHelpText({ residentName: "Rahul Kumar", residentRoom: "101" });
    expect(text).toContain("Rahul Kumar");
    for (const cmd of ["BAL", "DUES", "PAY", "STATUS", "SWITCH", "HELP"]) {
      expect(text).toContain(cmd);
    }
  });

  it("uses the current brand, not the retired hostel identity", () => {
    const text = buildHelpText(null);
    expect(text).toContain("Stayo");
    expect(text).not.toContain("Sri Adithya");
  });
});
