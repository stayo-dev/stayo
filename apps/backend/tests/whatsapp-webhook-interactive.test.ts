import { describe, expect, it } from "vitest";
import { extractMessageEvents } from "@/lib/services/notifications/whatsapp-webhook-event-service";

describe("WhatsApp webhook interactive extraction", () => {
  it("extracts text messages", () => {
    const events = extractMessageEvents({
      entry: [{
        changes: [{
          value: {
            messages: [{
              type: "text",
              from: "917901070333",
              id: "wamid.text",
              timestamp: "1718000000",
              text: { body: "rahul" },
            }],
          },
        }],
      }],
    });

    expect(events).toEqual([{
      from: "917901070333",
      messageId: "wamid.text",
      timestamp: "1718000000",
      body: "rahul",
      messageType: "text",
    }]);
  });

  it("extracts button reply payloads", () => {
    const events = extractMessageEvents({
      entry: [{
        changes: [{
          value: {
            messages: [{
              type: "interactive",
              from: "917901070333",
              id: "wamid.button",
              timestamp: "1718000001",
              interactive: {
                type: "button_reply",
                button_reply: {
                  id: "TENANT_CARD:00000000-0000-0000-0000-000000000001",
                  title: "Rahul Kumar",
                },
              },
            }],
          },
        }],
      }],
    });

    expect(events[0]).toMatchObject({
      from: "917901070333",
      messageId: "wamid.button",
      body: "TENANT_CARD:00000000-0000-0000-0000-000000000001",
      messageType: "interactive",
      interactiveType: "button_reply",
    });
  });

  it("extracts list reply payloads", () => {
    const events = extractMessageEvents({
      entry: [{
        changes: [{
          value: {
            messages: [{
              type: "interactive",
              from: "917901070333",
              id: "wamid.list",
              timestamp: "1718000002",
              interactive: {
                type: "list_reply",
                list_reply: {
                  id: "ROOM_CARD:00000000-0000-0000-0000-000000000002",
                  title: "Room G1",
                },
              },
            }],
          },
        }],
      }],
    });

    expect(events[0]).toMatchObject({
      from: "917901070333",
      messageId: "wamid.list",
      body: "ROOM_CARD:00000000-0000-0000-0000-000000000002",
      messageType: "interactive",
      interactiveType: "list_reply",
    });
  });

  it("ignores unsupported interactive payloads safely", () => {
    const events = extractMessageEvents({
      entry: [{
        changes: [{
          value: {
            messages: [{
              type: "interactive",
              from: "917901070333",
              id: "wamid.unsupported",
              timestamp: "1718000003",
              interactive: { type: "unknown" },
            }],
          },
        }],
      }],
    });

    expect(events).toEqual([]);
  });
});

describe("Unhandled inbound message types", () => {
  const payload = (messages: any[]) => ({ entry: [{ changes: [{ field: "messages", value: { messages } }] }] });

  it("reports media/sticker/reaction messages the extractor drops", async () => {
    const { extractMessageEvents, findUnhandledMessageTypes } = await import(
      "@/lib/services/notifications/whatsapp-webhook-event-service"
    );
    const body = payload([
      { type: "text", from: "91790", id: "wamid.ok", timestamp: "1", text: { body: "DUES" } },
      { type: "image", from: "91790", id: "wamid.img", timestamp: "2", image: { id: "media-1" } },
      { type: "reaction", from: "91790", id: "wamid.rct", timestamp: "4", reaction: { emoji: "👍" } },
    ]);

    const extracted = extractMessageEvents(body);
    const unhandled = findUnhandledMessageTypes(body, extracted);

    expect(extracted.map((e) => e.messageId)).toEqual(["wamid.ok"]);
    // `button` is deliberately absent from this list — a template quick reply
    // is now handled. It used to be dropped, which would have made the [Help]
    // button on `stayo_guardian_whatsapp_activated` do nothing at all.
    expect(unhandled).toEqual([
      { id: "wamid.img", type: "image" },
      { id: "wamid.rct", type: "reaction" },
    ]);
  });

  it("extracts a template quick-reply tap as text, so the vocabulary can read it", async () => {
    const { extractMessageEvents, findUnhandledMessageTypes } = await import(
      "@/lib/services/notifications/whatsapp-webhook-event-service"
    );
    // The exact shape Meta delivers when a guardian taps [Help] on
    // `stayo_guardian_whatsapp_activated`.
    const body = payload([
      {
        type: "button",
        from: "919876500999",
        id: "wamid.help",
        timestamp: "1718000000",
        button: { text: "Help", payload: "Help" },
      },
    ]);

    const events = extractMessageEvents(body);

    expect(events).toEqual([
      {
        from: "919876500999",
        messageId: "wamid.help",
        timestamp: "1718000000",
        body: "Help",
        // Text, not interactive: the payload is a keyword, not a `CC:` id.
        messageType: "text",
      },
    ]);
    expect(findUnhandledMessageTypes(body, events)).toEqual([]);
  });

  it("falls back to the button text when no payload is set", async () => {
    const { extractMessageEvents } = await import(
      "@/lib/services/notifications/whatsapp-webhook-event-service"
    );
    const body = payload([
      { type: "button", from: "91790", id: "wamid.b", timestamp: "1", button: { text: "Help" } },
    ]);

    expect(extractMessageEvents(body)[0]?.body).toBe("Help");
  });

  it("reports nothing when every message was handled", async () => {
    const { extractMessageEvents, findUnhandledMessageTypes } = await import(
      "@/lib/services/notifications/whatsapp-webhook-event-service"
    );
    const body = payload([
      { type: "text", from: "91790", id: "wamid.a", timestamp: "1", text: { body: "HELP" } },
    ]);

    expect(findUnhandledMessageTypes(body, extractMessageEvents(body))).toEqual([]);
  });
});
