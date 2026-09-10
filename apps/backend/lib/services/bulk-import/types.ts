import type { MaintenanceType } from "../hostel-billing-preferences-service";
import type { RowIssue } from "./issues";

export interface TenantImportRow {
  name: string;
  phone: string;
  email: string;
  room_no: string;
  room_id?: string;
  monthly_rent?: number;
  advance_deposit?: number;
  security_deposit?: number;
  deposit?: number;
  maintenance_charge?: number;
  maintenance_type?: MaintenanceType;
  agreement_duration_months?: number;
  amount_paid?: number;
  amount_includes_deposit?: boolean;
  payment_method?: string;
  payment_reference?: string;
  joining_date?: string;
  notes?: string;
  onboarding_password?: string;
  onboarding_password_hash?: string;
  profile_type?: string;
  emergency_contact?: string;
  gender?: string;
  rent_source?: "ROOM_CONFIG" | "SHEET";
}

export interface ImportDefaults {
  joining_date?: string;
  advance_deposit?: number;
  security_deposit?: number;
  maintenance_charge?: number;
  maintenance_type?: MaintenanceType;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
  value?: any;
}

export interface ValidatedRow {
  row: number;
  data: TenantImportRow;
  errors: ValidationError[];
  warnings: string[];
  issues: RowIssue[];
  isDuplicate: boolean;
  duplicateReason?: string;
}

export interface ValidationResult {
  totalRows: number;
  validRows: ValidatedRow[];
  invalidRows: ValidatedRow[];
  duplicates: ValidatedRow[];
  summary: {
    valid: number;
    invalid: number;
    duplicates: number;
    warnings: number;
    blockers: number;
    choices: number;
  };
}
