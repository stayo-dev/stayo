import { apiError } from "@/lib/utils/api-utils";
import { MAX_RETURN_DAYS } from "./stay-status";
import type { StayRejectReason } from "./stay-events";

export type StayErrorCode = StayRejectReason | "STAY_INELIGIBLE" | "INVALID_REQUEST";

export class StayError extends Error {
  constructor(
    public readonly code: StayErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "StayError";
  }
}

/** Tenant-facing words — these reach the screen verbatim via parseApiError. */
const REJECTIONS: Record<StayRejectReason, [number, string]> = {
  NO_ACTIVE_LEAVE: [409, "You're not on leave right now."],
  ON_LEAVE: [409, "You're on leave — tap I'm back first."],
  INVALID_LEAVE_TYPE: [400, "Choose Going home or Vacation."],
  INVALID_DATE: [400, "That isn't a valid date."],
  TOO_SOON: [400, "Pick a return date from tomorrow onwards."],
  TOO_FAR: [400, `Pick a return date within ${MAX_RETURN_DAYS} days.`],
  UNKNOWN_TYPE: [400, "That isn't a stay update we know."],
};

export function rejection(reason: StayRejectReason): StayError {
  const [status, message] = REJECTIONS[reason];
  return new StayError(reason, message, status);
}

export const ineligible = () => new StayError("STAY_INELIGIBLE", "Only a current resident can update their stay.", 409);
export const invalidRequest = (message: string) => new StayError("INVALID_REQUEST", message, 400);

/** Every Stay route's catch block: the repo's standard error envelope. */
export function stayErrorResponse(error: any) {
  if (error instanceof StayError) return apiError(error.message, error.code, error.status);
  const code = error?.code;
  const message = String(error?.message || "Stay update failed");
  if (code === "HOSTEL_CONTEXT_REQUIRED") return apiError(message, code, 400);
  if (code === "UNAUTHORIZED") return apiError(message, code, 401);
  if (code === "FORBIDDEN") return apiError("Forbidden", code, 403);
  return apiError(message, "ERROR", 500);
}
