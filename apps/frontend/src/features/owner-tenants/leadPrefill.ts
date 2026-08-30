import type { InviteWizardData } from './types';

/** The subset of `admissionsService.detail()`'s shape this mapping reads. */
export interface AcceptedLeadSource {
  student_name?: string | null;
  student_phone?: string | null;
  student_email?: string | null;
  hostel_id?: string | null;
  preferred_floor?: { id: string; name: string } | null;
  preferred_room?: { id: string; room_no: string } | null;
  /**
   * Whether `preferred_room` is still assignable right now, computed
   * server-side (`admissions-service.getLeadForOwner`) through the same
   * `roomCapacityService` the final activation check uses — `undefined` when
   * there was nothing to check (no preferred room, or the lead already
   * converted).
   */
  preferred_room_available?: boolean | null;
}

/**
 * Maps an accepted lead onto the Invite Tenant wizard's initial form data,
 * so the owner never retypes what the tenant already supplied at enquiry.
 * Rent and agreement terms are deliberately left for the owner to fill in —
 * a lead never carries them.
 *
 * Room is the one exception, and only a conditional one: `roomId`/`roomLabel`
 * are prefilled directly — as if the owner had already picked it — but ONLY
 * when the backend confirmed `preferred_room_available === true`. Anything
 * else (no preference, or `false`/unknown) leaves `roomId` blank so the Stay
 * step's own vacant-room check is what ultimately decides, never a stale
 * preference. The preference metadata rides along regardless, so the Stay
 * step can default its floor tab and explain an unavailable preference.
 */
export function leadToInviteWizardData(lead: AcceptedLeadSource): Partial<InviteWizardData> {
  const data: Partial<InviteWizardData> = {};
  if (lead.student_name) data.tenantName = lead.student_name;
  if (lead.student_phone) data.tenantPhone = lead.student_phone;
  if (lead.student_email) data.tenantEmail = lead.student_email;
  if (lead.hostel_id) data.hostelId = lead.hostel_id;

  if (lead.preferred_floor?.id) data.preferredFloorId = lead.preferred_floor.id;
  if (lead.preferred_room?.id) {
    data.preferredRoomId = lead.preferred_room.id;
    data.preferredRoomNo = lead.preferred_room.room_no;
    data.preferredRoomAvailable = lead.preferred_room_available === true;
    if (lead.preferred_room_available === true) {
      data.roomId = lead.preferred_room.id;
      data.roomLabel = lead.preferred_room.room_no;
    }
  }

  return data;
}
