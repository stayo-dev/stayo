/**
 * The backend must build without any environment variables.
 *
 * `next build` imports every route module to collect page data, without ever
 * calling into it. So any client constructed at *module scope* from env turns
 * "no env at build time" into a hard build failure — and the error is reported
 * against whichever route happened to be collected first, which is almost never
 * the one at fault. That is what broke every Vercel **Preview** deployment on
 * 2026-09-09: Preview had no variables, so the build died with
 * `supabaseUrl is required` blamed on `/api/agreements/[id]/renewal-offer`.
 *
 * Three constructors were eager. Each is now resolved on first use, so a
 * missing variable surfaces at the call site that needs it — a runtime
 * configuration error, which is what it always was.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/** Strip comments, so prose describing the old pattern is not mistaken for it. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("no client is constructed at module scope from env", () => {
  it("the service-role Supabase client is lazy", () => {
    const db = code("lib/db.ts");
    expect(db).not.toMatch(/^export const supabase = createClient\(/m);
    expect(db).toContain("resolveSupabaseClient");
  });

  it("the Resend client is lazy", () => {
    const email = code("lib/services/email-service.ts");
    expect(email).not.toMatch(/^const resend = new Resend\(/m);
    expect(email).toContain("function resend()");
  });

  it("the WhatsApp provider reads its config on first use, not in the constructor", () => {
    // The delivery singletons are themselves module-scope, so a constructor
    // default of `configFromEnv()` threw during collection.
    const provider = code("lib/services/notifications/providers/whatsapp/meta-provider.ts");
    expect(provider).not.toContain("constructor(config: WhatsAppProviderConfig = configFromEnv())");
    expect(provider).toMatch(/private get config\(\)/);
  });

  it("still throws a nameable error when config really is missing", () => {
    // Laziness must not become silence: a missing variable is still fatal, just
    // at the point of use.
    expect(code("lib/db.ts")).toContain("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  });
});
