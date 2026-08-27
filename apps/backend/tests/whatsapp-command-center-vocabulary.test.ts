import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  PUBLISHED_COMMANDS,
  RETIRED_WORDS,
  resolveCommand,
} from "@/lib/services/notifications/command-center/commands";
import {
  LIMITS,
  actionsFor,
  decodePayload,
  encodePayload,
  helpMessage,
  residentPicker,
  unknownSenderMessage,
  unrecognisedMessage,
} from "@/lib/services/notifications/command-center/menu";

const subject = { name: "Aarav Sharma", hostelName: "Sunrise Residency", roomNo: "204" };

describe("command vocabulary", () => {
  it("matches an exact command, any casing or padding", () => {
    for (const body of ["RENT", "rent", "  Rent  ", "rEnT"]) {
      expect(resolveCommand(body), body).toBe(COMMANDS.RENT);
    }
  });

  it("matches on the first word", () => {
    expect(resolveCommand("pay now please")).toBe(COMMANDS.PAY);
    expect(resolveCommand("plan for next month")).toBe(COMMANDS.PLAN);
  });

  it("matches a command appearing later in the message", () => {
    expect(resolveCommand("please send my rent")).toBe(COMMANDS.RENT);
    expect(resolveCommand("can I see the receipt")).toBe(COMMANDS.RECEIPT);
  });

  it("strips punctuation around a command", () => {
    expect(resolveCommand("help!")).toBe(COMMANDS.HELP);
    expect(resolveCommand("hi, rent?")).toBe(COMMANDS.RENT);
  });

  it("prefers the leading word when the message opens with a command", () => {
    expect(resolveCommand("pay or plan?")).toBe(COMMANDS.PAY);
  });

  it("refuses to guess when two commands appear and neither leads", () => {
    // Guessing wrong on a money command is worse than asking.
    expect(resolveCommand("should I pay or check the plan")).toBeNull();
    expect(resolveCommand("is the receipt or the plan ready")).toBeNull();
  });

  it("understands multi-word phrasings people actually type", () => {
    expect(resolveCommand("how much is due")).toBe(COMMANDS.RENT);
    expect(resolveCommand("payment link")).toBe(COMMANDS.PAY);
    expect(resolveCommand("last payment")).toBe(COMMANDS.RECEIPT);
  });

  it("opens the menu on a bare greeting instead of failing", () => {
    for (const greeting of ["hi", "Hello", "start", "menu"]) {
      expect(resolveCommand(greeting), greeting).toBe(COMMANDS.HELP);
    }
  });

  it("still honours every retired word, silently", () => {
    // Someone who learned BAL last year must not hit a wall today...
    expect(resolveCommand("BAL")).toBe(COMMANDS.RENT);
    expect(resolveCommand("balance")).toBe(COMMANDS.RENT);
    expect(resolveCommand("dues")).toBe(COMMANDS.RENT);
    expect(resolveCommand("status")).toBe(COMMANDS.RENT);
    expect(resolveCommand("switch")).toBe(COMMANDS.RENT);

    // ...but none of them is advertised any more.
    const published = PUBLISHED_COMMANDS.map((entry) => entry.word);
    for (const retired of RETIRED_WORDS) {
      expect(published, retired).not.toContain(retired);
    }
  });

  it("returns null for text that is not a command at all", () => {
    expect(resolveCommand("the tap in room 204 is leaking")).toBeNull();
    expect(resolveCommand("")).toBeNull();
    expect(resolveCommand("   ")).toBeNull();
  });
});

describe("interactive payloads", () => {
  it("round-trips a command and the resident it is about", () => {
    const payload = encodePayload(COMMANDS.PAY, "8f2b1c44-0000-4000-8000-000000000001");
    expect(decodePayload(payload)).toEqual({
      command: COMMANDS.PAY,
      tenantId: "8f2b1c44-0000-4000-8000-000000000001",
    });
  });

  it("round-trips a command with no resident attached", () => {
    expect(decodePayload(encodePayload(COMMANDS.HELP))).toEqual({
      command: COMMANDS.HELP,
      tenantId: null,
    });
  });

  it("rejects payloads that are not ours, and unknown commands", () => {
    expect(decodePayload("CMD:DUES")).toBeNull();
    expect(decodePayload("SELECT_RESIDENT:t-1")).toBeNull();
    expect(decodePayload("CC:DROP_TABLE:t-1")).toBeNull();
    expect(decodePayload("")).toBeNull();
  });

  it("stays inside WhatsApp's payload ceiling", () => {
    const payload = encodePayload(COMMANDS.RECEIPT, "8f2b1c44-0000-4000-8000-000000000001");
    expect(payload.length).toBeLessThanOrEqual(LIMITS.PAYLOAD_ID);
  });
});

describe("action buttons", () => {
  const base = { tenantId: "t-1", hasPayments: true };

  it("puts the amount on the pay button — the reader commits to a number", () => {
    const buttons = actionsFor({ ...base, command: COMMANDS.RENT, payableNow: 8000 });
    expect(buttons[0].title).toBe("Pay ₹8,000");
  });

  it("never offers to pay when nothing is payable", () => {
    const buttons = actionsFor({ ...base, command: COMMANDS.RENT, payableNow: 0 });
    expect(buttons.map((b) => b.title)).not.toContain(expect.stringContaining("Pay"));
    expect(buttons.every((b) => !b.title.startsWith("Pay"))).toBe(true);
  });

  it("never offers a receipt to someone who has never paid", () => {
    const buttons = actionsFor({
      tenantId: "t-1",
      hasPayments: false,
      command: COMMANDS.RENT,
      payableNow: 8000,
    });
    expect(buttons.every((b) => b.title !== "Last receipt")).toBe(true);
  });

  it("never repeats the command the reader just ran", () => {
    const buttons = actionsFor({ ...base, command: COMMANDS.PLAN, payableNow: 8000 });
    expect(buttons.every((b) => b.title !== "Instalments")).toBe(true);
  });

  it("respects WhatsApp's three-button ceiling and title length", () => {
    const buttons = actionsFor({ ...base, command: COMMANDS.HELP, payableNow: 1234567 });
    expect(buttons.length).toBeLessThanOrEqual(LIMITS.BUTTONS_PER_MESSAGE);
    for (const button of buttons) {
      expect(button.title.length, button.title).toBeLessThanOrEqual(LIMITS.BUTTON_TITLE);
    }
  });

  it("carries the resident through every button, so no mode is needed", () => {
    const buttons = actionsFor({ ...base, command: COMMANDS.RENT, payableNow: 8000 });
    for (const button of buttons) {
      expect(decodePayload(button.id)?.tenantId).toBe("t-1");
    }
  });
});

describe("resident picker", () => {
  const residents = [
    { tenantId: "t-1", name: "Aarav Sharma", roomNo: "204", payableNow: 8000 },
    { tenantId: "t-2", name: "Diya Sharma", roomNo: "108", payableNow: 0 },
  ];

  it("prices each row so the choice is made on facts, not names alone", () => {
    const { rows } = residentPicker({ command: COMMANDS.PAY, residents });
    expect(rows[0].description).toContain("Room 204");
    expect(rows[0].description).toContain("₹8,000 due");
    expect(rows[1].description).toContain("Nothing due");
  });

  it("carries the original command forward, so choosing is one tap", () => {
    const { rows } = residentPicker({ command: COMMANDS.PAY, residents });
    expect(decodePayload(rows[0].id)).toEqual({ command: COMMANDS.PAY, tenantId: "t-1" });
  });

  it("respects WhatsApp's list row limits", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      tenantId: `t-${i}`,
      name: `A resident with an extremely long name number ${i}`,
      roomNo: `${100 + i}`,
      payableNow: 1000,
    }));
    const { rows } = residentPicker({ command: COMMANDS.RENT, residents: many });

    expect(rows.length).toBeLessThanOrEqual(LIMITS.LIST_ROWS);
    for (const row of rows) {
      expect(row.title.length).toBeLessThanOrEqual(LIMITS.LIST_ROW_TITLE);
      expect(row.description!.length).toBeLessThanOrEqual(LIMITS.LIST_ROW_DESCRIPTION);
    }
  });
});

describe("menu and dead-end copy", () => {
  it("tells a guardian which residents they are recognised for", () => {
    const text = helpMessage({ audience: "GUARDIAN", subject, residentNames: ["Aarav", "Diya"] });
    expect(text).toContain("Aarav");
    expect(text).toContain("Diya");
  });

  it("advertises only the five living commands", () => {
    const text = helpMessage({ audience: "RESIDENT", subject, residentNames: ["Aarav"] });
    for (const entry of PUBLISHED_COMMANDS) {
      expect(text, entry.word).toContain(entry.word);
    }
    for (const retired of RETIRED_WORDS) {
      expect(text, retired).not.toContain(`*${retired}*`);
    }
  });

  it("never apologises when it does not understand", () => {
    const text = unrecognisedMessage({ audience: "GUARDIAN", subject });
    expect(text.toLowerCase()).not.toContain("sorry");
    // ...and points at something that works rather than just failing.
    expect(text).toContain("RENT");
  });

  it("addresses guardians in the unknown-sender reply", () => {
    // The copy this replaces named only residents and owners, leaving the
    // reader most likely to be there with no instruction at all.
    const text = unknownSenderMessage();
    expect(text.toLowerCase()).toContain("parent or guardian");
    expect(text.toLowerCase()).toContain("resident");
    expect(text.toLowerCase()).toContain("owner");
  });
});
