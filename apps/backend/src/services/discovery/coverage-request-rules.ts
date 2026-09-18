//
// Pure parsing for supply requests from the public homepage. Imports nothing
// with I/O, so it runs in the `test:pure` suite — which matters, because the
// DB-backed suite needs a test database that does not currently exist.

export const AREA_MIN = 2;
export const AREA_MAX = 120;
export const HOSTEL_NAME_MIN = 3;
export const HOSTEL_NAME_MAX = 120;

export const COVERAGE_SOURCES = ["HOME", "HOME_EMPTY", "SEARCH_EMPTY"] as const;
export type CoverageSource = (typeof COVERAGE_SOURCES)[number];

export type CoverageKind = "AREA" | "HOSTEL";

export interface RecordCoverageRequestInput {
  kind: CoverageKind;
  /** Set for AREA; null for HOSTEL. */
  areaQuery: string | null;
  normalizedQuery: string | null;
  /** Set for HOSTEL; null for AREA. */
  hostelName: string | null;
  /** The owner's number on a referral. Optional, always. */
  ownerContact: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  source: CoverageSource;
  seekerProfileId: string | null;
}

export type ParsedCoverageRequest =
  | { ok: true; value: Omit<RecordCoverageRequestInput, "seekerProfileId"> }
  | { ok: false; error: "INVALID_AREA" | "INVALID_CONTACT" | "INVALID_HOSTEL" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** Lower-cased and whitespace-collapsed, so the same campus aggregates. */
export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseContact(raw: unknown): { phone: string | null; email: string | null } | "invalid" {
  if (raw === undefined || raw === null) return { phone: null, email: null };
  if (typeof raw !== "string") return "invalid";
  const value = raw.trim();
  if (!value) return { phone: null, email: null };

  if (value.includes("@")) {
    return EMAIL.test(value) ? { phone: null, email: value.toLowerCase() } : "invalid";
  }
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return INDIAN_MOBILE.test(local) ? { phone: local, email: null } : "invalid";
}

/**
 * The server is the authority on what a supply request is.
 *
 * Two kinds share one endpoint and one table: AREA is demand for a place,
 * HOSTEL is a student naming a hostel that should be listed. Neither is gated
 * on a contact detail — the area and the hostel name are the valuable parts and
 * they are free to collect; making either conditional on a phone number trades
 * most of the signal for a little of the contact. An unrecognised `source` or
 * `kind` is coerced rather than rejected: the client has no business widening
 * an enum, and losing the whole signal over a bad label would be the wrong
 * trade.
 */
export function parseCoverageRequest(body: unknown): ParsedCoverageRequest {
  const input = (body ?? {}) as Record<string, unknown>;

  const rawSource = input.source;
  const source = COVERAGE_SOURCES.includes(rawSource as CoverageSource)
    ? (rawSource as CoverageSource)
    : "HOME";

  const kind: CoverageKind = input.kind === "HOSTEL" ? "HOSTEL" : "AREA";

  if (kind === "HOSTEL") {
    const rawName = input.hostel_name;
    if (typeof rawName !== "string") return { ok: false, error: "INVALID_HOSTEL" };
    const hostelName = rawName.trim();
    if (hostelName.length < HOSTEL_NAME_MIN || hostelName.length > HOSTEL_NAME_MAX) {
      return { ok: false, error: "INVALID_HOSTEL" };
    }
    const owner = parseContact(input.owner_contact);
    if (owner === "invalid") return { ok: false, error: "INVALID_CONTACT" };
    return {
      ok: true,
      value: {
        kind,
        areaQuery: null,
        normalizedQuery: null,
        hostelName,
        // A referral's contact is the OWNER's, and it is the whole point of the
        // prong: it turns a hostel name into a phone call.
        ownerContact: owner.phone ?? owner.email,
        contactPhone: null,
        contactEmail: null,
        source,
      },
    };
  }

  const rawArea = input.area_query;
  if (typeof rawArea !== "string") return { ok: false, error: "INVALID_AREA" };
  const areaQuery = rawArea.trim();
  if (areaQuery.length < AREA_MIN || areaQuery.length > AREA_MAX) {
    return { ok: false, error: "INVALID_AREA" };
  }

  const contact = parseContact(input.contact);
  if (contact === "invalid") return { ok: false, error: "INVALID_CONTACT" };

  return {
    ok: true,
    value: {
      kind,
      areaQuery,
      normalizedQuery: normalizeQuery(areaQuery),
      hostelName: null,
      ownerContact: null,
      contactPhone: contact.phone,
      contactEmail: contact.email,
      source,
    },
  };
}

export interface CoverageDetails {
  ownerContact: string | null;
  areaQuery: string | null;
  normalizedQuery: string | null;
}

export type ParsedCoverageDetails =
  | { ok: true; value: CoverageDetails }
  | { ok: false; error: "INVALID_CONTACT" | "INVALID_AREA" | "EMPTY" };

/**
 * The second step of a referral: the owner's number, or — when the student
 * does not have it — where the hostel is, which is nearly as useful for
 * finding them.
 *
 * At least one must be present. An empty patch is rejected rather than
 * treated as success, so a client bug cannot look like a completed step.
 */
export function parseCoverageDetails(body: unknown): ParsedCoverageDetails {
  const input = (body ?? {}) as Record<string, unknown>;

  const owner = parseContact(input.owner_contact);
  if (owner === "invalid") return { ok: false, error: "INVALID_CONTACT" };

  let areaQuery: string | null = null;
  const rawArea = input.area_query;
  if (rawArea !== undefined && rawArea !== null) {
    if (typeof rawArea !== "string") return { ok: false, error: "INVALID_AREA" };
    const trimmed = rawArea.trim();
    if (trimmed) {
      if (trimmed.length < AREA_MIN || trimmed.length > AREA_MAX) {
        return { ok: false, error: "INVALID_AREA" };
      }
      areaQuery = trimmed;
    }
  }

  const ownerContact = owner.phone ?? owner.email;
  if (!ownerContact && !areaQuery) return { ok: false, error: "EMPTY" };

  return {
    ok: true,
    value: {
      ownerContact,
      areaQuery,
      normalizedQuery: areaQuery ? normalizeQuery(areaQuery) : null,
    },
  };
}
