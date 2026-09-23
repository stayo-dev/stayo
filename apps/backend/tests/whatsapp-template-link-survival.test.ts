import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * URLs that an APPROVED WhatsApp template points at, served by the BACKEND.
 *
 * A Meta template's button URL is fixed at approval time. Editing it re-triggers
 * review and strands every message already delivered — so when a template's path
 * and the app disagree, **the app is what moves.**
 *
 * `apps/frontend/src/app/router/templateLinkRoutes.test.ts` already guards the
 * template paths served by the SPA. It cannot guard this one: `/pay/:token` is
 * rewritten by `vercel.json` to a server-rendered backend route, so there is no
 * React route for it to find and its absence would look exactly like a path the
 * SPA simply does not own.
 *
 * That gap is the whole reason this file exists. `/pay/:token` is the "Pay now"
 * button in every live rent reminder and in the WhatsApp bot's PAY command. If it
 * is deleted, renamed or disconnected, the only way anyone finds out is a tenant
 * saying the link is dead.
 *
 * Pure: reads source and config as text. No client, no database.
 */

const repoRoot = resolve(__dirname, "../../..");
const backend = resolve(repoRoot, "apps/backend");

/** Paths an approved template targets that the BACKEND serves. */
const BACKEND_TEMPLATE_PATHS = [
  {
    // stayo_rent_due_reminder, stayo_rent_due_today, stayo_rent_overdue_reminder,
    // plus the command centre's PAY reply.
    publicPath: "/pay/:token",
    rewriteTarget: "/api/payments/pay/:token",
    routeFile: "app/api/payments/pay/[token]/route.ts",
  },
];

/**
 * Gateway routes this codebase deliberately disconnects (410 Gone).
 *
 * Kept here as well as in the route files so the intersection below can be
 * asserted: **no disconnected route may ever be a template target.**
 */
const DISCONNECTED_ROUTES = [
  "app/api/payments/create-intent/route.ts",
  "app/api/payments/verify/route.ts",
  "app/api/payments/test-intent/route.ts",
  "app/api/webhooks/payments/razorpay/route.ts",
];

describe("backend-served WhatsApp template links", () => {
  const vercelJson = readFileSync(resolve(repoRoot, "apps/frontend/vercel.json"), "utf8");

  it.each(BACKEND_TEMPLATE_PATHS)(
    "$publicPath is still rewritten to the backend",
    ({ rewriteTarget }) => {
      expect(vercelJson).toContain(rewriteTarget);
    },
  );

  it.each(BACKEND_TEMPLATE_PATHS)("$publicPath still has a route to serve it", ({ routeFile }) => {
    expect(existsSync(resolve(backend, routeFile))).toBe(true);
  });

  it.each(BACKEND_TEMPLATE_PATHS)(
    "$publicPath is not disconnected along with the gateway",
    ({ routeFile }) => {
      // The page's payment mechanism changes; the page itself must keep serving.
      // A 410 here would kill the button in tenants' existing WhatsApp messages.
      expect(DISCONNECTED_ROUTES).not.toContain(routeFile);

      const source = readFileSync(resolve(backend, routeFile), "utf8");

      // What must hold is that a tenant arriving from WhatsApp is still served
      // a page. Checked by what the route DOES, not by scanning for a marker
      // string: the POST handler legitimately answers 410 for an unsupported
      // action now that the gateway actions are gone, and a blanket
      // `not.toContain("GATEWAY_DISCONNECTED")` failed on that — flagging a
      // correct change as a regression.
      expect(source).toMatch(/export async function GET/);
      expect(source).toContain("renderPage(");
      expect(source).toContain("text/html");
    },
  );
});

describe("the URL builders that feed those templates", () => {
  /**
   * The path is duplicated across two senders. Both must keep producing exactly
   * `/pay/<token>`: the approved template's button URL is a fixed base plus the
   * token as `{{1}}`, so changing the path on our side silently breaks it.
   */
  const BUILDERS = [
    "lib/services/notifications/whatsapp-reminder-delivery.ts",
    "lib/services/notifications/command-center/service.ts",
  ];

  it.each(BUILDERS)("%s still builds a /pay/ link", (file) => {
    const source = readFileSync(resolve(backend, file), "utf8");
    expect(source).toContain("/pay/");
  });
});

describe("disconnected gateway routes", () => {
  it.each(DISCONNECTED_ROUTES)("%s returns 410 and reaches no provider", (routeFile) => {
    const path = resolve(backend, routeFile);
    expect(existsSync(path)).toBe(true);

    const source = readFileSync(path, "utf8");
    expect(source).toContain("GATEWAY_DISCONNECTED");
    expect(source).toContain("410");

    // The point of disconnecting is that no request can reach the provider or
    // the attempt machinery. Importing either would mean it still can.
    expect(source).not.toMatch(/from\s+["']@\/src\/services\/payments\/payment-service["']/);
    expect(source).not.toMatch(/providers\/razorpay/);
    expect(source).not.toMatch(/getProviderContext/);
  });

  it("never disconnects a route an approved template points at", () => {
    const templateRouteFiles = BACKEND_TEMPLATE_PATHS.map((p) => p.routeFile);
    for (const disconnected of DISCONNECTED_ROUTES) {
      expect(templateRouteFiles).not.toContain(disconnected);
    }
  });
});
