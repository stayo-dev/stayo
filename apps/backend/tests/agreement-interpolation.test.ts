import { describe, expect, it } from "vitest";
import { interpolateText, interpolateRulesContent } from "@/src/utils/default-rules";

/**
 * Variable substitution in agreement content.
 *
 * Both brace forms exist in the wild and always have: the stock template and
 * the backend write `{{VAR}}`, but the owner editor's insert chips write
 * `{VAR}` — which this function did not match, so every variable an owner
 * inserted printed literally in their tenants' signed agreements.
 */

const vars = { MONTHLY_RENT: 8000, TENANT_NAME: "Ravi Kumar" };

describe("interpolateText", () => {
  it("substitutes the double-brace form", () => {
    expect(interpolateText("Rent is {{MONTHLY_RENT}}.", vars)).toBe("Rent is 8000.");
  });

  it("substitutes the single-brace form written by the owner editor", () => {
    expect(interpolateText("Rent is {MONTHLY_RENT}.", vars)).toBe("Rent is 8000.");
  });

  it("substitutes both forms in one string", () => {
    expect(interpolateText("{TENANT_NAME} pays {{MONTHLY_RENT}}.", vars)).toBe("Ravi Kumar pays 8000.");
  });

  it("tolerates internal whitespace", () => {
    expect(interpolateText("Rent is {{ MONTHLY_RENT }}.", vars)).toBe("Rent is 8000.");
  });

  it("leaves a mismatched pair alone rather than silently repairing it", () => {
    // A malformed token stays visible to the owner instead of being quietly
    // "fixed" into something they never wrote.
    expect(interpolateText("Rent is {MONTHLY_RENT}}.", vars)).toBe("Rent is 8000}.");
  });

  it("leaves an unknown token visible when not final", () => {
    expect(interpolateText("Hi {{NOPE}}.", vars)).toBe("Hi {{NOPE}}.");
    expect(interpolateText("Hi {NOPE}.", vars)).toBe("Hi {NOPE}.");
  });

  it("blanks an unknown token when final", () => {
    expect(interpolateText("Hi {{NOPE}}.", vars, true)).toBe("Hi ____.");
    expect(interpolateText("Hi {NOPE}.", vars, true)).toBe("Hi ____.");
  });

  it("does not treat lowercase braces as tokens", () => {
    expect(interpolateText("Use {rent} here.", vars)).toBe("Use {rent} here.");
  });

  it("returns an empty string for empty input", () => {
    expect(interpolateText("", vars)).toBe("");
  });
});

describe("interpolateRulesContent", () => {
  it("interpolates both forms across highlights and rules", () => {
    const out = interpolateRulesContent(
      {
        categories: [
          { id: "a", title: "Fees", highlights: ["Rent {MONTHLY_RENT}"], rules: ["Due {{MONTHLY_RENT}}"] },
        ],
      },
      vars,
    );
    expect(out.categories[0].highlights[0]).toBe("Rent 8000");
    expect(out.categories[0].rules[0]).toBe("Due 8000");
  });
});
