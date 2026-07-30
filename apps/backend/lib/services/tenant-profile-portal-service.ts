import { prisma } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { backendUrl } from "@/lib/config/domains";
import { currentAgreementWhere } from "@/src/services/tenants/agreement-status";
import { reservationStatusService } from "@/src/services/tenants/reservation-status-service";

const DOC_TYPE_LABELS: Record<string, string> = {
  AADHAAR: "Aadhaar",
  COLLEGE_ID: "College ID",
  WORK_ID: "Work ID",
};

function requiredDocumentTypes(profileType?: string | null) {
  return String(profileType || "STUDENT").toUpperCase() === "WORKING_PROFESSIONAL"
    ? ["AADHAAR", "WORK_ID"]
    : ["AADHAAR", "COLLEGE_ID"];
}

export async function getTenantPortalProfile(profileId: string) {
  const tenant = await prisma.tenants.findUnique({
    where: { profile_id: profileId },
    include: {
      profiles: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          emergency_contact: true,
          city: true,
          state: true,
          pincode: true,
          mobile_verified: true,
          phone_verified: true,
        },
      },
      hostels: {
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          pincode: true,
          logo_url: true,
          upi_id: true,
          preferences_config: true,
          owner_id: true,
          profiles: {
            select: { name: true, phone: true, email: true, emergency_contact: true },
          },
        },
      },
      room_allocations: {
        where: { is_active: true, end_date: null },
        orderBy: { start_date: "desc" },
        take: 1,
        include: {
          room: {
            select: {
              id: true,
              room_no: true,
              floor: true,
              capacity: true,
              room_type: true,
              wifi_name: true,
              wifi_password: true,
              notes: true,
              floor_ref: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
      identification_documents: {
        where: { is_active: true },
        orderBy: { created_at: "desc" },
      },
      agreements: {
        where: { status: currentAgreementWhere() },
        orderBy: { generated_at: "desc" },
      },
      move_out_requests: {
        where: { status: { notIn: ["REJECTED"] } },
        orderBy: { created_at: "desc" },
        take: 1,
      },
    },
  });

  if (!tenant) return null;

  const profile = tenant.profiles;
  const allocation = tenant.room_allocations[0];
  const room = allocation?.room;
  const hostel = tenant.hostels;
  const owner = hostel?.profiles;
  const prefs = (hostel?.preferences_config ?? {}) as Record<string, unknown>;
  const moveOut = tenant.move_out_requests[0] ?? null;

  const roommateCount = room
    ? await prisma.roomAllocation.count({
        where: {
          room_id: room.id,
          is_active: true,
          end_date: null,
          tenant_id: { not: tenant.id },
        },
      })
    : 0;

  const advanceEntries = await prisma.tenant_financial_ledger.findMany({
    where: { tenant_id: tenant.id },
    orderBy: { created_at: "asc" },
  });
  const advanceBalance = advanceEntries.reduce((acc, e) => {
    const amt = Number(e.amount);
    return e.type === "CREDIT" ? acc + amt : acc - amt;
  }, 0);

  const requiredTypes = requiredDocumentTypes(tenant.profile_type);
  const documents = tenant.identification_documents.filter((d) => requiredTypes.includes(d.doc_type)).map((d) => ({
    id: d.id,
    doc_type: d.doc_type,
    doc_type_label: DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type,
    doc_number: d.doc_number,
    download_url: backendUrl(`/api/tenants/${tenant.id}/documents/${d.id}/download`),
    mime_type: d.mime_type,
    document_status: d.document_status,
    is_verified: d.is_verified,
    rejection_reason: d.rejection_reason,
    uploaded_at: d.created_at,
  }));

  const signedAgreement = tenant.agreements?.[0] || null;
  if (signedAgreement) {
    documents.push({
      id: signedAgreement.id,
      doc_type: "RENTAL_AGREEMENT",
      doc_type_label: "Hostel Residency Agreement",
      doc_number: null,
      download_url: backendUrl(`/api/tenants/${tenant.id}/documents/${signedAgreement.id}/download`),
      mime_type: "application/pdf",
      document_status: "APPROVED",
      is_verified: true,
      rejection_reason: null,
      uploaded_at: signedAgreement.tenant_signed_at || signedAgreement.generated_at,
    });
  }

  const verification = {
    document_verified: tenant.document_verified,
    mobile_verified: tenant.mobile_verified,
    profile_completed: tenant.profile_completed,
    overall:
      tenant.document_verified && tenant.profile_completed
        ? "VERIFIED"
        : documents.some((d) => d.document_status === "REJECTED")
          ? "ACTION_REQUIRED"
          : "PENDING",
  };

  return {
    tenant: {
      id: tenant.id,
      status: ((moveOut && moveOut.status !== "COMPLETED") || (tenant.exit_date && new Date(tenant.exit_date).getTime() > new Date().getTime())) ? "MOVE_OUT_REQUESTED" : tenant.status,
      profile_type: tenant.profile_type,
      joined_on: tenant.joined_on,
      billing_start_date: tenant.billing_start_date,
      monthly_rent: tenant.monthly_rent,
      maintenance_charge: tenant.maintenance_charge,
      advance_deposit: tenant.security_deposit,
      security_deposit: tenant.security_deposit,
      photo_url: tenant.photo_url,
      gender: tenant.gender,
      date_of_birth: tenant.date_of_birth,
      phone_1: tenant.phone_1,
      phone_2: tenant.phone_2,
      phone_3: tenant.phone_3,
      personal_email: tenant.personal_email,
      college_name: tenant.college_name,
      roll_number: tenant.roll_number,
      course: tenant.course,
      year_of_study: tenant.year_of_study,
      section: tenant.section,
      branch: tenant.branch,
      office_name: tenant.office_name,
      office_location: tenant.office_location,
      job_role: tenant.job_role,
      permanent_address: tenant.permanent_address,
      temporary_address: tenant.temporary_address,
      exit_date: tenant.exit_date,
      exit_reason: tenant.exit_reason,
      exit_notes: tenant.exit_notes,
    },
    profile: {
      id: profile.id,
      name: profile.name,
      account_email: profile.email,
      phone: profile.phone,
      emergency_contact: profile.emergency_contact,
      city: profile.city,
      state: profile.state,
      pincode: profile.pincode,
    },
    contacts: {
      tenant_phone: { label: "Tenant Phone", value: tenant.phone_1 ?? profile.phone },
      guardian_phone: { label: "Guardian Phone", value: tenant.phone_2 },
      emergency_phone: { label: "Emergency Contact", value: tenant.phone_3 ?? profile.emergency_contact },
    },
    hostel: hostel
      ? {
          id: hostel.id,
          name: hostel.name,
          logo_url: hostel.logo_url,
          phone: hostel.phone,
          address: hostel.address,
          city: hostel.city,
          state: hostel.state,
          pincode: hostel.pincode,
          upi_id: hostel.upi_id,
          office_hours: (prefs.office_hours as string) ?? (prefs.officeHours as string) ?? null,
        }
      : null,
    owner_contact: owner
      ? {
          owner_name: owner.name,
          owner_phone: owner.phone ?? hostel?.phone,
          owner_email: owner.email,
          emergency_contact: owner.emergency_contact,
          manager_name: (prefs.manager_name as string) ?? (prefs.managerName as string) ?? null,
        }
      : null,
    room: room
      ? {
          room_no: room.room_no,
          floor: room.floor_ref?.name ?? (room.floor != null ? `${room.floor} Floor` : null),
          room_type: room.room_type,
          capacity: room.capacity,
          current_occupancy: roommateCount + 1,
          wifi_name: room.wifi_name,
          wifi_password: room.wifi_password,
          notes: room.notes,
          allocation_start: allocation?.start_date,
        }
      : null,
    advance: {
      balance: Math.round(advanceBalance * 100) / 100,
      security_deposit: Number(tenant.security_deposit ?? 0),
    },
    documents,
    required_documents: requiredTypes,
    verification,
    reservation_status: await reservationStatusService.getReservationStatus(tenant.id),
    move_out: moveOut
      ? {
          id: moveOut.id,
          status: moveOut.status,
          planned_exit_date: moveOut.planned_exit_date,
          reason: moveOut.reason,
        }
      : null,
  };
}

export function validateTenantPhones(data: {
  phone_1?: string | null;
  phone_2?: string | null;
  phone_3?: string | null;
  phone?: string | null;
}): string | null {
  const normalized: string[] = [];
  for (const key of ["phone_1", "phone_2", "phone_3", "phone"] as const) {
    const raw = data[key];
    if (!raw) continue;
    const n = normalizeIndianPhone(raw);
    if (!n) return `Invalid Indian phone number for ${key}`;
    if (normalized.includes(n)) return "Duplicate phone numbers are not allowed";
    normalized.push(n);
  }
  return null;
}
