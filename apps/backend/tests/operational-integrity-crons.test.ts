import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  createAuditRun: vi.fn(),
  createInvariantFailures: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
    migrationAuditRun: { create: mocks.createAuditRun },
    financialInvariantFailure: { createMany: mocks.createInvariantFailures },
  },
}));

vi.mock("../lib/services/event-log-service", () => ({
  eventLog: { log: mocks.logEvent },
}));

vi.mock("../lib/metrics", () => ({ incrementIntegrityMetric: vi.fn() }));

import { MigrationAuditService, migrationAuditService } from "../lib/services/migration-audit-service";
import { FinancialInvariantService } from "../lib/services/financial-invariant-service";

describe("operational integrity crons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAuditRun.mockResolvedValue({});
    mocks.createInvariantFailures.mockResolvedValue({ count: 1 });
    mocks.logEvent.mockResolvedValue(undefined);
  });

  it("stores the complete migration audit in Postgres without a filesystem path", async () => {
    const service = new MigrationAuditService();
    vi.spyOn(service, "detectOrphans").mockResolvedValue([]);
    vi.spyOn(service, "detectHostelDrift").mockResolvedValue([]);
    vi.spyOn(service, "verifyHistoricalAttribution").mockResolvedValue([]);
    vi.spyOn(service, "verifyHostelRollups").mockResolvedValue([]);
    vi.spyOn(service, "runDualReadValidation").mockResolvedValue([]);

    const result = await service.runFullAudit();

    expect(result.artifact_path).toMatch(/^database:\/\/migration_audit_runs\/[0-9a-f-]{36}$/);
    expect(mocks.createAuditRun).toHaveBeenCalledOnce();
    expect(mocks.createAuditRun.mock.calls[0][0].data).toMatchObject({
      artifact_path: result.artifact_path,
      artifact: {
        orphan_count: 0,
        mismatch_count: 0,
        unresolved_records: [],
      },
    });
  });

  it("excludes business expenses from the hostel-attribution rollup", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([
      {
        owner_id: "11111111-1111-1111-1111-111111111111",
        metric: "expenses",
        owner_total: 0,
        hostel_sum: 0,
        difference: 0,
      },
    ]);

    const result = await new MigrationAuditService().verifyHostelRollups();
    const sql = mocks.queryRawUnsafe.mock.calls[0][0] as string;

    expect(sql.match(/e\.expense_scope = 'HOSTEL'/g)).toHaveLength(2);
    expect(result[0]).toMatchObject({ metric: "expenses", is_valid: true });
  });

  it("supplies UUIDs when bulk-persisting invariant failures", async () => {
    const service = new FinancialInvariantService();
    vi.spyOn(service, "checkRelationalInvariants").mockResolvedValue([
      {
        invariant_type: "payment.hostel_id === obligation.hostel_id",
        severity: "CRITICAL",
        entity_type: "Payment",
        entity_id: "22222222-2222-2222-2222-222222222222",
        expected_value: "33333333-3333-3333-3333-333333333333",
        actual_value: "44444444-4444-4444-4444-444444444444",
      },
    ]);
    vi.spyOn(migrationAuditService, "verifyHostelRollups").mockResolvedValue([]);

    await service.runAll();

    const row = mocks.createInvariantFailures.mock.calls[0][0].data[0];
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.invariant_type).toBe("payment.hostel_id === obligation.hostel_id");
  });
});
