import { AREA_MAX, AREA_MIN, classifyContact } from './coverageRequest';

/**
 * The second step of a hostel referral.
 *
 * The referral itself is saved by the first step, so this step is genuinely
 * optional — which is the point. Asking for the owner's number *after* the
 * student has already acted turns a blocking field into a follow-up, and a
 * skip costs the signal nothing.
 *
 * A student who does not have the number almost always knows where the place
 * is, so "I don't know it" asks for the area instead of dead-ending. Both
 * answers help us find the same person.
 */
export type FollowUpMode = 'number' | 'area';

export interface FollowUpDraft {
  mode: FollowUpMode;
  value: string;
}

export interface FollowUpPayload {
  owner_contact?: string;
  area_query?: string;
}

export interface FollowUpValidation {
  valid: boolean;
  error?: string;
  payload: FollowUpPayload | null;
}

export function validateFollowUp(draft: FollowUpDraft): FollowUpValidation {
  const value = draft.value.trim();

  if (!value) {
    return {
      valid: false,
      error: draft.mode === 'number' ? "Add the number, or tap “I don’t know it”." : 'Add the area or a landmark.',
      payload: null,
    };
  }

  if (draft.mode === 'number') {
    const kind = classifyContact(value);
    if (kind !== 'phone') {
      return { valid: false, error: 'That does not look like a mobile number.', payload: null };
    }
    return { valid: true, payload: { owner_contact: value } };
  }

  if (value.length < AREA_MIN) {
    return { valid: false, error: 'A little more — an area or a landmark.', payload: null };
  }
  if (value.length > AREA_MAX) {
    return { valid: false, error: `Keep this under ${AREA_MAX} characters.`, payload: null };
  }
  return { valid: true, payload: { area_query: value } };
}
