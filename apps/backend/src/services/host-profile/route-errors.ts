import { apiError } from "@/lib/auth";
import { HostProfileError } from "./host-profile-service";

/** A HostProfileError carries its own status and owner-facing message; anything else is a 500. */
export function hostProfileFailure(error: unknown, where: string) {
  if (error instanceof HostProfileError) return apiError(error.message, error.code, error.status);
  console.error(`[${where}]`, error instanceof Error ? error.message : String(error));
  return apiError("Something went wrong. Please try again.");
}
