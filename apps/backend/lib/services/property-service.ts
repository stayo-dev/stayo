import { prisma } from "../db";
import { financialService } from "@/src/services/payments/financial-service";
import { roomCapacityService } from "./room-capacity-service";
import crypto from "crypto";
import { authOtpService } from "@/lib/services/auth/auth-otp-service";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { eventLog } from "@/lib/services/event-log-service";

const ACTIVE_INVITE_STATUSES = ["PENDING", "OPENED", "ACTIVATION_STARTED"];

function invitedOccupantsFromReservations(reservations: any[] = []) {
  return reservations
    .filter((reservation: any) => ACTIVE_INVITE_STATUSES.includes(String(reservation.invitation?.status || "")))
    .map((reservation: any) => ({
      tenant_id: reservation.tenant_id,
      profile_id: reservation.tenant?.profile_id ?? null,
      invitation_id: reservation.invitation_id,
      name: reservation.invitation?.name ?? reservation.tenant?.profiles?.name ?? "Invited tenant",
      email: reservation.invitation?.email ?? reservation.tenant?.personal_email ?? null,
      phone: reservation.invitation?.phone ?? reservation.tenant?.phone_1 ?? null,
      joined_date: reservation.tenant?.joined_on ?? reservation.reserved_at,
      rent: Number(reservation.tenant?.monthly_rent || 0),
      pending_dues: 0,
      payment_status: "INVITED",
      status: "INVITED",
      invite_status: reservation.invitation?.status || "PENDING",
      occupant_type: "INVITED",
      badge: "Invited",
    }));
}

export class PropertyService {
  async getOwnerProfile(userId: string) {
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      include: {
        hostels: {
          where: { status: { in: ["ACTIVE", "INACTIVE"] } },
          orderBy: { created_at: "asc" },
        }
      }
    });

    if (!profile) throw new Error("NOT_FOUND: Owner profile not found");
    
    const singleHostel = profile.hostels.length === 1 ? profile.hostels.at(0) : null;

    return {
      owner: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        role: profile.role,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        pincode: profile.pincode,
        emergency_contact: profile.emergency_contact,
      },
      hostels: profile.hostels.map((hostel: any) => ({
        id: hostel.id,
        name: hostel.name,
        phone: hostel.phone,
        address: hostel.address,
        city: hostel.city,
        state: hostel.state,
        pincode: hostel.pincode,
        upi_id: hostel.upi_id,
        gst_number: hostel.gst_number,
        logo_url: hostel.logo_url,
        status: hostel.status,
      })),
      // Compatibility shape only for single-hostel bootstrap screens. Multi-hostel
      // settings must fetch /api/hostels/:id/preferences explicitly.
      hostel: singleHostel ? {
        id: singleHostel.id,
        name: singleHostel.name || null,
        phone: singleHostel.phone || null,
        address: singleHostel.address || null,
        city: singleHostel.city || null,
        state: singleHostel.state || null,
        pincode: singleHostel.pincode || null,
        upi_id: singleHostel.upi_id || null,
        gst_number: singleHostel.gst_number || null,
        logo_url: (singleHostel as any).logo_url || null,
      } : null,
      preferences: {},
    };
  }

  async updateOwnerProfile(userId: string, data: {
    name?: string;
    phone?: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    emergency_contact?: string | null;
    phone_otp?: string;
    emergency_otp?: string;
  }) {
    const current = await prisma.profile.findUnique({
      where: { id: userId },
    });
    if (!current) throw new Error("NOT_FOUND: Owner profile not found");

    const updateData: any = {};
    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (name.length < 2) throw new Error("VALIDATION: Name must be at least 2 characters");
      updateData.name = name;
    }
    if (data.phone !== undefined) {
      const phone = String(data.phone).trim();
      if (phone && !/^\+?[0-9]{10,15}$/.test(phone)) {
        throw new Error("VALIDATION: Phone must be 10 to 15 digits");
      }
      
      const oldPrimary = (current.phone || "").trim();
      const newPrimary = phone;
      if (newPrimary) {
        let normOld = "";
        try {
          if (oldPrimary) normOld = normalizeWhatsAppPhone(oldPrimary);
        } catch (e) {}

        let normNew = "";
        try {
          normNew = normalizeWhatsAppPhone(newPrimary);
        } catch (err: any) {
          throw new Error(`VALIDATION: Invalid primary phone number: ${err.message}`);
        }

        if (normOld !== normNew) {
          const alreadyVerified = await prisma.phoneVerificationOtp.findFirst({
            where: {
              phone: normNew,
              purpose: "ProfileUpdate",
              status: "VERIFIED",
              verified_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
            },
            orderBy: { verified_at: "desc" },
          });

          if (!alreadyVerified) {
            const otp = data.phone_otp;
            if (!otp) {
              throw new Error("VALIDATION: Verification code is required to update your phone number");
            }
            try {
              await authOtpService.verifyPhoneOtp({
                phone: normNew,
                otp,
                purpose: "ProfileUpdate",
                requestIp: null,
              });
            } catch (err: any) {
              throw new Error(`VALIDATION: Phone verification failed: ${err.message || "Invalid or expired code"}`);
            }
          }
        }
      }
      
      updateData.phone = phone || null;
    }
    if (data.address !== undefined) updateData.address = cleanNullable(data.address);
    if (data.city !== undefined) updateData.city = cleanNullable(data.city);
    if (data.state !== undefined) updateData.state = cleanNullable(data.state);
    if (data.pincode !== undefined) {
      const pincode = cleanNullable(data.pincode);
      if (pincode && !/^[0-9]{4,10}$/.test(pincode)) {
        throw new Error("VALIDATION: Pincode must be numeric");
      }
      updateData.pincode = pincode;
    }
    if (data.emergency_contact !== undefined) {
      const emergencyContact = cleanNullable(data.emergency_contact);
      if (emergencyContact && !/^\+?[0-9]{10,15}$/.test(emergencyContact)) {
        throw new Error("VALIDATION: Emergency contact must be 10 to 15 digits");
      }
      
      const oldEmergency = (current.emergency_contact || "").trim();
      const newEmergency = emergencyContact || "";
      if (newEmergency) {
        let normOld = "";
        try {
          if (oldEmergency) normOld = normalizeWhatsAppPhone(oldEmergency);
        } catch (e) {}

        let normNew = "";
        try {
          normNew = normalizeWhatsAppPhone(newEmergency);
        } catch (err: any) {
          throw new Error(`VALIDATION: Invalid emergency contact number: ${err.message}`);
        }

        if (normOld !== normNew) {
          const alreadyVerified = await prisma.phoneVerificationOtp.findFirst({
            where: {
              phone: normNew,
              purpose: "ProfileUpdate",
              status: "VERIFIED",
              verified_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
            },
            orderBy: { verified_at: "desc" },
          });

          if (!alreadyVerified) {
            const otp = data.emergency_otp;
            if (!otp) {
              throw new Error("VALIDATION: Verification code is required to update your emergency contact phone number");
            }
            try {
              await authOtpService.verifyPhoneOtp({
                phone: normNew,
                otp,
                purpose: "ProfileUpdate",
                requestIp: null,
              });
            } catch (err: any) {
              throw new Error(`VALIDATION: Emergency contact verification failed: ${err.message || "Invalid or expired code"}`);
            }
          }
        }
      }
      
      updateData.emergency_contact = emergencyContact;
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error("VALIDATION: No valid fields to update");
    }

    await prisma.profile.update({
      where: { id: userId },
      data: updateData,
    });

    return this.getOwnerProfile(userId);
  }

  async updateHostel(userId: string, data: any) {
    const profile = await prisma.profile.findUnique({ where: { id: userId } });

    if (!profile) throw new Error("NOT_FOUND: Profile not found");

    const mapped: any = {};
    if (data.name ?? data.hostel_name) mapped.name = data.name ?? data.hostel_name;
    if (data.phone ?? data.hostel_phone) mapped.phone = data.phone ?? data.hostel_phone;
    if (data.address !== undefined) mapped.address = data.address;
    if (data.city !== undefined) mapped.city = data.city;
    if (data.state !== undefined) mapped.state = data.state;
    if (data.pincode !== undefined) mapped.pincode = data.pincode;
    if (data.upi_id !== undefined) mapped.upi_id = data.upi_id;
    if (data.gst_number !== undefined) mapped.gst_number = data.gst_number;

    if (data.status !== undefined) {
      if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(data.status)) {
        throw new Error("VALIDATION: Invalid hostel status");
      }
      mapped.status = data.status;
      mapped.is_active = data.status !== "ARCHIVED";
    }

    const hostelId = data.hostel_id || data.hostelId;

    if (mapped.name) {
      mapped.name = String(mapped.name).trim();
      let targetHostelId = hostelId;
      if (!targetHostelId) {
        const existingHostels = await prisma.hostels.findMany({
          where: { owner_id: userId, status: { in: ["ACTIVE", "INACTIVE"] } },
          select: { id: true },
          orderBy: { created_at: "asc" },
          take: 2,
        });
        if (existingHostels.length === 1) {
          targetHostelId = existingHostels.at(0)?.id;
        }
      }

      const [duplicate] = await prisma.hostels.findMany({
        where: {
          owner_id: userId,
          status: { in: ["ACTIVE", "INACTIVE"] },
          name: {
            equals: mapped.name,
            mode: "insensitive",
          },
          ...(targetHostelId && {
            NOT: {
              id: targetHostelId,
            },
          }),
        },
        take: 1,
      });
      if (duplicate) {
        throw new Error("VALIDATION: A hostel with this name already exists");
      }
    }

    if (hostelId) {
      const currentHostel = await prisma.hostels.findUnique({
        where: { id: hostelId },
      });
      if (!currentHostel || currentHostel.owner_id !== userId) {
        throw new Error("FORBIDDEN: Hostel is not owned by the authenticated owner");
      }

      // If already archived, restrict changes unless restoring
      if (currentHostel.status === "ARCHIVED") {
        const isRestoring = data.status === "ACTIVE" || data.status === "INACTIVE";
        if (!isRestoring) {
          throw new Error("VALIDATION: Cannot modify an archived hostel");
        }
      }

      // If archiving, check active allocations
      if (data.status === "ARCHIVED" && currentHostel.status !== "ARCHIVED") {
        const activeAllocationsCount = await prisma.roomAllocation.count({
          where: {
            hostel_id: hostelId,
            is_active: true,
          },
        });
        if (activeAllocationsCount > 0) {
          throw new Error("VALIDATION: Cannot archive hostel with active tenant allocations");
        }
      }

      // Populate lifecycle metadata for status transitions
      const previousStatus = currentHostel.status;
      if (data.status && data.status !== previousStatus) {
        if (data.status === "ARCHIVED") {
          mapped.archived_at = new Date();
          mapped.archived_by = userId;
          mapped.archive_reason = data.archive_reason || null;
        } else if (previousStatus === "ARCHIVED") {
          // Restoring — clear archive metadata
          mapped.archived_at = null;
          mapped.archived_by = null;
          mapped.archive_reason = null;
        }
      }

      await prisma.hostels.update({
        where: { id: hostelId },
        data: mapped,
      });

      // Log lifecycle transition events
      if (data.status && data.status !== previousStatus) {
        const lifecycleEvent = resolveLifecycleEvent(previousStatus, data.status);
        if (lifecycleEvent) {
          await eventLog.log(lifecycleEvent, userId, {
            hostel_id: hostelId,
            hostel_name: currentHostel.name,
            previous_status: previousStatus,
            new_status: data.status,
            ...(data.archive_reason ? { archive_reason: data.archive_reason } : {}),
          });
        }
      }
    } else {
      const existingHostels = await prisma.hostels.findMany({
        where: { owner_id: userId, status: { in: ["ACTIVE", "INACTIVE"] } },
        select: { id: true },
        orderBy: { created_at: "asc" },
        take: 2,
      });

      if (existingHostels.length === 1) {
        const targetId = existingHostels.at(0)?.id;
        if (!targetId) throw new Error("FORBIDDEN: Hostel context is required");
        const currentHostel = await prisma.hostels.findUnique({
          where: { id: targetId },
        });

        if (currentHostel?.status === "ARCHIVED") {
          const isRestoring = data.status === "ACTIVE" || data.status === "INACTIVE";
          if (!isRestoring) {
            throw new Error("VALIDATION: Cannot modify an archived hostel");
          }
        }

        if (data.status === "ARCHIVED" && currentHostel?.status !== "ARCHIVED") {
          const activeAllocationsCount = await prisma.roomAllocation.count({
            where: {
              hostel_id: targetId,
              is_active: true,
            },
          });
          if (activeAllocationsCount > 0) {
            throw new Error("VALIDATION: Cannot archive hostel with active tenant allocations");
          }
        }

        // Populate lifecycle metadata for status transitions
        const previousStatus = currentHostel?.status;
        if (data.status && data.status !== previousStatus) {
          if (data.status === "ARCHIVED") {
            mapped.archived_at = new Date();
            mapped.archived_by = userId;
            mapped.archive_reason = data.archive_reason || null;
          } else if (previousStatus === "ARCHIVED") {
            mapped.archived_at = null;
            mapped.archived_by = null;
            mapped.archive_reason = null;
          }
        }

        await prisma.hostels.update({
          where: { id: targetId },
          data: mapped,
        });

        // Log lifecycle transition events
        if (data.status && data.status !== previousStatus) {
          const lifecycleEvent = resolveLifecycleEvent(previousStatus || "ACTIVE", data.status);
          if (lifecycleEvent) {
            await eventLog.log(lifecycleEvent, userId, {
              hostel_id: targetId,
              hostel_name: currentHostel?.name,
              previous_status: previousStatus,
              new_status: data.status,
              ...(data.archive_reason ? { archive_reason: data.archive_reason } : {}),
            });
          }
        }
      } else if (existingHostels.length > 1) {
        throw new Error("VALIDATION: hostel_id is required for existing hostel updates");
      } else {
        await prisma.hostels.create({
          data: {
            owner_id: userId,
            name: mapped.name || "My Hostel",
            phone: mapped.phone || "",
            address: mapped.address || "",
            status: mapped.status || "ACTIVE",
            is_active: mapped.is_active !== undefined ? mapped.is_active : true,
            ...mapped,
          },
        });
      }
    }

    return this.getOwnerProfile(userId);
  }

  async updatePreferences(userId: string, data: any) {
    const hostelId = data?.hostel_id || data?.hostelId;
    if (!hostelId) {
      throw new Error("VALIDATION: hostel_id is required for preference updates");
    }

    const { hostelPolicyService } = await import("./hostel-policy-service");
    const policyPatch = data?.policy && typeof data.policy === "object" ? data.policy : {};
    if (!data.policy) {
      // Compatibility adapter for old callers that still send flat preference keys
      // after providing explicit hostel_id. This avoids first-hostel fallback while
      // the UI migrates module-by-module to nested policy domains.
      policyPatch.billing = {
        ...(data.rent_cycle !== undefined && { rent_cycle: data.rent_cycle }),
        ...(data.auto_rent_day !== undefined && { auto_rent_day: data.auto_rent_day }),
        ...(data.due_day !== undefined && { due_day: data.due_day }),
        ...(data.grace_days !== undefined && { grace_days: data.grace_days }),
        ...((data.late_fee_rules !== undefined || data.max_late_fee !== undefined) && {
          late_fee: {
            ...(data.late_fee_rules !== undefined && { rules: data.late_fee_rules }),
            ...(data.max_late_fee !== undefined && { max_amount: data.max_late_fee }),
          },
        }),
        ...((data.billing_defaults !== undefined) && {
          deposit: { default_amount: data.billing_defaults.security_deposit ?? data.billing_defaults.advance_deposit },
          maintenance: { type: data.billing_defaults.maintenance_type, amount: data.billing_defaults.maintenance_charge },
          invite_defaults: {
            auto_fill_room_rent: data.billing_defaults.auto_fill_room_rent,
            allow_override: data.billing_defaults.allow_override,
          },
        }),
        ...((data.allow_partial_payments !== undefined || data.min_payment_amount !== undefined) && {
          partial_payments: {
            ...(data.allow_partial_payments !== undefined && { enabled: data.allow_partial_payments }),
            ...(data.min_payment_amount !== undefined && { minimum_amount: data.min_payment_amount }),
          },
        }),
      };
      policyPatch.payments = {
        ...(data.upi_id !== undefined && { upi_id: data.upi_id }),
        ...(data.phonepe_merchant_id !== undefined && { phonepe_merchant_id: data.phonepe_merchant_id }),
      };
      policyPatch.reminders = {
        ...(data.auto_send_reminders !== undefined && { enabled: data.auto_send_reminders }),
        channels: {
          ...(data.reminder_email !== undefined && { email: data.reminder_email }),
          ...(data.reminder_in_app !== undefined && { in_app: data.reminder_in_app }),
          ...(data.reminder_whatsapp !== undefined && { whatsapp: data.reminder_whatsapp }),
        },
        ...((data.reminder_day_1 !== undefined || data.reminder_day_5 !== undefined || data.reminder_day_10 !== undefined) && {
          schedule: {
            after_due_days: [
              ...(data.reminder_day_1 !== false ? [1] : []),
              ...(data.reminder_day_5 !== false ? [5] : []),
              ...(data.reminder_day_10 !== false ? [10] : []),
            ],
          },
        }),
        ...(data.late_fee_notification !== undefined && { late_fee_notifications: data.late_fee_notification }),
        ...(data.owner_daily_summary !== undefined && { owner_daily_summary: data.owner_daily_summary }),
      };
      policyPatch.automation = {
        ...(data.auto_generate_rent !== undefined && { auto_generate_rent: data.auto_generate_rent }),
        ...(data.auto_apply_late_fees !== undefined && { auto_apply_late_fees: data.auto_apply_late_fees }),
        ...(data.auto_send_reminders !== undefined && { auto_send_reminders: data.auto_send_reminders }),
        ...(data.auto_deactivate_days !== undefined && { auto_deactivate_days: data.auto_deactivate_days }),
        ...(data.auto_email_receipt !== undefined && { auto_email_receipts: data.auto_email_receipt }),
      };
      policyPatch.receipts = {
        ...(data.receipt_prefix !== undefined && { prefix: data.receipt_prefix }),
        ...(data.receipt_format !== undefined && { format: data.receipt_format }),
        ...(data.auto_email_receipt !== undefined && { auto_email: data.auto_email_receipt }),
        ...(data.receipt_footer !== undefined && { footer: data.receipt_footer }),
      };

      policyPatch.tenant_rules = {
        ...(data.allow_tenant_edits !== undefined && { allow_profile_edits: data.allow_tenant_edits }),
        ...(data.require_profile_photo_onboarding !== undefined && { profile_photo_required: data.require_profile_photo_onboarding }),
      };
      policyPatch.operations = {
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.date_format !== undefined && { date_format: data.date_format }),
        ...(data.time_format !== undefined && { time_format: data.time_format }),
        ...(data.language !== undefined && { language: data.language }),
        ...(data.data_retention_months !== undefined && { data_retention_months: data.data_retention_months }),
      };
    }

    return hostelPolicyService.updateHostelPolicy(hostelId, userId, policyPatch, userId);
  }

  async getFloors(ownerId: string, hostelId: string) {
    const rows = await prisma.$queryRaw<any[]>`
      WITH hostel_scope AS (
        SELECT EXISTS (
          SELECT 1
          FROM hostels h
          WHERE h.id = ${hostelId}::uuid
            AND h.owner_id = ${ownerId}::uuid
        ) AS allowed
      ),
      floor_rows AS (
        SELECT
          f.id,
          f.hostel_id,
          f.name,
          f.sort_order,
          COUNT(DISTINCT r.id)::int AS room_count,
          COUNT(ra.id)::int AS occupied_count
        FROM floors f
        JOIN hostel_scope hs ON hs.allowed
        LEFT JOIN rooms r ON r.floor_id = f.id AND r.is_active = true
        LEFT JOIN room_allocations ra ON ra.room_id = r.id AND ra.is_active = true AND ra.end_date IS NULL
        WHERE f.hostel_id = ${hostelId}::uuid
        GROUP BY f.id, f.hostel_id, f.name, f.sort_order
        ORDER BY f.sort_order ASC
      )
      SELECT
        hs.allowed,
        COALESCE(jsonb_agg(to_jsonb(floor_rows) ORDER BY floor_rows.sort_order ASC) FILTER (WHERE floor_rows.id IS NOT NULL), '[]'::jsonb) AS floors
      FROM hostel_scope hs
      LEFT JOIN floor_rows ON true
      GROUP BY hs.allowed
    `;

    const row = rows[0];
    if (!row?.allowed) {
      const error: any = new Error("Hostel is not owned by the authenticated owner");
      error.code = "FORBIDDEN";
      throw error;
    }

    return Array.isArray(row.floors) ? row.floors : [];
  }

  async createFloor(ownerId: string, hostelId: string, data: { name: string; sort_order?: number }) {
    const hostel = await prisma.hostels.findUnique({ where: { id: hostelId } });
    if (!hostel || hostel.owner_id !== ownerId) throw new Error("NOT_FOUND: Hostel not found");
    if (hostel.status === "ARCHIVED") throw new Error("HOSTEL_ARCHIVED: Cannot modify rooms/floors of an archived hostel");
    if (hostel.status === "INACTIVE") throw new Error("VALIDATION: Cannot modify rooms/floors of an inactive hostel");

    return await prisma.floors.create({
      data: {
        hostel_id: hostelId,
        owner_id: ownerId,
        name: data.name.trim(),
        sort_order: data.sort_order ?? 0,
      },
    });
  }

  async updateFloor(floorId: string, ownerId: string, data: { name?: string; sort_order?: number }) {
    const floor = await prisma.floors.findUnique({
      where: { id: floorId },
      include: { hostel: { select: { owner_id: true, status: true } } },
    });
    if (!floor || floor.hostel.owner_id !== ownerId) throw new Error("NOT_FOUND: Floor not found");
    if (floor.hostel.status === "ARCHIVED") throw new Error("HOSTEL_ARCHIVED: Cannot modify rooms/floors of an archived hostel");
    if (floor.hostel.status === "INACTIVE") throw new Error("VALIDATION: Cannot modify rooms/floors of an inactive hostel");

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.sort_order !== undefined) updateData.sort_order = Number(data.sort_order);
    if (Object.keys(updateData).length === 0) return floor;

    return await prisma.floors.update({ where: { id: floorId }, data: updateData });
  }

  async deleteFloor(floorId: string, ownerId: string) {
    const floor = await prisma.floors.findUnique({
      where: { id: floorId },
      include: {
        hostel: { select: { owner_id: true, status: true } },
        rooms: { where: { is_active: true }, select: { id: true } },
      },
    });
    if (!floor || floor.hostel.owner_id !== ownerId) throw new Error("NOT_FOUND: Floor not found");
    if (floor.hostel.status === "ARCHIVED") throw new Error("HOSTEL_ARCHIVED: Cannot modify rooms/floors of an archived hostel");
    if (floor.hostel.status === "INACTIVE") throw new Error("VALIDATION: Cannot modify rooms/floors of an inactive hostel");
    if (floor.rooms.length > 0) throw new Error("VALIDATION: Cannot delete floor with active rooms");

    await prisma.floors.delete({ where: { id: floorId } });
  }

  /**
   * Create a whole floor's rooms in one transaction.
   *
   * The hostel builder fills a floor at a time, and a floor is normally a
   * mix — three 4-sharing rooms and one 2-sharing, each with its own rent —
   * so every room arrives fully specified. This is the shape
   * `HostelProvisioningService` could not express: it multiplies one
   * `beds_per_room` and one `base_rent` across a uniform grid.
   *
   * All-or-nothing on purpose. A floor half-created after a duplicate room
   * number would leave the owner re-entering the rooms that did land, which
   * is exactly the dead-end the provisioning service was written to remove.
   */
  async createRoomsForFloor(
    floorId: string,
    ownerId: string,
    rooms: Array<{ room_no: string; capacity: number; base_rent?: number; room_type?: string }>,
  ) {
    const floor = await prisma.floors.findUnique({
      where: { id: floorId },
      include: { hostel: { select: { id: true, owner_id: true, status: true } } },
    });
    if (!floor || floor.hostel.owner_id !== ownerId) throw new Error("NOT_FOUND: Floor not found");
    if (floor.hostel.status === "ARCHIVED") throw new Error("HOSTEL_ARCHIVED: Cannot modify rooms/floors of an archived hostel");
    if (floor.hostel.status === "INACTIVE") throw new Error("VALIDATION: Cannot modify rooms/floors of an inactive hostel");

    const hostelId = floor.hostel.id;
    const numbers = rooms.map((room) => room.room_no.trim());

    // Caught here rather than left to the unique index, so the owner is told
    // which number repeats instead of reading a Postgres constraint name.
    const duplicatesInRequest = numbers.filter((no, i) => numbers.indexOf(no) !== i);
    if (duplicatesInRequest.length > 0) {
      throw new Error(`VALIDATION: Room ${duplicatesInRequest[0]} is listed twice`);
    }

    const clashing = await prisma.rooms.findFirst({
      where: { hostel_id: hostelId, room_no: { in: numbers }, is_active: true },
      select: { room_no: true },
    });
    if (clashing) {
      throw new Error(`CONFLICT: Room ${clashing.room_no} already exists in this hostel`);
    }

    // `floor` (the legacy Int column) is kept in step with `floor_id` because
    // parts of the read path still order and group by it.
    const created = await prisma.$transaction(async (tx: any) => {
      await tx.rooms.createMany({
        data: rooms.map((room, index) => ({
          id: crypto.randomUUID(),
          hostel_id: hostelId,
          floor_id: floor.id,
          floor: floor.sort_order || null,
          room_no: room.room_no.trim(),
          capacity: room.capacity,
          base_rent: room.base_rent ?? null,
          room_type: room.room_type ?? null,
          sort_order: index,
        })),
      });

      return tx.rooms.findMany({
        where: { floor_id: floor.id, room_no: { in: numbers } },
        orderBy: { sort_order: "asc" },
      });
    });

    await eventLog
      .log("ROOMS_BULK_CREATED", ownerId, {
        hostel_id: hostelId,
        floor_id: floor.id,
        rooms_created: created.length,
      })
      .catch(() => undefined);

    return created;
  }

  async getFloorsWithRooms(ownerId: string, hostelId: string) {
    // Load named floors ordered by sort_order; fall back to a synthetic record for rooms with no floor_id.
    const [floors, rooms, capacityMap] = await Promise.all([
      prisma.floors.findMany({
        where: { hostel_id: hostelId, hostel: { owner_id: ownerId } },
        orderBy: { sort_order: "asc" },
      }),
      prisma.rooms.findMany({
        where: { hostels: { owner_id: ownerId }, is_active: true, hostel_id: hostelId },
        include: {
          room_allocations: {
            where: { is_active: true, end_date: null },
            include: {
              tenant: {
                include: {
                  profiles: true,
                  tenant_invitations: {
                    orderBy: { created_at: "desc" },
                    take: 1,
                    select: { name: true, email: true, phone: true },
                  },
                  rent_obligations: {
                    where: { status: { in: ["PENDING", "PARTIAL", "PAID"] }, is_superseded: false },
                    include: { payments: { select: { amount_paid: true, payment_date: true } } },
                  },
                },
              },
            },
          },
          tenant_invitation_reservations: {
            where: { status: "ACTIVE" },
            include: {
              tenant: { include: { profiles: true } },
              invitation: true,
            },
          },
        },
        // NULLs last, then room_no — see 20260810120000_room_sort_order. A room
        // the owner has never dragged keeps the position it always had.
        orderBy: [{ sort_order: { sort: "asc", nulls: "last" } }, { room_no: "asc" }],
      }),
      roomCapacityService.getHostelCapacityMap(hostelId, { ownerId }),
    ]);

    // Build floor index by id; also a fallback bucket for rooms with no floor_id.
    const floorMap = new Map<string, any>();
    floors.forEach((f: any) => {
      floorMap.set(f.id, { id: f.id, name: f.name, sort_order: f.sort_order, rooms: [] });
    });
    const unassigned: any = { id: "__unassigned", name: "Unassigned", sort_order: 999, rooms: [] };

    rooms.forEach((room: any) => {
	      const tenants = room.room_allocations.map((a: any) => {
	        const tenant = a.tenant;
	        const profile = tenant.profiles;
	        const invitation = tenant.tenant_invitations?.[0];
	        const summary = financialService.getTenantPaymentSummary(tenant.id, tenant.rent_obligations || []);
	        return {
	          tenant_id: tenant.id,
	          name: profile?.name ?? invitation?.name ?? "Tenant",
	          email: profile?.email ?? tenant.personal_email ?? invitation?.email ?? null,
	          phone: profile?.phone ?? tenant.phone_1 ?? invitation?.phone ?? null,
	          joined_date: a.start_date,
	          rent: Number(tenant.monthly_rent),
	          pending_dues: Number(summary.pending_amount || 0),
          status: tenant.status,
        };
      });

      const invitedTenants = invitedOccupantsFromReservations(room.tenant_invitation_reservations);
      const displayTenants = [...tenants, ...invitedTenants];
      const capacity = capacityMap.get(room.id);
      const roomEntry = {
        id: room.id,
        room_no: room.room_no,
        capacity: room.capacity,
        base_rent: room.base_rent,
        wifi_name: room.wifi_name ?? null,
        notes: room.notes ?? null,
        occupied: capacity?.occupied ?? tenants.length,
        reserved: capacity?.reserved ?? 0,
        used: capacity?.used ?? tenants.length,
        available: capacity?.available ?? Math.max(Number(room.capacity || 0) - tenants.length, 0),
        status: capacity?.state ?? (tenants.length === 0 ? "vacant" : tenants.length >= Number(room.capacity || 0) ? "full" : "partial"),
        floor_id: room.floor_id ?? null,
        sort_order: room.sort_order ?? null,
        tenants: displayTenants,
        pending_dues: tenants.reduce((s: number, t: any) => s + t.pending_dues, 0),
      };

      const bucket = room.floor_id ? floorMap.get(room.floor_id) : null;
      (bucket ?? unassigned).rooms.push(roomEntry);
    });

    const result = Array.from(floorMap.values());
    if (unassigned.rooms.length > 0) result.push(unassigned);
    return result;
  }

  async getRoomOverview(roomId: string, ownerId: string) {
    const room = await prisma.rooms.findUnique({
      where: { id: roomId },
      include: {
        hostels: { select: { owner_id: true } },
        room_allocations: {
          where: { is_active: true, end_date: null },
          include: {
            tenant: {
              include: {
                profiles: true,
                tenant_invitations: {
                  orderBy: { created_at: "desc" },
                  take: 1,
                  select: { name: true, email: true, phone: true },
                },
                rent_obligations: {
                  where: { status: { in: ["PENDING", "PARTIAL", "PAID"] }, is_superseded: false },
                  include: { payments: { select: { amount_paid: true, payment_date: true } } }
                }
              }
            }
          }
        },
        tenant_invitation_reservations: {
          where: { status: "ACTIVE" },
          include: {
            tenant: { include: { profiles: true } },
            invitation: true,
          },
        }
      }
    });

    if (!room || room.hostels.owner_id !== ownerId) throw new Error("NOT_FOUND: Room not found");

    const tenants = room.room_allocations.map((a: any) => {
	      const tenant = a.tenant;
        if (!tenant) return null;
	      const profile = tenant.profiles;
	      const invitation = tenant.tenant_invitations?.[0];
	      const obligations = tenant.rent_obligations || [];
	      const summary = financialService.getTenantPaymentSummary(tenant.id, obligations);
	      const pendingDues = Number(summary.pending_amount || 0);

      // Extract last payment info
      const allPayments = obligations.flatMap((o: any) => o.payments);
      const lastPayment = allPayments.length > 0 
        ? allPayments.sort((p1: any, p2: any) => new Date(p2.payment_date).getTime() - new Date(p1.payment_date).getTime())[0]
        : null;

      const paymentStatus = pendingDues <= 0
        ? (lastPayment ? "PAID" : "NO_HISTORY")
        : (summary.total_paid > 0 ? "PARTIAL" : "PENDING");

	      return {
	        tenant_id: tenant.id,
	        profile_id: profile?.id ?? tenant.profile_id ?? null,
	        name: profile?.name ?? invitation?.name ?? "Tenant",
	        email: profile?.email ?? tenant.personal_email ?? invitation?.email ?? null,
	        phone: profile?.phone ?? tenant.phone_1 ?? invitation?.phone ?? null,
	        joined_date: a.start_date,
	        rent: Number(tenant.monthly_rent),
        payment_status: paymentStatus,
        last_payment: lastPayment ? lastPayment.payment_date : null,
        last_payment_amount: lastPayment ? Number(lastPayment.amount_paid) : 0,
        pending_dues: pendingDues,
        status: tenant.status,
        obligations
      };
    });

    const invitedTenants = invitedOccupantsFromReservations((room as any).tenant_invitation_reservations);
    const displayTenants = [...tenants, ...invitedTenants];
    const floorNum = room.floor ?? 0;
    const capacity = await roomCapacityService.getRoomCapacitySnapshot(room.id, { ownerId });

    // Gather latest payments for the room
    const payments = tenants
      .filter((t: any) => t.last_payment)
      .map((t: any) => ({
        tenant_id: t.tenant_id,
        tenant_name: t.name,
        payment_date: t.last_payment,
        amount_paid: t.last_payment_amount
      }))
      .sort((p1: any, p2: any) => new Date(p2.payment_date).getTime() - new Date(p1.payment_date).getTime());

    return {
      room: {
        id: room.id,
        room_id: room.id,
        room_no: room.room_no,
        floor: floorNum,
        capacity: capacity.capacity,
        base_rent: room.base_rent,
        monthly_rent: room.base_rent,
        occupied: capacity.occupied,
        reserved: capacity.reserved,
        used: capacity.used,
        remaining_capacity: capacity.available,
        status: capacity.state === "full" ? "Full" : capacity.state === "vacant" ? "Vacant" : capacity.state === "reserved" ? "Reserved" : "Occupied"
      },
      tenants: displayTenants,
      payments,
      pending_dues: tenants.reduce((sum: number, t: any) => sum + t.pending_dues, 0)
    };
  }
  
  async updateRoom(roomId: string, data: any, ownerId: string) {
    const room = await prisma.rooms.findUnique({
      where: { id: roomId },
      include: { hostels: { select: { owner_id: true, status: true } } },
    });

    if (!room || room.hostels.owner_id !== ownerId) throw new Error("NOT_FOUND: Room not found");
    if (room.hostels.status === "ARCHIVED") throw new Error("HOSTEL_ARCHIVED: Cannot modify rooms of an archived hostel");
    if (room.hostels.status === "INACTIVE") throw new Error("VALIDATION: Cannot modify rooms of an inactive hostel");

    const capacitySnapshot = await roomCapacityService.getRoomCapacitySnapshot(roomId, { ownerId });

    if (data.capacity !== undefined) {
      if (data.capacity < capacitySnapshot.used) {
        throw new Error(`VALIDATION: Capacity (${data.capacity}) cannot be less than occupied plus reserved beds (${capacitySnapshot.used})`);
      }
      if (data.capacity > 20) {
        throw new Error(`VALIDATION: Capacity cannot exceed 20`);
      }
    }

    if (data.room_no !== undefined && data.room_no !== room.room_no) {
      const duplicate = await prisma.rooms.findFirst({
        where: { hostel_id: room.hostel_id, room_no: data.room_no }
      });
      if (duplicate) throw new Error(`VALIDATION: Room ${data.room_no} already exists`);
    }

    const { capacity, floor, floor_id, room_no, base_rent, wifi_name, wifi_password, notes } = data;
    const updateData: any = {
      ...(capacity  !== undefined && { capacity:  Number(capacity) }),
      ...(floor     !== undefined && { floor:     Number(floor) }),
      ...(floor_id  !== undefined && { floor_id }),
      ...(room_no   !== undefined && { room_no }),
      ...(base_rent !== undefined && { base_rent: Number(base_rent) }),
      ...(wifi_name     !== undefined && { wifi_name:     wifi_name     ?? null }),
      ...(wifi_password !== undefined && { wifi_password: wifi_password ?? null }),
      ...(notes         !== undefined && { notes:         notes         ?? null }),
      updated_at: new Date(),
    };

    // Remove updated_at if nothing meaningful changed
    const meaningfulKeys = Object.keys(updateData).filter((k) => k !== "updated_at");
    if (meaningfulKeys.length === 0) return room;

    return await prisma.$transaction(async (tx: any) => {
      const updated = await tx.rooms.update({
        where: { id: roomId },
        data: updateData
      });

      await tx.room_activity_logs.create({
        data: {
          id: crypto.randomUUID(),
          room_id: roomId,
          owner_id: ownerId,
          action: "ROOM_EDITED",
          previous_value: JSON.stringify({ room_no: room.room_no, capacity: room.capacity, floor: room.floor, base_rent: room.base_rent }),
          new_value: JSON.stringify(Object.fromEntries(meaningfulKeys.map((k) => [k, updateData[k]])))
        }
      });

      return updated;
    });
  }

}

function cleanNullable(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

/**
 * Maps hostel status transitions to named lifecycle events.
 * These events form the audit trail for hostel lifecycle changes.
 */
function resolveLifecycleEvent(from: string, to: string): string | null {
  const key = `${from}->${to}`;
  const eventMap: Record<string, string> = {
    "ACTIVE->ARCHIVED":   "HOSTEL_ARCHIVED",
    "INACTIVE->ARCHIVED": "HOSTEL_ARCHIVED",
    "ARCHIVED->ACTIVE":   "HOSTEL_RESTORED",
    "ARCHIVED->INACTIVE": "HOSTEL_RESTORED",
    "ACTIVE->INACTIVE":   "HOSTEL_DEACTIVATED",
    "INACTIVE->ACTIVE":   "HOSTEL_ACTIVATED",
  };
  return eventMap[key] || null;
}

export const propertyService = new PropertyService();
