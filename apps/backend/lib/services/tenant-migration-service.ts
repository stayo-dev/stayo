/**
 * 🚫 DEPRECATED — Legacy Tenant Migration Service
 *
 * This service previously contained bulk import logic that directly created
 * ACTIVE tenant profiles. It was disabled and replaced by the
 * TenantInvitationLifecycleService, which enforces invitation-based onboarding.
 *
 * Dead code has been removed as part of the authentication hardening audit.
 * All tenant creation MUST go through the invitation lifecycle.
 *
 * @see TenantInvitationLifecycleService
 */

import { getLogger } from "../logger";

const logger = getLogger("tenant-migration-service");

export interface ImportResult {
  success: boolean;
  tenantId?: string;
  profileId?: string;
  allocationId?: string;
  error?: string;
  row: number;
}

export interface BulkImportResult {
  batchId: string;
  totalRequested: number;
  successCount: number;
  failureCount: number;
  results: ImportResult[];
  errors: string[];
}

export class TenantMigrationService {
  async createMigrationTenant(
    _data: any,
    _ownerId: string,
    _hostelId: string,
    _batchId: string,
    _rowNumber: number
  ): Promise<ImportResult> {
    logger.error("LEGACY_IMPORT_DISABLED: createMigrationTenant called — this method is permanently disabled");
    throw new Error("LEGACY_IMPORT_DISABLED: Legacy ACTIVE tenant migration is permanently disabled. Use the bulk invitation lifecycle instead.");
  }

  async bulkImportTenants(
    _validRows: any[],
    _ownerId: string,
    _hostelId: string,
    _batchId: string
  ): Promise<BulkImportResult> {
    logger.error("LEGACY_IMPORT_DISABLED: bulkImportTenants called — this method is permanently disabled");
    throw new Error("LEGACY_IMPORT_DISABLED: Legacy ACTIVE tenant migration is permanently disabled. Use the bulk invitation lifecycle instead.");
  }
}

export const tenantMigrationService = new TenantMigrationService();
