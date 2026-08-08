import { describe, expect, it } from "vitest";
import {
  describeSupabaseAuthConfig,
  supabaseIssuer,
  supabaseProjectRef,
} from "@/lib/config/supabase-auth-config";

/**
 * Guards the exact production failure of 2026-08-08: every Supabase access
 * token was rejected with "Invalid session" because the backend derived a
 * different issuer than the one minting the tokens. A trailing slash on
 * SUPABASE_URL is enough to do it (`…supabase.co//auth/v1`), and nothing in
 * the system reported the derived issuer, so the fault was invisible.
 */
describe("supabase issuer derivation", () => {
  it("appends the auth path to the project URL", () => {
    expect(supabaseIssuer("https://abcdefgh.supabase.co")).toBe(
      "https://abcdefgh.supabase.co/auth/v1",
    );
  });

  it("does not double the slash when the URL has a trailing one", () => {
    expect(supabaseIssuer("https://abcdefgh.supabase.co/")).toBe(
      "https://abcdefgh.supabase.co/auth/v1",
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(supabaseIssuer("  https://abcdefgh.supabase.co  ")).toBe(
      "https://abcdefgh.supabase.co/auth/v1",
    );
  });

  it("has no issuer when the URL is unset", () => {
    expect(supabaseIssuer(undefined)).toBeNull();
    expect(supabaseIssuer("")).toBeNull();
  });
});

describe("supabase project ref", () => {
  it("reads the ref from a hosted project URL", () => {
    expect(supabaseProjectRef("https://abcdefgh.supabase.co")).toBe("abcdefgh");
  });

  it("is null for a self-hosted URL that carries no ref", () => {
    expect(supabaseProjectRef("https://auth.internal.example.com")).toBeNull();
  });
});

describe("auth config diagnostics", () => {
  it("reports the effective issuer and ref when configured", () => {
    expect(describeSupabaseAuthConfig("https://abcdefgh.supabase.co/")).toEqual({
      configured: true,
      project_ref: "abcdefgh",
      expected_issuer: "https://abcdefgh.supabase.co/auth/v1",
    });
  });

  it("reports not-configured rather than guessing when the URL is missing", () => {
    expect(describeSupabaseAuthConfig(undefined)).toEqual({
      configured: false,
      project_ref: null,
      expected_issuer: null,
    });
  });
});
