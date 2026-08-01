import { prisma } from "../db";
import { eventLog } from "./event-log-service";

export type MaintenanceType = "MONTHLY" | "ONE_TIME" | "NONE";

export type BillingDefaults = {
  advance_deposit: number;
  security_deposit: number;
  maintenance_charge: number;
  maintenance_type: MaintenanceType;
  auto_fill_room_rent: boolean;
  allow_override: boolean;
  reservation_policy?: string;
  minimum_reservation_deposit?: number;
  deposit_calculation_mode: "FLAT" | "MONTHS_OF_RENT";
  deposit_months: number;
  agreement_duration_months: number;
};

export type TenantInviteDefaults = {
  room: {
    id: string;
    room_no: string;
    base_rent: number;
    hostel_id: string;
  };
  billing_defaults: BillingDefaults;
  resolved_values: {
    monthly_rent: number;
    advance_deposit: number;
    security_deposit: number;
    maintenance_charge: number;
    maintenance_type: MaintenanceType;
    reservation_policy?: string;
    minimum_reservation_deposit?: number;
    deposit_calculation_mode: "FLAT" | "MONTHS_OF_RENT";
    deposit_months: number;
    agreement_duration_months: number;
  };
};

const VALID_MAINTENANCE_TYPES = new Set<MaintenanceType>(["MONTHLY", "ONE_TIME", "NONE"]);

export const DEFAULT_BILLING_DEFAULTS: BillingDefaults = {
  advance_deposit: 0,
  security_deposit: 0,
  maintenance_charge: 0,
  maintenance_type: "MONTHLY",
  auto_fill_room_rent: true,
  allow_override: true,
  reservation_policy: "FULL_DEPOSIT",
  minimum_reservation_deposit: 0,
  deposit_calculation_mode: "FLAT",
  deposit_months: 1,
  agreement_duration_months: 12,
};

function nonNegativeNumber(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("VALIDATION: Billing default amounts must be non-negative numbers");
  }
  return parsed;
}

function maintenanceType(value: unknown, fallback: MaintenanceType): MaintenanceType {
  const normalized = String(value || fallback).toUpperCase();
  if (!VALID_MAINTENANCE_TYPES.has(normalized as MaintenanceType)) {
    throw new Error("VALIDATION: Invalid maintenance type");
  }
  return normalized as MaintenanceType;
}

const VALID_CALCULATION_MODES = new Set(["FLAT", "MONTHS_OF_RENT"]);

function calculationMode(value: unknown, fallback: "FLAT" | "MONTHS_OF_RENT"): "FLAT" | "MONTHS_OF_RENT" {
  const normalized = String(value || fallback).toUpperCase();
  if (!VALID_CALCULATION_MODES.has(normalized)) {
    return "FLAT";
  }
  return normalized as "FLAT" | "MONTHS_OF_RENT";
}

function asConfig(raw: unknown): Record<string, any> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
}

export function normalizeBillingDefaults(rawConfig: unknown): BillingDefaults {
  const config = asConfig(rawConfig);
  const nested = asConfig(config.billing_defaults);

  // Backward compatibility: legacy preferences lived as flat JSON keys.
  const advanceSource = nested.security_deposit ?? nested.advance_deposit ?? config.advance_amount_default;
  const maintenanceSource = nested.maintenance_charge ?? config.maintenance_amount_default;
  const maintenanceTypeSource = nested.maintenance_type ?? config.maintenance_type;

  const calculationModeSource = nested.deposit_calculation_mode ?? config.deposit_calculation_mode ?? "FLAT";
  const depositMonthsSource = nested.deposit_months ?? config.deposit_months ?? 1;
 
  return {
    advance_deposit: nonNegativeNumber(advanceSource, DEFAULT_BILLING_DEFAULTS.advance_deposit),
    security_deposit: nonNegativeNumber(advanceSource, DEFAULT_BILLING_DEFAULTS.security_deposit),
    maintenance_charge: nonNegativeNumber(maintenanceSource, DEFAULT_BILLING_DEFAULTS.maintenance_charge),
    maintenance_type: maintenanceType(maintenanceTypeSource, DEFAULT_BILLING_DEFAULTS.maintenance_type),
    auto_fill_room_rent: nested.auto_fill_room_rent !== undefined
      ? Boolean(nested.auto_fill_room_rent)
      : DEFAULT_BILLING_DEFAULTS.auto_fill_room_rent,
    allow_override: nested.allow_override !== undefined
      ? Boolean(nested.allow_override)
      : DEFAULT_BILLING_DEFAULTS.allow_override,
    reservation_policy: nested.reservation_policy ?? config.reservation_policy ?? "FULL_DEPOSIT",
    minimum_reservation_deposit: nonNegativeNumber(nested.minimum_reservation_deposit ?? config.minimum_reservation_deposit, 0),
    deposit_calculation_mode: calculationMode(calculationModeSource, DEFAULT_BILLING_DEFAULTS.deposit_calculation_mode),
    deposit_months: Math.max(1, Math.min(12, Math.floor(nonNegativeNumber(depositMonthsSource, DEFAULT_BILLING_DEFAULTS.deposit_months)))),
    agreement_duration_months: Math.max(1, Math.min(120, Math.floor(nonNegativeNumber(nested.agreement_duration_months ?? config.agreement_duration_months, DEFAULT_BILLING_DEFAULTS.agreement_duration_months)))),
  };
}

/**
 * Exported so callers that must write inside an existing transaction (see
 * `hostel-provisioning-service.ts`) can reuse these normalisation rules rather
 * than re-deriving them — the deposit/advance coupling below in particular is
 * easy to get wrong twice.
 */
export function sanitizeBillingDefaultsPayload(payload: Partial<BillingDefaults>) {
  const next: Partial<BillingDefaults> = {};
  const advanceSource = payload.security_deposit ?? payload.advance_deposit;
  if (advanceSource !== undefined) {
    const val = nonNegativeNumber(advanceSource, DEFAULT_BILLING_DEFAULTS.security_deposit);
    next.security_deposit = val;
    next.advance_deposit = val;
  }
  if (payload.maintenance_charge !== undefined) {
    next.maintenance_charge = nonNegativeNumber(payload.maintenance_charge, DEFAULT_BILLING_DEFAULTS.maintenance_charge);
  }
  if (payload.maintenance_type !== undefined) {
    next.maintenance_type = maintenanceType(payload.maintenance_type, DEFAULT_BILLING_DEFAULTS.maintenance_type);
  }
  if (payload.auto_fill_room_rent !== undefined) {
    next.auto_fill_room_rent = Boolean(payload.auto_fill_room_rent);
  }
  if (payload.allow_override !== undefined) {
    next.allow_override = Boolean(payload.allow_override);
  }
  if (payload.reservation_policy !== undefined) {
    next.reservation_policy = String(payload.reservation_policy);
  }
  if (payload.minimum_reservation_deposit !== undefined) {
    next.minimum_reservation_deposit = nonNegativeNumber(payload.minimum_reservation_deposit, 0);
  }
  if (payload.deposit_calculation_mode !== undefined) {
    next.deposit_calculation_mode = calculationMode(payload.deposit_calculation_mode, DEFAULT_BILLING_DEFAULTS.deposit_calculation_mode);
  }
  if (payload.deposit_months !== undefined) {
    next.deposit_months = Math.max(1, Math.min(12, Math.floor(nonNegativeNumber(payload.deposit_months, DEFAULT_BILLING_DEFAULTS.deposit_months))));
  }
  if (payload.agreement_duration_months !== undefined) {
    next.agreement_duration_months = Math.max(1, Math.min(120, Math.floor(nonNegativeNumber(payload.agreement_duration_months, DEFAULT_BILLING_DEFAULTS.agreement_duration_months))));
  }
  return next;
}

export class HostelBillingPreferencesService {
  async getBillingDefaults(hostelId: string): Promise<BillingDefaults> {
    const hostel = await prisma.hostels.findUnique({
      where: { id: hostelId },
      select: { id: true, preferences_config: true },
    });
    if (!hostel) throw new Error("NOT_FOUND: Hostel not found");
    return normalizeBillingDefaults(hostel.preferences_config);
  }

  async updateBillingDefaults(
    hostelId: string,
    payload: Partial<BillingDefaults>,
    ownerId?: string
  ): Promise<BillingDefaults> {
    const hostel = await prisma.hostels.findFirst({
      where: {
        id: hostelId,
        ...(ownerId ? { owner_id: ownerId } : {}),
      },
      select: { id: true, owner_id: true, status: true, preferences_config: true },
    });
    if (!hostel) throw new Error(ownerId ? "FORBIDDEN: Hostel is not owned by the authenticated owner" : "NOT_FOUND: Hostel not found");
    if (hostel.status === "ARCHIVED") {
      throw new Error("FORBIDDEN: Cannot perform operational actions on an archived hostel");
    }
    if (hostel.status === "INACTIVE") {
      throw new Error("FORBIDDEN: Cannot perform operational actions on an inactive hostel");
    }

    const existingConfig = asConfig(hostel.preferences_config);
    const current = normalizeBillingDefaults(existingConfig);
    const nextDefaults = {
      ...current,
      ...sanitizeBillingDefaultsPayload(payload),
    };

    const preferences_config = {
      ...existingConfig,
      billing_defaults: nextDefaults,
    };

    await prisma.hostels.update({
      where: { id: hostel.id },
      data: { preferences_config },
    });

    await eventLog.log("BILLING_DEFAULTS_UPDATED", hostel.owner_id, {
      hostel_id: hostel.id,
      billing_defaults: nextDefaults,
    });

    return nextDefaults;
  }

  async resolveTenantInviteDefaults(roomId: string, ownerId?: string): Promise<TenantInviteDefaults> {
    const room = await prisma.rooms.findFirst({
      where: {
        id: roomId,
        is_active: true,
        ...(ownerId ? {
          hostels: {
            owner_id: ownerId,
          },
        } : {}),
      },
      select: {
        id: true,
        room_no: true,
        base_rent: true,
        hostel_id: true,
        hostels: {
          select: {
            id: true,
            owner_id: true,
            status: true,
            preferences_config: true,
          },
        },
      },
    });

    if (!room) throw new Error(ownerId ? "FORBIDDEN: Room is not owned by the authenticated owner" : "NOT_FOUND: Room not found");
    if (!room.hostels) throw new Error("NOT_FOUND: Associated hostel not found");
    if (room.hostels.status === "ARCHIVED") {
      throw new Error("VALIDATION_ERROR: Cannot resolve defaults for an archived hostel");
    }
    if (room.hostels.status === "INACTIVE") {
      throw new Error("VALIDATION_ERROR: Cannot resolve defaults for an inactive hostel");
    }

    const billingDefaults = normalizeBillingDefaults(room.hostels.preferences_config);
    const maintenanceCharge = billingDefaults.maintenance_type === "NONE"
      ? 0
      : billingDefaults.maintenance_charge;

    const rent = billingDefaults.auto_fill_room_rent ? Number(room.base_rent || 0) : 0;
    let resolvedSecurityDeposit = billingDefaults.security_deposit ?? billingDefaults.advance_deposit;
    if (billingDefaults.deposit_calculation_mode === "MONTHS_OF_RENT") {
      resolvedSecurityDeposit = billingDefaults.deposit_months * rent;
    }

    const result: TenantInviteDefaults = {
      room: {
        id: room.id,
        room_no: room.room_no,
        base_rent: Number(room.base_rent || 0),
        hostel_id: room.hostel_id,
      },
      billing_defaults: billingDefaults,
      resolved_values: {
        monthly_rent: rent,
        advance_deposit: resolvedSecurityDeposit,
        security_deposit: resolvedSecurityDeposit,
        maintenance_charge: maintenanceCharge,
        maintenance_type: billingDefaults.maintenance_type,
        reservation_policy: billingDefaults.reservation_policy ?? "FULL_DEPOSIT",
        minimum_reservation_deposit: billingDefaults.minimum_reservation_deposit ?? 0,
        deposit_calculation_mode: billingDefaults.deposit_calculation_mode,
        deposit_months: billingDefaults.deposit_months,
        agreement_duration_months: billingDefaults.agreement_duration_months,
      },
    };

    await eventLog.log("BILLING_DEFAULTS_RESOLVED", room.hostels.owner_id, {
      hostel_id: room.hostel_id,
      room_id: room.id,
      resolved_values: result.resolved_values,
    });

    return result;
  }
}

export const hostelBillingPreferencesService = new HostelBillingPreferencesService();
