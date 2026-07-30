import {
  activationFinancialStatusService,
  type ActivationFinancialStatus,
} from "./activation-financial-status-service";

export type ActivationFinancialErrorCode =
  | "DEPOSIT_OUTSTANDING"
  | "MAINTENANCE_OUTSTANDING"
  | "ONBOARDING_FINANCIALS_INCOMPLETE";

export class ActivationFinancialEnforcementError extends Error {
  code: ActivationFinancialErrorCode;
  status = 409;
  details: any;

  constructor(code: ActivationFinancialErrorCode, message: string, details: any) {
    super(message);
    this.name = "ActivationFinancialEnforcementError";
    this.code = code;
    this.details = details;
  }
}

export class ActivationFinancialEnforcementService {
  async assertActivationFinancialReady(tenantId: string): Promise<ActivationFinancialStatus> {
    const status = await activationFinancialStatusService.getActivationFinancialStatus(tenantId);
    const hasDepositOutstanding = status.depositOutstanding > 0;
    const hasMaintenanceOutstanding = status.maintenanceOutstanding > 0;

    if (hasDepositOutstanding && hasMaintenanceOutstanding) {
      throw new ActivationFinancialEnforcementError(
        "ONBOARDING_FINANCIALS_INCOMPLETE",
        "Security deposit and maintenance must be cleared before activation",
        status
      );
    }

    if (hasDepositOutstanding) {
      throw new ActivationFinancialEnforcementError(
        "DEPOSIT_OUTSTANDING",
        "Security deposit must be cleared before activation",
        {
          requiredDeposit: status.requiredDeposit,
          paidDeposit: status.paidDeposit,
          outstandingDeposit: status.depositOutstanding,
        }
      );
    }

    if (hasMaintenanceOutstanding) {
      throw new ActivationFinancialEnforcementError(
        "MAINTENANCE_OUTSTANDING",
        "Maintenance must be cleared before activation",
        {
          requiredMaintenance: status.requiredMaintenance,
          paidMaintenance: status.paidMaintenance,
          outstandingMaintenance: status.maintenanceOutstanding,
        }
      );
    }

    return status;
  }
}

export const activationFinancialEnforcementService = new ActivationFinancialEnforcementService();

export function assertActivationFinancialReady(tenantId: string) {
  return activationFinancialEnforcementService.assertActivationFinancialReady(tenantId);
}
