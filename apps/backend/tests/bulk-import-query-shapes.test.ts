import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";

/**
 * Every relation these routes ask Prisma for must actually exist.
 *
 * `prisma` is exported as `any`, so a wrong relation name is invisible to the
 * compiler, and every test in this tree mocks the client — which answers to
 * whatever name it is given. The result is a query that passes review, passes
 * type-checking and passes the suite, then throws on the first real request.
 *
 * It has now happened twice. `select: { profile: … }` where the relation is
 * `profiles` would have thrown on every upload. `include: { hostel: … }` where
 * it is `hostels` did throw — on the corrected-sheet download *and* on confirm,
 * which is the route that creates the tenants, so the import could not run at
 * all against a live database.
 *
 * So this reads the route sources and checks them against the generated
 * client's own datamodel. No mock sits in between.
 */

const MODELS = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Set(model.fields.map((field) => field.name)),
  ])
);

const ROUTES = path.join(__dirname, "..", "app", "api", "bulk-import");

/** Prisma's own pseudo-fields, which are valid in a select but in no model. */
const PSEUDO_FIELDS = new Set(["_count", "_avg", "_sum", "_min", "_max"]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** The `{ … }` that starts at `from`, honouring nesting. */
function blockAt(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from + 1, i);
    }
  }
  return "";
}

/** Keys at the top level of a block — nested ones belong to another model. */
function topLevelKeys(block: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < block.length; i += 1) {
    const char = block[i];
    if (char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ")") depth -= 1;
    else if (depth === 0) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(block.slice(i));
      if (match && (i === 0 || /[\s,{]/.test(block[i - 1]))) {
        keys.push(match[1]);
        i += match[0].length - 1;
      }
    }
  }
  return keys;
}

/** The block belonging to `key:` at the top level of `block`, if there is one. */
function nested(block: string, key: string): string | null {
  let depth = 0;
  for (let i = 0; i < block.length; i += 1) {
    const char = block[i];
    if (char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ")") depth -= 1;
    else if (depth === 0 && block.startsWith(key, i) && /[\s,{]|^/.test(block[i - 1] ?? "")) {
      const after = /^\s*:\s*\{/.exec(block.slice(i + key.length));
      if (after) return blockAt(block, block.indexOf("{", i + key.length));
    }
  }
  return null;
}

/**
 * Every `include`/`select` in the file, paired with the model it was asked of.
 *
 * Anchored to each call's own argument object rather than the next match in
 * the text, so a nested select belonging to a related model is not checked
 * against the outer one.
 */
function queriesByModel(source: string): Array<{ model: string; keys: string[] }> {
  const found: Array<{ model: string; keys: string[] }> = [];
  const calls = /prisma\.([a-zA-Z_][a-zA-Z0-9_]*)\.[a-zA-Z]+\(/g;

  let call: RegExpExecArray | null;
  while ((call = calls.exec(source))) {
    const model = call[1];
    if (!MODELS.has(model)) continue;

    const open = source.indexOf("{", call.index + call[0].length - 1);
    if (open === -1) continue;
    const args = blockAt(source, open);

    for (const clause of ["include", "select"]) {
      const block = nested(args, clause);
      if (block !== null) found.push({ model, keys: topLevelKeys(block) });
    }
  }
  return found;
}

describe("what the bulk-import routes ask Prisma for", () => {
  const files = sourceFiles(ROUTES);

  it("finds the routes at all", () => {
    expect(files.length).toBeGreaterThan(4);
  });

  it.each(files.map((file) => [path.relative(ROUTES, file), file]))(
    "%s names only fields that exist",
    (_label, file) => {
      const source = fs.readFileSync(file, "utf8");

      for (const { model, keys } of queriesByModel(source)) {
        const fields = MODELS.get(model)!;
        for (const key of keys) {
          if (PSEUDO_FIELDS.has(key)) continue;
          expect(
            fields.has(key),
            `${model} has no field "${key}". Real fields: ${[...fields].join(", ")}`
          ).toBe(true);
        }
      }
    }
  );

  /**
   * Guards the guard. If the scanner silently stopped finding anything — a
   * refactor, a renamed directory — every assertion above would pass by
   * examining nothing.
   */
  it("is actually reading queries, not passing vacuously", () => {
    const all = files.flatMap((file) => queriesByModel(fs.readFileSync(file, "utf8")));

    expect(all.length).toBeGreaterThan(0);
    expect(all.some(({ keys }) => keys.length > 0)).toBe(true);
  });

  it("would catch the name that broke confirm", () => {
    const fields = MODELS.get("bulk_import_batches")!;

    expect(fields.has("hostels")).toBe(true);
    expect(fields.has("hostel")).toBe(false);
  });
});
