export class ValidationEngine {
  async validate(before: Record<string, any>, diff: Record<string, any>): Promise<void> {
    // 1. Rent obligation bounds
    if (diff.monthly_rent !== undefined && diff.monthly_rent !== null) {
      const rent = Number(diff.monthly_rent);
      if (isNaN(rent) || rent < 0) {
        throw new Error("VALIDATION: Monthly rent must be a non-negative number");
      }
    }

    if (diff.security_deposit !== undefined && diff.security_deposit !== null) {
      const deposit = Number(diff.security_deposit);
      if (isNaN(deposit) || deposit < 0) {
        throw new Error("VALIDATION: Security deposit must be a non-negative number");
      }
    }

    if (diff.maintenance_charge !== undefined && diff.maintenance_charge !== null) {
      const maintenance = Number(diff.maintenance_charge);
      if (isNaN(maintenance) || maintenance < 0) {
        throw new Error("VALIDATION: Maintenance charge must be a non-negative number");
      }
    }

    // 2. Date validations
    const startDateVal = diff.agreement_start_date ?? before.agreement_start_date;
    const endDateVal = diff.agreement_end_date ?? before.agreement_end_date;
    if (startDateVal && endDateVal) {
      const start = new Date(startDateVal);
      const end = new Date(endDateVal);
      if (start >= end) {
        throw new Error("VALIDATION: Agreement start date must be before end date");
      }
    }

    // 3. Email and Phone basic validations if modified
    if (diff.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(diff.email))) {
        throw new Error("VALIDATION: Invalid email format");
      }
    }

    if (diff.phone) {
      if (String(diff.phone).trim().length < 8) {
        throw new Error("VALIDATION: Invalid phone number length");
      }
    }
  }
}

export const validationEngine = new ValidationEngine();
