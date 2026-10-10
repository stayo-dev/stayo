import { describe, expect, it } from "vitest";
import { buildTemplateComponents } from "@/lib/services/notifications/providers/whatsapp/template-components";

describe("buildTemplateComponents", () => {
  it("keeps the existing body + URL-button shape byte for byte", () => {
    expect(buildTemplateComponents({ bodyParameters: ["a", "b"], buttonParameters: ["tok"] })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: "tok" }] },
    ]);
  });

  it("adds one quick_reply component per payload, indexed in button order", () => {
    expect(buildTemplateComponents({ quickReplyPayloads: ["P0", "P1"] })).toEqual([
      { type: "button", sub_type: "quick_reply", index: 0, parameters: [{ type: "payload", payload: "P0" }] },
      { type: "button", sub_type: "quick_reply", index: 1, parameters: [{ type: "payload", payload: "P1" }] },
    ]);
  });

  it("emits nothing for an empty message", () => {
    expect(buildTemplateComponents({})).toEqual([]);
  });
});
