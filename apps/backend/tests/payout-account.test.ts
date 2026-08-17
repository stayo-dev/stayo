import { describe, it, expect } from "vitest";
import { validatePayoutAccount } from "@/src/services/settlements/payout-account";

const valid = {
  holder_name: "Sri Adithya Hostels",
  account_no: "50100443777341",
  account_no_confirm: "50100443777341",
  ifsc: "HDFC0001204",
  bank_name: "HDFC Bank",
};

describe("validatePayoutAccount", () => {
  it("accepts a complete account", () => {
    expect(validatePayoutAccount(valid).ok).toBe(true);
  });

  /**
   * The confirm field is the whole point. A mistyped account number sends rent
   * to a stranger and is unrecoverable — there is no undo on an IMPS transfer.
   */
  it("refuses when the two account numbers differ", () => {
    const result = validatePayoutAccount({ ...valid, account_no_confirm: "50100443777342" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/do not match/i);
  });

  it("ignores spaces when comparing, since people group digits as they read them", () => {
    expect(validatePayoutAccount({
      ...valid, account_no: "5010 0443 7773 41", account_no_confirm: "50100443777341",
    }).ok).toBe(true);
  });

  it("stores the account number without spaces", () => {
    const result = validatePayoutAccount({ ...valid, account_no: "5010 0443 7773 41" });
    if (result.ok) expect(result.account_no).toBe("50100443777341");
  });

  it("refuses a non-numeric account number", () => {
    expect(validatePayoutAccount({ ...valid, account_no: "ABC123", account_no_confirm: "ABC123" }).ok).toBe(false);
  });

  it("validates IFSC shape — 4 letters, 0, then 6 alphanumerics", () => {
    expect(validatePayoutAccount({ ...valid, ifsc: "HDFC0001204" }).ok).toBe(true);
    expect(validatePayoutAccount({ ...valid, ifsc: "HDFC1001204" }).ok).toBe(false);
    expect(validatePayoutAccount({ ...valid, ifsc: "HDF0001204" }).ok).toBe(false);
    expect(validatePayoutAccount({ ...valid, ifsc: "not-an-ifsc" }).ok).toBe(false);
  });

  it("uppercases IFSC, since banks print it either way", () => {
    const result = validatePayoutAccount({ ...valid, ifsc: "hdfc0001204" });
    if (result.ok) expect(result.ifsc).toBe("HDFC0001204");
  });

  it("requires a holder name — a transfer needs someone to land on", () => {
    expect(validatePayoutAccount({ ...valid, holder_name: "  " }).ok).toBe(false);
  });

  it("refuses an implausibly short account number", () => {
    expect(validatePayoutAccount({ ...valid, account_no: "123", account_no_confirm: "123" }).ok).toBe(false);
  });
});
