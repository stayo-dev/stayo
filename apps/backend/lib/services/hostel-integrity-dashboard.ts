import { financialInvariantService } from "./financial-invariant-service";
import { migrationAuditService } from "./migration-audit-service";

export class HostelIntegrityDashboard {
  async getMetrics(options: { refreshDualRead?: boolean } = {}) {
    const [health, dualRead] = await Promise.all([
      financialInvariantService.getOperationalHealthMetrics(),
      options.refreshDualRead ? migrationAuditService.runDualReadValidation() : Promise.resolve(null),
    ]);

    const dualReadMismatchCount = dualRead?.reduce((sum, item) => sum + item.mismatch_count, 0) ?? null;

    return {
      ...health,
      mismatch_count: dualReadMismatchCount ?? health.mismatch_count,
      dual_read_validation: dualRead,
      operational_health_metrics: {
        integrity_score: health.hostel_integrity_score,
        reconciliation_health: health.reconciliation_health,
        migration_cleanliness: health.migration_cleanliness,
        hostel_isolation_health: health.hostel_isolation_health,
      },
    };
  }
}

export const hostelIntegrityDashboard = new HostelIntegrityDashboard();
