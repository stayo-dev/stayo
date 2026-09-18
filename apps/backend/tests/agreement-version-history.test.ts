import { describe, expect, it } from "vitest";
import { summariseVersionChange } from "@/src/services/agreements/agreement-version-history";

/**
 * A history row is the only description of a version an owner reads before
 * deciding to bring its wording back. A wrong summary is worse than none.
 */

const content = (overrides: any = {}) => ({
  terms_and_conditions: [
    { id: "notice_period", title: "Notice Period", content: "One month's notice." },
  ],
  categories: [
    { id: "fees", title: "Fee Structure", rules: ["Fees are non-refundable."] },
    { id: "facilities", title: "Facilities", rules: ["Wi-Fi is free."] },
  ],
  ...overrides,
});

describe("summariseVersionChange", () => {
  it("calls the first version the first version, not nine additions", () => {
    const first = summariseVersionChange(null, content());
    expect(first.summary).toBe("First version");
    expect(first.added).toBe(0);
    expect(first.unchanged).toBe(3);
  });

  it("says so plainly when a republish changed nothing", () => {
    expect(summariseVersionChange(content(), content()).summary).toBe("No change to the document");
  });

  it("counts a reworded clause", () => {
    const next = content({
      categories: [
        { id: "fees", title: "Fee Structure", rules: ["Fees are refundable within 7 days."] },
        { id: "facilities", title: "Facilities", rules: ["Wi-Fi is free."] },
      ],
    });
    const change = summariseVersionChange(content(), next);
    expect(change).toMatchObject({ added: 0, reworded: 1, removed: 0, unchanged: 2 });
    expect(change.summary).toBe("1 reworded");
  });

  it("counts an added and a removed section", () => {
    const next = content({
      categories: [
        { id: "fees", title: "Fee Structure", rules: ["Fees are non-refundable."] },
        { id: "own-guests", title: "Guests", rules: ["No overnight guests."] },
      ],
    });
    const change = summariseVersionChange(content(), next);
    expect(change).toMatchObject({ added: 1, removed: 1, reworded: 0 });
    expect(change.summary).toBe("1 added · 1 removed");
  });

  it("orders the summary the way the publish review groups it", () => {
    // Added, reworded, removed — an owner meets the same words in the same
    // order before publishing and afterwards in the history.
    const next = content({
      categories: [
        { id: "fees", title: "Fee Structure", rules: ["Reworded."] },
        { id: "own-guests", title: "Guests", rules: ["No overnight guests."] },
      ],
    });
    expect(summariseVersionChange(content(), next).summary).toBe("1 added · 1 reworded · 1 removed");
  });

  it("reads a renamed section as reworded, not as a swap", () => {
    // Ids are durable in `rules_content`, so renaming is a change to one
    // section — not the removal of one and the arrival of a stranger.
    const next = content({
      categories: [
        { id: "fees", title: "Fees & Payment", rules: ["Fees are non-refundable."] },
        { id: "facilities", title: "Facilities", rules: ["Wi-Fi is free."] },
      ],
    });
    expect(summariseVersionChange(content(), next)).toMatchObject({ reworded: 1, added: 0, removed: 0 });
  });

  it("treats a section left out as removed, because the composer drops it", () => {
    const next = content({
      categories: [
        { id: "fees", title: "Fee Structure", rules: ["Fees are non-refundable."] },
        { id: "facilities", title: "Facilities", rules: ["Wi-Fi is free."], enabled: false },
      ],
    });
    expect(summariseVersionChange(content(), next)).toMatchObject({ removed: 1 });
  });

  it("notices a commercial term the owner reworded", () => {
    const next = content({
      terms_and_conditions: [
        { id: "notice_period", title: "Notice Period", content: "Two months' notice." },
      ],
    });
    expect(summariseVersionChange(content(), next)).toMatchObject({ reworded: 1, unchanged: 2 });
  });

  it("ignores reordering, which changes nothing a tenant reads differently", () => {
    const next = content({
      categories: [
        { id: "facilities", title: "Facilities", rules: ["Wi-Fi is free."] },
        { id: "fees", title: "Fee Structure", rules: ["Fees are non-refundable."] },
      ],
    });
    expect(summariseVersionChange(content(), next).summary).toBe("No change to the document");
  });

  it("counts a highlight the same as a rule, since both reach the document", () => {
    const next = content({
      categories: [
        { id: "fees", title: "Fee Structure", highlights: ["Pay by the 5th."], rules: ["Fees are non-refundable."] },
        { id: "facilities", title: "Facilities", rules: ["Wi-Fi is free."] },
      ],
    });
    expect(summariseVersionChange(content(), next)).toMatchObject({ reworded: 1 });
  });

  it("survives a malformed or empty stored version rather than throwing", () => {
    // `rules_content` is a nullable Json column written by several code paths
    // over the years; a history screen must not be the thing that 500s.
    expect(summariseVersionChange({}, {}).summary).toBe("No change to the document");
    expect(summariseVersionChange({ categories: "nonsense" } as any, content()).added).toBe(3);
    expect(() => summariseVersionChange(undefined, undefined)).not.toThrow();
  });
});
