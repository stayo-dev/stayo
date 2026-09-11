import { describe, expect, it, vi } from "vitest";

// Pure: the resolver module imports the client, and nothing here queries it.
vi.mock("@/lib/db", () => ({ prisma: {} }));
import {
  isPlaceholderEmail,
  realEmailOrNull,
  resolveActivationEmail,
} from "@/src/services/tenants/invited-profile-resolver";

/**
 * `<phone>@hms.temp` fills a NOT NULL, unique `profiles.email` for a tenant
 * invited by phone alone. An owner saw `+918008046952@hms.temp` on the
 * invitation screen as though it were the tenant's address. It is a storage
 * key: never shown, never sent to.
 */
describe("the placeholder address", () => {
  it("is what an invite by phone alone gets", () => {
    const email = resolveActivationEmail({ profile: null, invitation: null, phone: "+918008046952" });

    expect(email).toBe("+918008046952@hms.temp");
    expect(isPlaceholderEmail(email)).toBe(true);
  });

  it.each(["+918008046952@hms.temp", " +91800@HMS.TEMP "])("is recognised in any case: %s", (email) => {
    expect(isPlaceholderEmail(email)).toBe(true);
  });

  it.each(["ravi@gmail.com", "hms.temp@gmail.com", "", null, undefined, 42])("is not mistaken for %s", (email) => {
    expect(isPlaceholderEmail(email)).toBe(false);
  });

  it("reads as no email at all", () => {
    expect(realEmailOrNull("+918008046952@hms.temp")).toBeNull();
    expect(realEmailOrNull("")).toBeNull();
    expect(realEmailOrNull(null)).toBeNull();
  });

  it("leaves a real address alone", () => {
    expect(realEmailOrNull(" ravi@gmail.com ")).toBe("ravi@gmail.com");
  });
});

describe("what owner screens are given", () => {
  const read = (file: string) =>
    require("fs").readFileSync(require("path").join(__dirname, "..", file), "utf8") as string;

  /**
   * The overview behind the invitation screen in the owner's report. A
   * source guard, because reaching it for real needs the whole tenancy graph;
   * without it, dropping the mask would leave every other test green.
   */
  it("the tenant overview never returns the placeholder as the email", () => {
    expect(read("src/services/tenants/tenant-service.ts")).toContain(
      "email: realEmailOrNull(legacyTenant.profile?.email)"
    );
  });
});
