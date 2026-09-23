import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  PUBLISHED_COMMANDS,
  resolveCommand,
  stayUpdatesStoppedMessage,
} from "@/lib/services/notifications/command-center/commands";
import { STAY_GUARDIAN_FOOTER } from "@/lib/services/notifications/providers/whatsapp/stay-guardian-template-contracts";

describe("STOP resolves from what the footer actually tells people to send", () => {
  it("resolves the bare word, in any case, with surrounding whitespace", () => {
    for (const text of ["STOP", "stop", "  Stop  ", "STOP."]) {
      expect(resolveCommand(text), text).toBe(COMMANDS.STOP);
    }
  });

  it("resolves the phrasings a parent actually types", () => {
    for (const text of ["STOP UPDATES", "stop stay updates", "unsubscribe"]) {
      expect(resolveCommand(text), text).toBe(COMMANDS.STOP);
    }
  });

  it("still resolves even though no approved template advertises it", () => {
    // ⚠️ The submitted templates carry the house footer, not the designed
    // "Reply STOP to pause stay updates". STOP works; nobody is told so. If a
    // future template edit restores the disclosure, tighten this back into an
    // assertion that the footer and the vocabulary agree.
    expect(STAY_GUARDIAN_FOOTER).not.toContain("STOP");
    expect(resolveCommand("STOP")).toBe(COMMANDS.STOP);
  });

  it("does not hijack a message that merely contains the word", () => {
    // "stop sending me the rent link" is a complaint, not this command; two
    // known words resolve to neither, which is resolveCommand's step 4.
    expect(resolveCommand("please stop sending me the rent link")).not.toBe(COMMANDS.STOP);
  });
});

describe("STOP is not advertised", () => {
  it("is absent from the HELP menu", () => {
    // The menu is about rent. Advertising an opt-out there invites a parent to
    // switch off the payment channel while trying to switch off location
    // updates — the same reasoning that keeps CONFIRM out of the menu.
    expect(PUBLISHED_COMMANDS.some((c) => c.name === COMMANDS.STOP)).toBe(false);
  });
});

describe("the reply states the scope rather than assuming it", () => {
  const message = stayUpdatesStoppedMessage("Aarav");

  it("names the ward, in the third person", () => {
    expect(message).toContain("Aarav");
  });

  it("says what stopped", () => {
    expect(message.toLowerCase()).toMatch(/leav|return/);
  });

  it("says what did NOT stop, so nobody silently loses the payment link", () => {
    expect(message.toLowerCase()).toContain("rent");
  });

  it("leaves a way back in", () => {
    expect(message).toContain("HELP");
  });

  it("falls back to a neutral phrase for a guardian of more than one ward", () => {
    expect(stayUpdatesStoppedMessage("")).toContain("your ward");
  });
});
