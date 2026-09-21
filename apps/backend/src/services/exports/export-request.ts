import { assertHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { parseExportParams } from "./export-params";
import type { ExportRequest } from "./owner-money-export-service";

/**
 * Turning query parameters into a validated export request.
 *
 * Lives here rather than in the route because both `/exports` and
 * `/exports/preview` must parse identically — a preview that counted a
 * different period than the file it previews would be worse than no preview.
 * Next's App Router also treats a route module's exports as route handlers, so
 * a shared helper does not belong in one.
 *
 * Every *rule* is in `export-params.ts`, which imports no I/O and is tested
 * without a database. This file adds only the one check that needs one.
 */

export { parseExportParams, resolvePeriod } from "./export-params";
export type { ExportParams, ExpenseQueryParams } from "./export-params";

export async function parseExportRequest(params: URLSearchParams, ownerId: string): Promise<ExportRequest> {
  const parsed = parseExportParams(params);
  // A hostel id is the one caller-supplied value that could otherwise reach
  // another owner's data, so it is checked rather than trusted.
  if (parsed.hostelId) await assertHostelBelongsToOwner(ownerId, parsed.hostelId);
  return { ownerId, ...parsed };
}
