import { describe, it, expect } from "vitest";
import { resolveActivationSubject } from "@/src/services/tenants/activation-subject";

/**
 * The risk in adding a second way into activation is not that the new way
 * fails — it is that the old way quietly changes. Both directions asserted.
 * See ADR-155.
 */
describe("resolveActivationSubject", () => {
  it("uses the token when one is presented, as it always did", () => {
    expect(resolveActivationSubject({ token: "abc123" })).toEqual({
      ok: true,
      mode: "token",
      token: "abc123",
    });
  });

  it("keeps using the token even when a session is also present", () => {
    // The guarantee that the ordinary invited-tenant flow is untouched: a
    // logged-in browser opening an invite link must not be diverted into
    // session mode and silently resolve some *other* tenancy.
    expect(resolveActivationSubject({ token: "abc123", sessionTenantId: "t-999" })).toMatchObject({
      mode: "token",
      token: "abc123",
    });
  });

  it("falls back to the session only when no token is presented", () => {
    expect(resolveActivationSubject({ sessionTenantId: "t-1" })).toEqual({
      ok: true,
      mode: "session",
      tenantId: "t-1",
    });
  });

  it("refuses a request carrying neither proof, with the wording it always used", () => {
    expect(resolveActivationSubject({})).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Activation token is required",
    });
  });

  it("treats a blank or whitespace token as absent rather than as a credential", () => {
    expect(resolveActivationSubject({ token: "   " })).toMatchObject({ ok: false });
    expect(resolveActivationSubject({ token: "   ", sessionTenantId: "t-1" })).toMatchObject({
      mode: "session",
      tenantId: "t-1",
    });
  });

  it("trims a token rather than passing padding through to a lookup", () => {
    expect(resolveActivationSubject({ token: "  abc123  " })).toMatchObject({ token: "abc123" });
  });

  it("survives null and undefined inputs", () => {
    expect(resolveActivationSubject({ token: null, sessionTenantId: null })).toMatchObject({ ok: false });
    expect(resolveActivationSubject({} as any)).toMatchObject({ ok: false });
  });
});
