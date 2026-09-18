import { describe, expect, it } from "vitest";
import { mapActivationError } from "@/src/services/tenants/activation-error";

/**
 * Activation services throw `"CODE: message"`. A route that only try/catches
 * turns an expired invitation into a 500, so the tenant is told nothing useful.
 */
describe("mapActivationError", () => {
  it("maps an expired or reused link to 410, not 500", () => {
    expect(mapActivationError(new Error("INVALID: Activation link expired or already used")))
      .toEqual({ message: "Activation link expired or already used", code: "INVALID", status: 410 });
  });

  it("maps a validation failure to 400", () => {
    expect(mapActivationError(new Error("VALIDATION_ERROR: token is required")).status).toBe(400);
  });

  it("maps an already-active tenancy to 409", () => {
    expect(mapActivationError(new Error("ALREADY_ACTIVE: already set up")).status).toBe(409);
  });

  it("maps a missing record to 404", () => {
    expect(mapActivationError(new Error("NOT_FOUND: no agreement")).status).toBe(404);
  });

  it("keeps a colon inside the message intact", () => {
    expect(mapActivationError(new Error("INVALID: link expired: try again")).message)
      .toBe("link expired: try again");
  });

  it("falls back to 500 for an unprefixed error", () => {
    const out = mapActivationError(new Error("something exploded"));
    expect(out).toEqual({ message: "something exploded", code: "ACTIVATION_ERROR", status: 500 });
  });

  it("falls back to 500 for a code it does not know", () => {
    expect(mapActivationError(new Error("WEIRD_CODE: hmm")).status).toBe(500);
  });

  it("uses the supplied fallback when the error has no message", () => {
    expect(mapActivationError({}, "Failed to load the agreement").message)
      .toBe("Failed to load the agreement");
  });
});
