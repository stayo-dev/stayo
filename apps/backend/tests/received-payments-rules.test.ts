import { describe, it, expect } from "vitest";
import {
  parseReceivedQuery,
  likePattern,
  toReceivedPayment,
  RECEIVED_PAGE_DEFAULT,
  RECEIVED_PAGE_MAX,
} from "@/src/services/payments/received-payments-rules";

const q = (s: string) => parseReceivedQuery(new URLSearchParams(s));
const HOSTEL = "11111111-2222-3333-4444-555555555555";

describe("parseReceivedQuery", () => {
  it("defaults to every hostel, no dates, first page", () => {
    expect(q("")).toEqual({
      hostelId: null,
      from: null,
      to: null,
      method: null,
      search: null,
      limit: RECEIVED_PAGE_DEFAULT,
      offset: 0,
    });
  });

  it("treats hostelId=all as no hostel filter", () => {
    expect(q("hostelId=all").hostelId).toBeNull();
  });

  it("accepts a uuid hostel and rejects anything else", () => {
    expect(q(`hostelId=${HOSTEL}`).hostelId).toBe(HOSTEL);
    expect(() => q("hostelId=business")).toThrow(/VALIDATION/);
  });

  it("rejects malformed and impossible dates, and reversed ranges", () => {
    expect(() => q("from=2026-13-01")).toThrow(/VALIDATION/);
    expect(() => q("to=2026-02-30")).toThrow(/VALIDATION/);
    expect(() => q("from=10/01/2026")).toThrow(/VALIDATION/);
    expect(() => q("from=2026-10-05&to=2026-10-01")).toThrow(/after/);
    expect(q("from=2026-10-01&to=2026-10-01")).toMatchObject({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("normalises method case and rejects unknown methods", () => {
    expect(q("method=upi").method).toBe("UPI");
    expect(q("method=ALL").method).toBeNull();
    expect(() => q("method=bitcoin")).toThrow(/VALIDATION/);
  });

  it("trims the search and drops it when blank", () => {
    expect(q("q=%20%20harsha%20").search).toBe("harsha");
    expect(q("q=%20%20").search).toBeNull();
  });

  it("caps the page size and ignores junk paging", () => {
    expect(q("limit=500").limit).toBe(RECEIVED_PAGE_MAX);
    expect(q("limit=-3&offset=abc")).toMatchObject({ limit: RECEIVED_PAGE_DEFAULT, offset: 0 });
    expect(q("limit=10&offset=40")).toMatchObject({ limit: 10, offset: 40 });
  });
});

describe("likePattern", () => {
  it("escapes LIKE wildcards", () => {
    expect(likePattern("a%b_c\\")).toBe("%a\\%b\\_c\\\\%");
  });
});

describe("toReceivedPayment", () => {
  const base = {
    key: "g1",
    tenant_id: "t1",
    tenant_name: "  Harsha ",
    room_no: "204",
    hostel_id: HOSTEL,
    hostel_name: "Sri Adithya Boys Hostel",
    method: "cash",
    reference: null,
    paid_on: new Date("2026-10-05T00:00:00.000Z"),
    recorded_at: "2026-10-05T09:12:00.000Z",
    amount: "16000.00",
    reversed_amount: "0",
    covers: [
      { type: "SECURITY_DEPOSIT", rent_month: null, label: null, amount: "2000", reversed: false },
      { type: "RENT", rent_month: "2026-10-01", label: null, amount: "7000", reversed: false },
      { type: "RENT", rent_month: "2026-09-01", label: null, amount: "7000.00", reversed: false },
    ],
  };

  it("shapes one collection, months oldest first and one-offs last", () => {
    const p = toReceivedPayment(base);
    expect(p).toMatchObject({
      id: "g1",
      tenantName: "Harsha",
      room: "204",
      method: "CASH",
      paidOn: "2026-10-05",
      recordedAt: "2026-10-05T09:12:00.000Z",
      amount: 16000,
      reversedAmount: 0,
    });
    expect(p.covers.map((c) => c.month ?? c.type)).toEqual(["2026-09", "2026-10", "SECURITY_DEPOSIT"]);
  });

  it("survives missing names, methods and covers", () => {
    const p = toReceivedPayment({ ...base, tenant_name: null, method: null, room_no: null, covers: null });
    expect(p.tenantName).toBe("Tenant");
    expect(p.method).toBe("OTHER");
    expect(p.room).toBeNull();
    expect(p.covers).toEqual([]);
  });
});
