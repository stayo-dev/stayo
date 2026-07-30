import { getLogger } from "@/lib/logger";
import {
  getSelectionState,
  setSelectionState,
  deleteSelectionState,
  ResidentContextState,
} from "./whatsapp-selection-state";

const logger = getLogger("whatsapp-resident-context");

const RESIDENT_CONTEXT_TTL_SECONDS = Number(
  process.env.RESIDENT_CONTEXT_TTL_SECONDS || 1800 // 30 minutes
);

/**
 * Persistent resident context manager.
 *
 * After a user selects a resident via interactive buttons/list,
 * the context is stored so subsequent commands (BAL, DUES, PAY)
 * work immediately without re-selection.
 */

export type ResolvedResident = {
  residentId: string;
  residentName: string;
  residentRoom: string;
  hostelId: string;
  ownerId: string;
};

/**
 * Look up the active resident for a phone number.
 * Returns null if no context or if it has expired.
 */
export async function resolveActiveResident(
  phone: string
): Promise<ResolvedResident | null> {
  const state = await getSelectionState(phone);
  if (!state || state.action !== "RESIDENT_CONTEXT") return null;

  const ctx = state as ResidentContextState;

  // Check expiry (Redis TTL handles this too, but belt-and-suspenders)
  if (new Date(ctx.expiresAt).getTime() < Date.now()) {
    logger.info("whatsapp.resident_context.expired", { phone });
    await deleteSelectionState(phone);
    return null;
  }

  return {
    residentId: ctx.activeResidentId,
    residentName: ctx.activeResidentName,
    residentRoom: ctx.activeResidentRoom,
    hostelId: ctx.hostelId,
    ownerId: ctx.ownerId,
  };
}

/**
 * Store active resident context. Bumps TTL on every call.
 */
export async function setActiveResident(
  phone: string,
  resident: ResolvedResident,
  pendingCommand?: string
): Promise<void> {
  await setSelectionState(
    phone,
    {
      phone,
      action: "RESIDENT_CONTEXT" as const,
      activeResidentId: resident.residentId,
      activeResidentName: resident.residentName,
      activeResidentRoom: resident.residentRoom,
      hostelId: resident.hostelId,
      ownerId: resident.ownerId,
      pendingCommand,
    },
    RESIDENT_CONTEXT_TTL_SECONDS
  );

  logger.info("whatsapp.resident_context.set", {
    phone,
    residentId: resident.residentId,
    residentName: resident.residentName,
    ttl: RESIDENT_CONTEXT_TTL_SECONDS,
  });
}

/**
 * Refresh context TTL without changing the active resident.
 * Call this on every successful command to extend the session.
 */
export async function refreshResidentContext(
  phone: string
): Promise<boolean> {
  const state = await getSelectionState(phone);
  if (!state || state.action !== "RESIDENT_CONTEXT") return false;

  const ctx = state as ResidentContextState;
  await setSelectionState(
    phone,
    {
      phone,
      action: "RESIDENT_CONTEXT" as const,
      activeResidentId: ctx.activeResidentId,
      activeResidentName: ctx.activeResidentName,
      activeResidentRoom: ctx.activeResidentRoom,
      hostelId: ctx.hostelId,
      ownerId: ctx.ownerId,
    },
    RESIDENT_CONTEXT_TTL_SECONDS
  );

  return true;
}

/**
 * Clear resident context so the next command triggers re-selection.
 */
export async function clearActiveResident(phone: string): Promise<void> {
  await deleteSelectionState(phone);
  logger.info("whatsapp.resident_context.cleared", { phone });
}
