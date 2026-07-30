import { getRedisClient } from "@/lib/redis/client";
import { getLogger } from "@/lib/logger";

const logger = getLogger("whatsapp-selection-state");

export interface BalanceSelectionState {
  phone: string;
  action: "BALANCE_SELECTION";
  tenantIds: string[];
  createdAt: string;
  expiresAt: string;
}

export interface InviteTenantSessionState {
  phone: string;
  action: "INVITE_TENANT";
  step: "AWAITING_NAME" | "AWAITING_PHONE" | "AWAITING_HOSTEL" | "AWAITING_ROOM" | "AWAITING_CONFIRMATION";
  data: {
    name?: string;
    phone?: string;
    hostelId?: string;
    roomId?: string;
    roomNo?: string;
    monthlyRent?: number;
    advanceDeposit?: number;
    maintenanceType?: string;
    maintenanceAmount?: number;
  };
  createdAt: string;
  expiresAt: string;
}

export interface OwnerEntitySearchState {
  phone: string;
  action: "OWNER_ENTITY_SEARCH";
  ownerId: string;
  query: string;
  resultIds: string[];
  createdAt: string;
  expiresAt: string;
}

export interface OwnerMoveOutDateState {
  phone: string;
  action: "OWNER_MOVE_OUT_DATE";
  ownerId: string;
  tenantId: string;
  createdAt: string;
  expiresAt: string;
}

export interface ResidentContextState {
  phone: string;
  action: "RESIDENT_CONTEXT";
  activeResidentId: string;
  activeResidentName: string;
  activeResidentRoom: string;
  hostelId: string;
  ownerId: string;
  /** The command that was pending when selection was triggered (e.g. "BAL") */
  pendingCommand?: string;
  createdAt: string;
  expiresAt: string;
}

export type WhatsAppSessionState =
  | BalanceSelectionState
  | InviteTenantSessionState
  | OwnerEntitySearchState
  | OwnerMoveOutDateState
  | ResidentContextState;

const memoryState = new Map<string, { state: WhatsAppSessionState; expiresAt: number }>();

function getRedisKey(phone: string): string {
  // Use prefix/version conventions consistent with keys.ts
  const prefix = process.env.REDIS_KEY_PREFIX || "hms";
  return `${prefix}:v1:whatsapp:selection:${phone}`;
}

export async function getSelectionState(phone: string): Promise<WhatsAppSessionState | null> {
  const redisKey = getRedisKey(phone);
  const redis = getRedisClient();

  if (redis) {
    try {
      const val = await redis.get<WhatsAppSessionState>(redisKey);
      if (val) {
        return val;
      }
    } catch (err) {
      logger.warn("whatsapp.redis.getSelectionState.error", {
        phone,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fallback to local memory state
  const entry = memoryState.get(phone);
  if (!entry) return null;
  return entry.state;
}

export async function setSelectionState(
  phone: string,
  state:
    | Omit<BalanceSelectionState, "createdAt" | "expiresAt">
    | Omit<InviteTenantSessionState, "createdAt" | "expiresAt">
    | Omit<OwnerEntitySearchState, "createdAt" | "expiresAt">
    | Omit<OwnerMoveOutDateState, "createdAt" | "expiresAt">
    | Omit<ResidentContextState, "createdAt" | "expiresAt">,
  ttlSeconds = 600
): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000);

  const fullState: WhatsAppSessionState = {
    ...state,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  } as WhatsAppSessionState;

  const redisKey = getRedisKey(phone);
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.set(redisKey, fullState, { ex: ttlSeconds });
    } catch (err) {
      logger.warn("whatsapp.redis.setSelectionState.error", {
        phone,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Set local memory state
  memoryState.set(phone, {
    state: fullState,
    expiresAt: expires.getTime(),
  });
}

export async function deleteSelectionState(phone: string): Promise<void> {
  const redisKey = getRedisKey(phone);
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.del(redisKey);
    } catch (err) {
      logger.warn("whatsapp.redis.deleteSelectionState.error", {
        phone,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  memoryState.delete(phone);
}
