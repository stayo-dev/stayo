import crypto from "crypto";
import { prisma } from "../db";
import { eventSystem } from "../events";
import { eventLog } from "./event-log-service";
import { getLogger } from "../logger";
import {
  DEFAULT_BILLING_DEFAULTS,
  sanitizeBillingDefaultsPayload,
} from "./hostel-billing-preferences-service";
import {
  HostelProvisionSchema,
  type HostelProvisionData,
} from "../../src/validators/hostels";
import { leadInvitationService } from "../../src/services/platform-leads/lead-invitation-service";

const logger = getLogger("hostel-provisioning-service");

/**
 * A big property is 8 floors × 20 rooms = 160 rooms, written as 8 floor
 * inserts plus 8 batched room inserts. Prisma's 5s interactive-transaction
 * default is comfortable for that on a warm connection but not on a cold
 * pooled one, and a timeout here means the owner sees the same "publish
 * failed" dead-end this service exists to remove.
 */
const TRANSACTION_TIMEOUT_MS = 20_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export interface HostelProvisionResult {
  hostel: { id: string; name: string };
  floors_created: number;
  rooms_created: number;
}

/** Carries the existing hostel's id so the caller can offer to open it. */
export class HostelAlreadyExistsError extends Error {
  readonly code = "ALREADY_EXISTS";
  constructor(readonly hostelId: string, name: string) {
    super(`ALREADY_EXISTS: You already have a hostel called "${name}"`);
    this.name = "HostelAlreadyExistsError";
  }
}

/**
 * Provisions a complete hostel — identity, billing defaults, floors, rooms —
 * in ONE database transaction.
 *
 * Replaces the onboarding wizard's old publish loop, which issued
 * 1 + F + (F × R) sequential HTTP calls with no transaction: a failure partway
 * through left a committed, partially built hostel, and the retry then hit the
 * owner-scoped duplicate-name guard on POST /api/owner/hostels and returned
 * 400 forever. The owner had no way out of step 11 of 12.
 *
 * Either every row lands or none does, so a failed publish is always safely
 * retryable.
 */
export class HostelProvisioningService {
  async provision(ownerId: string, input: unknown): Promise<HostelProvisionResult> {
    const parsed = HostelProvisionSchema.safeParse(input);
    if (!parsed.success) {
      const detail = parsed.error.errors
        .map((e) => `${e.path.join(".") || "input"}: ${e.message}`)
        .join("; ");
      throw new Error(`VALIDATION: ${detail}`);
    }
    const data = parsed.data;

    // Checked before opening the transaction: a duplicate is a user-facing
    // conflict, not a database failure, and there is no reason to hold a
    // connection open to discover it.
    const existing = await prisma.hostels.findFirst({
      where: {
        owner_id: ownerId,
        status: { in: ["ACTIVE", "INACTIVE"] },
        name: { equals: data.name, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    if (existing) {
      throw new HostelAlreadyExistsError(existing.id, existing.name);
    }

    const result = await prisma.$transaction(
      async (tx: any) => this.buildInTransaction(tx, ownerId, data),
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
    );

    logger.info("hostel_provisioned", {
      owner_id: ownerId,
      hostel_id: result.hostel.id,
      floors: result.floors_created,
      rooms: result.rooms_created,
    });

    // Side effects run only after the transaction has committed, so a rollback
    // can never emit an event for a hostel that does not exist. Both are
    // best-effort: a failed notification must not undo a real hostel.
    await eventLog
      .log("HOSTEL_PROVISIONED", ownerId, {
        hostel_id: result.hostel.id,
        floors_created: result.floors_created,
        rooms_created: result.rooms_created,
        publish_requested: data.publish === "now",
      })
      .catch((err: any) => logger.error("hostel_provisioned_log_failed", { error: String(err) }));

    await eventSystem
      .trigger("hostel_created", {
        hostel_id: result.hostel.id,
        owner_id: ownerId,
        creator_id: ownerId,
      })
      .catch((err: any) => logger.error("hostel_created_event_failed", { error: String(err) }));

    // Same side effect POST /api/owner/hostels performs (ADR-032): advance an
    // OWNER_ACTIVATED lead to HOSTEL_CREATED. Without it the wizard's trailing
    // /leads/invitation/:token/complete call is a no-op — `markLive` only
    // promotes a lead already at HOSTEL_CREATED — and a lead-originated owner
    // would never reach LIVE.
    await leadInvitationService
      .markHostelCreated(ownerId)
      .catch((err: any) => logger.error("lead_hostel_created_failed", { error: String(err) }));

    return result;
  }

  private async buildInTransaction(
    tx: any,
    ownerId: string,
    data: HostelProvisionData,
  ): Promise<HostelProvisionResult> {
    const billingDefaults = {
      ...DEFAULT_BILLING_DEFAULTS,
      ...sanitizeBillingDefaultsPayload({ security_deposit: data.security_deposit }),
    };

    const hostel = await tx.hostels.create({
      data: {
        owner_id: ownerId,
        name: data.name,
        phone: data.phone ?? "",
        address: data.address ?? "",
        city: data.city ?? null,
        state: data.state ?? null,
        pincode: data.pincode ?? null,
        hostel_type: data.type ?? null,
        food_included: data.food_included,
        // The owner's intent only. `listing_status`/`verification_status` stay
        // at their schema defaults (DRAFT/PENDING) and remain the Platform
        // Admin console's to change — see ADR-040.
        publish_requested: data.publish === "now",
        status: "ACTIVE",
        is_active: true,
        preferences_config: { billing_defaults: billingDefaults },
      },
      select: { id: true, name: true },
    });

    let roomsCreated = 0;

    for (let floorNumber = 1; floorNumber <= data.floors; floorNumber++) {
      const floor = await tx.floors.create({
        data: {
          hostel_id: hostel.id,
          owner_id: ownerId,
          name: `Floor ${floorNumber}`,
          sort_order: floorNumber,
        },
        select: { id: true },
      });

      // Room numbering is byte-identical to the old publish loop's
      // `${floor}${room padded to 2}` — 101…110, 201…210 — so nothing that
      // reads room_no shifts underneath this change.
      const rooms = Array.from({ length: data.rooms_per_floor }, (_, i) => ({
        id: crypto.randomUUID(),
        hostel_id: hostel.id,
        floor_id: floor.id,
        floor: floorNumber,
        room_no: `${floorNumber}${String(i + 1).padStart(2, "0")}`,
        capacity: data.beds_per_room,
        base_rent: data.base_rent,
      }));

      // One insert per floor rather than one per room: 8 statements instead of
      // 160, which is what keeps the transaction comfortably inside its window.
      await tx.rooms.createMany({ data: rooms });
      roomsCreated += rooms.length;
    }

    return {
      hostel,
      floors_created: data.floors,
      rooms_created: roomsCreated,
    };
  }
}

export const hostelProvisioningService = new HostelProvisioningService();
