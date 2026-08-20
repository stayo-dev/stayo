import type { InviteWizardData } from './types';

/** The subset of `admissionsService.detail()`'s shape this mapping reads. */
export interface AcceptedLeadSource {
  student_name?: string | null;
  student_phone?: string | null;
  student_email?: string | null;
  hostel_id?: string | null;
}

/**
 * Maps an accepted lead onto the Invite Tenant wizard's initial form data,
 * so the owner never retypes what the tenant already supplied at enquiry.
 * Room, rent, and agreement terms are deliberately left for the owner to
 * fill in — a lead never carries them.
 */
export function leadToInviteWizardData(lead: AcceptedLeadSource): Partial<InviteWizardData> {
  const data: Partial<InviteWizardData> = {};
  if (lead.student_name) data.tenantName = lead.student_name;
  if (lead.student_phone) data.tenantPhone = lead.student_phone;
  if (lead.student_email) data.tenantEmail = lead.student_email;
  if (lead.hostel_id) data.hostelId = lead.hostel_id;
  return data;
}
