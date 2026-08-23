import { assertHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { EXPORT_DOCUMENTS, type ExportDocumentId, type ExportRequest } from "./owner-money-export-service";
import { resolvePreset, customPeriod, type Period, type PeriodPresetId } from "./financial-year";

/**
 * Turning query parameters into a validated export request.
 *
 * Lives here rather than in the route because both `/exports` and
 * `/exports/preview` must parse identically — a preview that counted a
 * different period than the file it previews would be worse than no preview.
 * Next's App Router also treats a route module's exports as route handlers, so
 * a shared helper does not belong in one.
 */

const PRESETS: PeriodPresetId[] = ["this_month", "last_month", "this_fy", "last_fy"];

/**
 * Presets resolve on the SERVER rather than being sent as dates.
 *
 * "This financial year" then always means April–March, whatever a client
 * believes a year is — the mistake this feature is most likely to make
 * silently, and the one an accountant discovers months later.
 */
export function resolvePeriod(params: URLSearchParams): Period {
  const preset = params.get("preset");
  if (preset) {
    if (!PRESETS.includes(preset as PeriodPresetId)) throw new Error("VALIDATION: Unknown period");
    return resolvePreset(preset as PeriodPresetId);
  }
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) throw new Error("VALIDATION: Give a preset, or a from and to date");
  return customPeriod(from, to);
}

export async function parseExportRequest(params: URLSearchParams, ownerId: string): Promise<ExportRequest> {
  const document = params.get("document") as ExportDocumentId;
  if (!document || !(document in EXPORT_DOCUMENTS)) throw new Error("VALIDATION: Unknown document");

  // A hostel id is the one caller-supplied value that could otherwise reach
  // another owner's data, so it is checked rather than trusted.
  const hostelId = params.get("hostelId") || null;
  if (hostelId) await assertHostelBelongsToOwner(ownerId, hostelId);

  return { ownerId, document, period: resolvePeriod(params), hostelId };
}
