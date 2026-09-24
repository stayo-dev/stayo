import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Collections and Finance exports must survive migration 075 being unapplied.
 *
 * `gateway_transactions.tenant_id` is deliberately absent from schema.prisma
 * (migration 075's own header says so), which means production may not have the
 * column at all — and it does not: the 2026-09-14 catalogue audit found 075
 * unapplied on the canonical project. A read model that hard-joins that column
 * therefore throws 42703, the export route answers 500, and the owner's export
 * sheet sits on "Checking…" forever with no file and no reason.
 *
 * `items()` in this same file already guards `expected_payout_date` exactly this
 * way. `rentReceived` did not, and it is the one query BOTH money exports need.
 *
 * Pure: `@/lib/db` is mocked, so no client is constructed and nothing reaches a
 * database.
 */

const queryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: any[]) => queryRaw(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/services/collection-queue/collection-queue-service", () => ({
  collectionQueueService: { getQueue: vi.fn() },
}));

/** The error Postgres actually raises for a column that is not there. */
function undefinedColumn(name: string) {
  const err: any = new Error(`The column \`${name}\` does not exist in the current database.`);
  err.code = "P2022";
  err.meta = { column: name };
  return err;
}

/** The statement text, reassembled from the tagged-template strings. */
function statementOf(args: any[]): string {
  const strings = args[0];
  return Array.isArray(strings) ? strings.join(" ? ") : String(strings ?? "");
}

const PERIOD = { from: "2026-09-01", to: "2026-09-30" };
const OWNER = "11111111-1111-1111-1111-111111111111";

const DIRECT_ROW = {
  date: "2026-09-15",
  amount: 8500,
  method: "Cash",
  reference: "RCPT-1",
  tenant_name: "Md Sezan Hussain",
  hostel_name: "Sri Adithya Boys Hostel",
};

const GATEWAY_ROW = {
  date: "2026-09-17T06:00:00.000Z",
  amount: 17000,
  method: "Online",
  reference: "pay_abc123",
  tenant_name: "B Avinash Kumar",
  hostel_name: "Sri Adithya Boys Hostel",
};

async function loadReadModel() {
  const mod = await import("@/src/services/settlements/owner-payout-read-model");
  return mod.ownerPayoutReadModel;
}

beforeEach(() => {
  queryRaw.mockReset();
  vi.resetModules();
});

describe("rentReceived when migration 075 is unapplied", () => {
  it("still returns the rent, instead of failing the whole export", async () => {
    // Every statement naming `g.tenant_id` fails, exactly as Postgres would
    // when the column has never been added.
    queryRaw.mockImplementation((...args: any[]) => {
      const text = statementOf(args);
      if (text.includes("g.tenant_id")) return Promise.reject(undefinedColumn("tenant_id"));
      if (text.includes("gateway_transactions")) return Promise.resolve([GATEWAY_ROW]);
      return Promise.resolve([DIRECT_ROW]);
    });

    const readModel = await loadReadModel();
    const rows = await readModel.rentReceived(OWNER, PERIOD, null);

    // The money is what matters. Direct payments are untouched by the missing
    // column and must never be lost because of it.
    expect(rows.some((r) => r.amount === 8500)).toBe(true);
    expect(rows.every((r) => typeof r.amount === "number")).toBe(true);
  });

  it("keeps the gateway money, naming the payer only when it can", async () => {
    queryRaw.mockImplementation((...args: any[]) => {
      const text = statementOf(args);
      if (text.includes("g.tenant_id")) return Promise.reject(undefinedColumn("tenant_id"));
      if (text.includes("gateway_transactions")) {
        // The fallback cannot join tenants, so the payer is unnamed.
        return Promise.resolve([{ ...GATEWAY_ROW, tenant_name: "Unknown" }]);
      }
      return Promise.resolve([DIRECT_ROW]);
    });

    const readModel = await loadReadModel();
    const rows = await readModel.rentReceived(OWNER, PERIOD, null);

    const gateway = rows.filter((r) => r.source === "verified");
    expect(gateway).toHaveLength(1);
    expect(gateway[0].amount).toBe(17000);
    // An owner reconciling against a bank statement needs the amount and the
    // reference; a missing name is a degraded row, not a lost rupee.
    expect(gateway[0].reference).toBe("pay_abc123");
  });

  it("is unaffected when the column IS there", async () => {
    queryRaw.mockImplementation((...args: any[]) => {
      const text = statementOf(args);
      if (text.includes("gateway_transactions")) return Promise.resolve([GATEWAY_ROW]);
      return Promise.resolve([DIRECT_ROW]);
    });

    const readModel = await loadReadModel();
    const rows = await readModel.rentReceived(OWNER, PERIOD, null);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source === "verified")?.tenantName).toBe("B Avinash Kumar");
    expect(rows.find((r) => r.source === "owner_recorded")?.tenantName).toBe("Md Sezan Hussain");
  });
});
