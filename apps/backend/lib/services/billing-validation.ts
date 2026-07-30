/**
 * 💳 Billing Validation — Phase 4
 *
 * Pure validation layer for hostel billing preferences.
 * All functions are side-effect free — they only inspect input and return
 * structured errors. No DB writes ever happen here.
 *
 * Policy: due_day < auto_rent_day
 *   → Shift the due date into the NEXT calendar month.
 *   → Rationale: Rejecting configurations mid-run is more disruptive than
 *     auto-correcting them. Tenants always get at least the configured number
 *     of days. The correction is logged as a structured warning event.
 */

export type BillingValidationCode =
  | "INVALID_AUTO_RENT_DAY"
  | "INVALID_DUE_DAY"
  | "INVALID_TIMEZONE"
  | "UNSUPPORTED_RENT_CYCLE"
  | "DUE_DAY_BEFORE_RENT_DAY_SHIFTED"
  | "ZERO_RENT_AMOUNT"
  | "NEGATIVE_RENT_AMOUNT";

export type BillingValidationSeverity = "ERROR" | "WARNING";

export interface BillingValidationError {
  code: BillingValidationCode;
  severity: BillingValidationSeverity;
  hostel_id: string;
  owner_id: string;
  field: string;
  value: unknown;
  message: string;
  /** Present only for WARNING codes that have an auto-correction applied */
  correction?: Record<string, unknown>;
}

export type BillingValidationResult =
  | { valid: true; errors: BillingValidationError[] }   // valid=true means no ERROR-severity issues (may still have warnings)
  | { valid: false; errors: BillingValidationError[] };

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_RENT_CYCLES = ["MONTHLY"] as const;
const MIN_CALENDAR_DAY = 1;
const MAX_CALENDAR_DAY = 28; // cap at 28 — safe for all months including Feb

// ─── Timezone validation ──────────────────────────────────────────────────────

/**
 * Returns true if the string is a valid IANA timezone identifier.
 * Uses the same Intl API already relied upon in lib/timezone.ts.
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.trim().length === 0) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ─── Core validator ───────────────────────────────────────────────────────────

export interface PreferencesToValidate {
  hostel_id: string;
  owner_id: string;
  auto_rent_day: number;
  due_day: number;
  timezone: string;
  rent_cycle: string;
}

/**
 * Validate hostel billing preferences before generation begins.
 *
 * Returns a result with:
 *  - valid: false  → at least one ERROR found; generation must be aborted
 *  - valid: true   → configuration is acceptable (may include WARNINGs with auto-corrections)
 */
export function validateBillingPreferences(
  input: PreferencesToValidate
): BillingValidationResult {
  const errors: BillingValidationError[] = [];
  const { hostel_id, owner_id } = input;

  // 1. auto_rent_day: must be an integer in [1, 28]
  const autoRentDay = Number(input.auto_rent_day);
  if (!Number.isInteger(autoRentDay) || autoRentDay < MIN_CALENDAR_DAY || autoRentDay > MAX_CALENDAR_DAY) {
    errors.push({
      code: "INVALID_AUTO_RENT_DAY",
      severity: "ERROR",
      hostel_id,
      owner_id,
      field: "auto_rent_day",
      value: input.auto_rent_day,
      message: `auto_rent_day must be an integer between ${MIN_CALENDAR_DAY} and ${MAX_CALENDAR_DAY}, got ${input.auto_rent_day}`,
    });
  }

  // 2. due_day: must be an integer in [1, 28]
  const dueDay = Number(input.due_day);
  if (!Number.isInteger(dueDay) || dueDay < MIN_CALENDAR_DAY || dueDay > MAX_CALENDAR_DAY) {
    errors.push({
      code: "INVALID_DUE_DAY",
      severity: "ERROR",
      hostel_id,
      owner_id,
      field: "due_day",
      value: input.due_day,
      message: `due_day must be an integer between ${MIN_CALENDAR_DAY} and ${MAX_CALENDAR_DAY}, got ${input.due_day}`,
    });
  }

  // 3. timezone: must be valid IANA identifier
  if (!isValidTimezone(input.timezone)) {
    errors.push({
      code: "INVALID_TIMEZONE",
      severity: "ERROR",
      hostel_id,
      owner_id,
      field: "timezone",
      value: input.timezone,
      message: `timezone "${input.timezone}" is not a valid IANA timezone identifier`,
    });
  }

  // 4. rent_cycle: must be a supported value
  const cycle = (input.rent_cycle || "").toUpperCase();
  if (!SUPPORTED_RENT_CYCLES.includes(cycle as any)) {
    errors.push({
      code: "UNSUPPORTED_RENT_CYCLE",
      severity: "ERROR",
      hostel_id,
      owner_id,
      field: "rent_cycle",
      value: input.rent_cycle,
      message: `rent_cycle "${input.rent_cycle}" is not supported. Supported values: ${SUPPORTED_RENT_CYCLES.join(", ")}`,
    });
  }

  // Early return for hard errors — the warning check below assumes valid day values
  if (errors.some((e) => e.severity === "ERROR")) {
    return { valid: false, errors };
  }

  // 5. Policy: due_day < auto_rent_day → shift into next month (WARNING, not ERROR)
  if (dueDay < autoRentDay) {
    errors.push({
      code: "DUE_DAY_BEFORE_RENT_DAY_SHIFTED",
      severity: "WARNING",
      hostel_id,
      owner_id,
      field: "due_day",
      value: input.due_day,
      message: `due_day (${dueDay}) is before auto_rent_day (${autoRentDay}). Due date will be shifted to day ${dueDay} of the NEXT month to avoid a negative grace window.`,
      correction: { due_date_shifted_to_next_month: true },
    });
  }

  return { valid: true, errors };
}

// ─── Due-date computation with shift policy ───────────────────────────────────

/**
 * Compute the deterministic due date for an obligation in the given calendar month.
 *
 * Policy: if due_day < auto_rent_day, the due date is pushed to the NEXT month.
 * This ensures tenants always have a full grace window from generation day to due day.
 *
 * @param rentMonthUTC  - The UTC-normalized rent month (always 1st of month at 00:00:00Z)
 * @param autoRentDay   - The configured generation day for this hostel
 * @param dueDay        - The configured due day for this hostel (1–28)
 */
export function computeDueDate(
  rentMonthUTC: Date,
  autoRentDay: number,
  dueDay: number
): Date {
  const year = rentMonthUTC.getUTCFullYear();
  const month = rentMonthUTC.getUTCMonth(); // 0-indexed

  if (dueDay >= autoRentDay) {
    // Normal case: due date is within the same calendar month
    return new Date(Date.UTC(year, month, dueDay));
  }

  // Shift policy: push into next month
  return new Date(Date.UTC(year, month + 1, dueDay));
}

// ─── Obligation-level validation ──────────────────────────────────────────────

export interface ObligationToValidate {
  hostel_id: string;
  owner_id: string;
  allocation_id: string;
  rent_amount: number;
}

/**
 * Validate that a specific obligation is safe to write.
 * Called immediately before pushing a row to rentRows/maintRows.
 */
export function validateObligation(
  input: ObligationToValidate
): BillingValidationResult {
  const errors: BillingValidationError[] = [];
  const { hostel_id, owner_id } = input;

  if (input.rent_amount < 0) {
    errors.push({
      code: "NEGATIVE_RENT_AMOUNT",
      severity: "ERROR",
      hostel_id,
      owner_id,
      field: "rent_amount",
      value: input.rent_amount,
      message: `Negative rent amount (${input.rent_amount}) for allocation ${input.allocation_id} — refusing to create obligation`,
    });
  }

  if (input.rent_amount === 0) {
    errors.push({
      code: "ZERO_RENT_AMOUNT",
      severity: "WARNING",
      hostel_id,
      owner_id,
      field: "rent_amount",
      value: input.rent_amount,
      message: `Zero rent amount for allocation ${input.allocation_id} — obligation will be skipped`,
    });
  }

  const hasErrors = errors.some((e) => e.severity === "ERROR");
  return { valid: !hasErrors, errors };
}
