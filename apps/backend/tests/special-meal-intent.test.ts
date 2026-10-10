import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { INTENTS, mealChoiceIntentResolver } from "@/lib/services/notifications/routing/intent-resolvers";
import { encodeMealPayload, encodeReadyPayload } from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

const OCC = "11111111-1111-4111-8111-111111111111";
const TEN = "22222222-2222-4222-8222-222222222222";
const resolve = (body: string) =>
  mealChoiceIntentResolver.resolve({ message: { from: "91900", messageId: "m", timestamp: "0", body, messageType: "text" }, identity: {} as any } as any);

describe("mealChoiceIntentResolver", () => {
  it("claims choice taps, On-my-way taps and typed answers", async () => {
    for (const body of [
      encodeMealPayload({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN, choice: "VEG" }),
      encodeReadyPayload({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN }),
      "non veg",
    ]) {
      expect((await resolve(body)).map((i) => i.name)).toEqual([INTENTS.MEAL_CHOICE]);
    }
  });

  it("leaves everything else to the rest of the router", async () => {
    for (const body of ["RENT", "CC:RENT", "hello"]) expect(await resolve(body)).toEqual([]);
  });
});
