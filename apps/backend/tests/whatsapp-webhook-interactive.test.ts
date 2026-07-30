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
