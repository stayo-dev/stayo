import { describe, expect, it } from "vitest";
import {
  SPECIAL_MEAL_QUESTION_TEMPLATE as T,
  answeredReply,
  buildQuestionParameters,
  closedReply,
  decodeMealPayload,
  dishLine,
  encodeMealPayload,
  formatCutoff,
  occasionLabel,
  parseTypedChoice,
} from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

const OCC = "11111111-1111-4111-8111-111111111111";
const TEN = "22222222-2222-4222-8222-222222222222";

describe("template contract", () => {
  it("numbers every parameter in the body, in order", () => {
    T.parameters.forEach((_, i) => expect(T.body).toContain(`{{${i + 1}}}`));
    expect(T.body).not.toContain(`{{${T.parameters.length + 1}}}`);
  });
  it("neither starts nor ends the body with a variable (Meta rejects that)", () => {
    expect(T.body.trim().startsWith("{{")).toBe(false);
    expect(T.body.trim().endsWith("}}")).toBe(false);
  });
  it("offers Veg, Non-veg, I'm away in that order", () => {
    expect(T.quickReplies.map((q) => q.choice)).toEqual(["VEG", "NON_VEG", "AWAY"]);
  });
});

describe("payloads", () => {
  it("round-trips and stays under Meta's 128-character limit", () => {
    const raw = encodeMealPayload({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN, choice: "NON_VEG" });
    expect(raw.length).toBeLessThanOrEqual(128);
    expect(decodeMealPayload(raw)).toEqual({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN, choice: "NON_VEG" });
  });
  it("rejects anything malformed", () => {
    for (const bad of ["", "veg", "CC:RENT", `MEAL:${OCC}:2026-10-11:${TEN}:FISH`, `MEAL:nope:2026-10-11:${TEN}:VEG`, `MEAL:${OCC}:11-10-2026:${TEN}:VEG`]) {
      expect(decodeMealPayload(bad)).toBeNull();
    }
  });
});

describe("parseTypedChoice", () => {
  it.each([
    ["veg", "VEG"], ["Veg 🙂", "VEG"], ["VEG.", "VEG"],
    ["non veg", "NON_VEG"], ["Non-veg", "NON_VEG"], ["nonveg", "NON_VEG"], ["nv", "NON_VEG"],
    ["skip", "SKIP"], ["away", "AWAY"], ["I'm away", "AWAY"], ["i am away", "AWAY"], ["im away", "AWAY"],
  ])("%s → %s", (input, expected) => expect(parseTypedChoice(input)).toBe(expected));
  it.each(["rent", "veg biryani was great", "hello", "", "123456"])("ignores %s", (input) => {
    expect(parseTypedChoice(input)).toBeNull();
  });
});

describe("copy", () => {
  const cutoffAt = new Date("2026-10-11T04:00:00.000Z"); // 9:30 AM IST
  it("labels the occasion with its own date", () => {
    expect(occasionLabel("2026-10-11", "LUNCH")).toBe("Sunday lunch, 11 Oct");
  });
  it("formats the cutoff in IST", () => {
    expect(formatCutoff(cutoffAt)).toBe("9:30 AM");
  });
  it("names dishes when the owner gave them, and falls back otherwise", () => {
    expect(dishLine("Veg Biryani", "Chicken Biryani")).toBe("Chicken Biryani or Veg Biryani");
    expect(dishLine(null, null)).toBe("veg or non-veg");
  });
  it("builds the four parameters, never empty", () => {
    expect(buildQuestionParameters({ tenantName: "", serveDate: "2026-10-11", mealType: "LUNCH", vegDish: null, nonVegDish: null, cutoffAt }))
      .toEqual(["there", "Sunday lunch, 11 Oct", "veg or non-veg", "9:30 AM"]);
  });
  it("confirms each answer and states the change window", () => {
    expect(answeredReply({ choice: "NON_VEG", serveDate: "2026-10-11", mealType: "LUNCH", cutoffAt })).toContain("Non-veg");
    expect(answeredReply({ choice: "NON_VEG", serveDate: "2026-10-11", mealType: "LUNCH", cutoffAt })).toContain("9:30 AM");
    expect(answeredReply({ choice: "AWAY", serveDate: "2026-10-11", mealType: "LUNCH", cutoffAt })).toContain("won't cook for you");
    expect(closedReply({ serveDate: "2026-10-11", mealType: "LUNCH", cutoffAt })).toContain("warden");
  });
});

import {
  MEAL_READY_TEMPLATES,
  buildReadyParameters,
  decodeReadyPayload,
  encodeReadyPayload,
  onMyWayReply,
  readyTemplateFor,
} from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

describe("food's-ready templates", () => {
  it("has three wordings, each with three parameters, none starting or ending on a variable", () => {
    expect(MEAL_READY_TEMPLATES).toHaveLength(3);
    for (const t of MEAL_READY_TEMPLATES) {
      expect(t.parameters).toEqual(["tenant_first_name", "dish", "hostel_name"]);
      [1, 2, 3].forEach((n) => expect(t.body).toContain(`{{${n}}}`));
      expect(t.body).not.toContain("{{4}}");
      expect(t.body.trim().startsWith("{{")).toBe(false);
      expect(t.body.trim().endsWith("}}")).toBe(false);
      expect(t.quickReply.length).toBeLessThanOrEqual(25);
    }
    expect(new Set(MEAL_READY_TEMPLATES.map((t) => t.name)).size).toBe(3);
  });

  it("uses one wording for a whole week and rotates the next week", () => {
    const sun = readyTemplateFor("2026-10-11").name;
    expect(readyTemplateFor("2026-10-14").name).toBe(readyTemplateFor("2026-10-15").name);
    const weeks = ["2026-10-11", "2026-10-18", "2026-10-25"].map((d) => readyTemplateFor(d).name);
    expect(new Set(weeks).size).toBe(3);
    expect(weeks[0]).toBe(sun);
  });

  it("names the dish, falling back to the choice when the owner gave none", () => {
    expect(buildReadyParameters({ tenantName: "Rahul Kumar", dish: "Chicken Biryani", choice: "NON_VEG", hostelName: "Sri" }))
      .toEqual(["Rahul", "Chicken Biryani", "Sri"]);
    expect(buildReadyParameters({ tenantName: "", dish: null, choice: "VEG", hostelName: null }))
      .toEqual(["there", "Today's veg special", "the hostel"]);
  });

  it("round-trips the On-my-way payload and rejects junk", () => {
    const raw = encodeReadyPayload({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN });
    expect(raw.length).toBeLessThanOrEqual(128);
    expect(decodeReadyPayload(raw)).toEqual({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN });
    expect(decodeReadyPayload("MEALREADY:x")).toBeNull();
    expect(decodeReadyPayload(encodeMealPayload({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN, choice: "VEG" }))).toBeNull();
    expect(decodeMealPayload(raw)).toBeNull();
  });

  it("answers On-my-way with a short, warm line using the first name", () => {
    expect(onMyWayReply("Rahul Kumar", TEN)).toContain("Rahul");
  });
});
