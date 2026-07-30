import { prisma } from "../db";

export const GOOGLE_FORM_IMPORT_SCHEMA = [
  "full_name",
  "phone_number",
  "email_address",
  "current_room",
  "onboarding_password",
] as const;

export const GOOGLE_FORM_OPERATIONAL_WARNING =
  "Do not edit generated field names or dropdown values after form creation. HMS import validation depends on exact schema consistency.";

const NO_NOTES = "None";

function cleanNotes(notes?: unknown) {
  const text = typeof notes === "string" ? notes.trim() : "";
  return text || NO_NOTES;
}

function buildPrompt(hostelName: string, roomNumbers: string[], notes?: unknown) {
  const roomList = roomNumbers.join("\n");
  const optionalNotes = cleanNotes(notes);

  return `Create a Google Form for tenant onboarding for the hostel below.

Hostel Name:
${hostelName}

Rooms:
${roomList}

Optional Notes:
${optionalNotes}

Create the form with EXACTLY the following fields, in this exact order.
Every field must be marked Required: Yes.

1. Full Name
Type: Short answer
Required: Yes

2. Phone Number
Type: Short answer
Required: Yes
Validation: Must be exactly 10 digits only

3. Current Room
Type: Dropdown
Required: Yes
Dropdown options: Use ONLY the exact room values listed above.
Do not rename, reformat, sort, expand, or modify room values.

4. Temporary Onboarding Password
Type: Short answer
Required: Yes
Validation: Minimum 6 characters

Do not create a separate Email Address question.
If email collection is needed, use Google Forms responder email collection only.

Strict generation rules:

DO NOT rename fields.
DO NOT add fields.
DO NOT remove fields.
DO NOT add emojis.
DO NOT add sections.
DO NOT add decorative content.
DO NOT change field order.
DO NOT infer additional tenant data.
DO NOT create extra onboarding questions.
DO NOT create a custom Email Address field.
DO NOT modify dropdown room values.
DO NOT add descriptions that change the meaning of fields.
Optional notes are context only. Do not create additional fields from optional notes.
ALL fields must be required. Do not make any field optional.

The HMS import system depends on exact field consistency. Generate only this operational tenant onboarding form.

Expected import schema:
${GOOGLE_FORM_IMPORT_SCHEMA.join("\n")}

Email address is not a custom form question. HMS reads email_address from the Google Forms responder email column when that setting is enabled.

Operational warning:
${GOOGLE_FORM_OPERATIONAL_WARNING}`;
}

export class GoogleFormPromptService {
  async generateTenantOnboardingPrompt(input: {
    ownerId: string;
    hostelId: string;
    notes?: unknown;
  }) {
    const hostel = await prisma.hostels.findFirst({
      where: {
        id: input.hostelId,
        owner_id: input.ownerId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        rooms: {
          where: { is_active: true },
          orderBy: { room_no: "asc" },
          select: { room_no: true },
        },
      },
    });

    if (!hostel) {
      throw new Error("FORBIDDEN: Hostel is not owned by the authenticated owner");
    }

    const roomNumbers = hostel.rooms.map((room) => room.room_no);
    if (roomNumbers.length === 0) {
      throw new Error("VALIDATION_ERROR: Add at least one active room before generating a Google Form prompt");
    }

    return {
      prompt: buildPrompt(hostel.name, roomNumbers, input.notes),
      hostel: {
        id: hostel.id,
        name: hostel.name,
      },
      room_count: roomNumbers.length,
      schema: [...GOOGLE_FORM_IMPORT_SCHEMA],
      warning: GOOGLE_FORM_OPERATIONAL_WARNING,
    };
  }
}

export const googleFormPromptService = new GoogleFormPromptService();
