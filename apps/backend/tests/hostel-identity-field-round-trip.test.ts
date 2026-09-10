import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Hostel identity form writes and reads through **two different
 * endpoints**, and nothing structural connected them:
 *
 *   write → `PATCH /hostels/:id` → `propertyService.updateHostel`
 *   read  → `GET /hostels/:id/preferences` → `hostelPolicyService.getHostelPolicy`
 *
 * When `hostel_type` was added it was wired into the write and into
 * `GET /hostels/:id` — but not into the *preferences* projection the form
 * actually loads from. The value saved correctly and then came back absent, so
 * the selector reset to "Not set" and a successful save looked like a failed
 * one. The data was never wrong; only the screen was.
 *
 * That failure is invisible to type checking and to any single-endpoint test,
 * because each half is correct on its own. So this asserts the join: every
 * field the form edits must be writable by the write path *and* returned by
 * the read path.
 *
 * Reads source as text — no client, no database — the same approach as
 * `whatsapp-prisma-accessors.test.ts`.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

const policyService = read("lib", "services", "hostel-policy-service.ts");
const propertyService = read("lib", "services", "property-service.ts");
const portfolioService = read("lib", "services", "portfolio-service.ts");
const tenantService = read("src", "services", "tenants", "tenant-service.ts");

/** Every column the Hostel identity screen can change. */
const IDENTITY_FIELDS = [
  "name",
  "phone",
  "address",
  "city",
  "state",
  "pincode",
  "upi_id",
  "gst_number",
  "hostel_type",
];

describe("hostel identity fields round-trip", () => {
  it.each(IDENTITY_FIELDS)("`%s` is accepted by the write path", (field) => {
    // propertyService.updateHostel maps body fields onto the update.
    expect(propertyService).toContain(`data.${field}`);
  });

  it.each(IDENTITY_FIELDS)("`%s` is selected from the database by the read path", (field) => {
    // The preferences query uses an explicit select, so an unlisted column is
    // simply undefined at runtime — silently, with no error anywhere.
    expect(policyService).toMatch(new RegExp(`${field}:\\s*true`));
  });

  it.each(IDENTITY_FIELDS)("`%s` is returned in the read path's hostel projection", (field) => {
    // Selecting it is not enough: it must also survive the hand-built object
    // the endpoint responds with. That is the step `hostel_type` was missing.
    expect(policyService).toMatch(new RegExp(`${field}:\\s*hostel\\.${field}`));
  });
});

/**
 * `hostel_type` decides whether every tenant of a hostel is asked their gender,
 * so it is read in more places than the identity form — and it was dropped in a
 * different one each time it was added.
 *
 * It went in twice and broke twice: first the identity form saved it and read
 * back a screen without it, then the Hostels tab prompted "Who stays here?" for
 * a hostel that already had an answer. Both times the write was correct and a
 * *reader* was missing the field, which no type check and no single-endpoint
 * test can see.
 *
 * `portfolio-service.ts` and `portfolio-performance-service.ts` are near
 * duplicates and the wrong one was edited the second time — the route that
 * feeds the Hostels tab uses the former. So both are pinned here by name.
 */
describe("hostel_type reaches every screen that reads it", () => {
  const READERS: Array<[string, string]> = [
    ["the identity form (GET /hostels/:id/preferences)", policyService],
    ["the Hostels tab (GET /owner/portfolio/summary)", portfolioService],
  ];

  it.each(READERS)("%s selects hostel_type from the database", (_name, source) => {
    expect(source).toMatch(/hostel_type:\s*true/);
  });

  it.each(READERS)("%s returns hostel_type in its projection", (_name, source) => {
    // Selecting it is not enough — it must survive the hand-built response
    // object, which is the step that was missed both times.
    expect(source).toMatch(/hostel_type:\s*h(ostel)?(Status)?\??\.hostel_type/);
  });
});

/**
 * The owner's tenant screen decides between the invitation-management view and
 * the full profile, and [[ADR-165]] moved the signal it needs.
 *
 * Inviting now makes a tenancy ACTIVE immediately, so `status` can no longer
 * answer "has this person taken over their account". `acceptance_status` and
 * `access_mode` can — and both were on the row (fetched by `include`) but
 * dropped from the overview's hand-built response, so every reader saw null and
 * the invitation screen became unreachable.
 *
 * Third instance of the same shape in one day: a field present in the database,
 * correct on the write path, and missing from one reader's projection. Pinned
 * for the same reason as the others.
 */
describe("the owner tenant overview projects what the screen switches on", () => {
  it.each(["acceptance_status", "access_mode"])("returns `%s`", (field) => {
    expect(tenantService).toMatch(new RegExp(`${field}:\\s*\\(legacyTenant as any\\)\\.${field}`));
  });
});
