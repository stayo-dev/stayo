import { apiError } from "@/lib/utils/api-utils";

export type MealErrorCode = "INVALID_REQUEST" | "NOT_FOUND";

export class MealError extends Error {
  constructor(
    public readonly code: MealErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MealError";
  }
}

export const invalidRequest = (message: string) => new MealError("INVALID_REQUEST", message, 400);

/** Every meals route's catch block: the repo's standard error envelope. */
export function mealErrorResponse(error: any) {
  if (error instanceof MealError) return apiError(error.message, error.code, error.status);
  const code = error?.code;
  const message = String(error?.message || "Meal forecast failed");
  if (code === "HOSTEL_CONTEXT_REQUIRED") return apiError(message, code, 400);
  if (code === "UNAUTHORIZED") return apiError(message, code, 401);
  if (code === "FORBIDDEN") return apiError("Forbidden", code, 403);
  return apiError(message, "ERROR", 500);
}
