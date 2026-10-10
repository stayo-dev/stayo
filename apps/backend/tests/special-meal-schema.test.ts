import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(join(__dirname, "../../../migrations/096_special_meals.sql"), "utf8");

const modelOf = (name: string) => SCHEMA.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";

/**
 * Guards the ways these tables can ship broken: a Prisma field the database
 * lacks, a table the public anon key can read (dietary choice is sensitive),
 * and a second answer row for the same tenant, meal and date.
 */
describe("special meal schema", () => {
  it("declares both models with exactly the migration's columns", () => {
    const occasions = modelOf("special_meal_occasions");
    const answers = modelOf("special_meal_answers");
    for (const c of ["hostel_id", "owner_id", "weekday", "meal_type", "veg_dish", "non_veg_dish", "cutoff_minutes_before", "no_answer_policy", "is_active"]) {
      expect(occasions).toContain(` ${c} `);
      expect(MIGRATION).toContain(c);
    }
    for (const c of ["occasion_id", "hostel_id", "tenant_id", "serve_date", "choice", "source", "recorded_by"]) {
      expect(answers).toContain(` ${c} `);
      expect(MIGRATION).toContain(c);
    }
  });

  it("adds no relation fields, so no existing model changes", () => {
    expect(modelOf("special_meal_occasions")).not.toContain("@relation");
    expect(modelOf("special_meal_answers")).not.toContain("@relation");
  });

  it("keeps one answer per occasion, date and tenant", () => {
    expect(MIGRATION).toMatch(/UNIQUE \(occasion_id, serve_date, tenant_id\)/);
    expect(modelOf("special_meal_answers")).toContain("@@unique([occasion_id, serve_date, tenant_id]");
  });

  it("constrains choice and source to the known values", () => {
    expect(MIGRATION).toContain("CHECK (choice IN ('VEG', 'NON_VEG', 'AWAY', 'SKIP'))");
    expect(MIGRATION).toContain("CHECK (source IN ('WHATSAPP', 'OWNER'))");
  });

  it("declares the ready-alerts table, one alert per occasion, date and choice", () => {
    const alerts = modelOf("special_meal_ready_alerts");
    for (const c of ["occasion_id", "hostel_id", "serve_date", "choice", "sent_by", "recipients"]) {
      expect(alerts).toContain(` ${c} `);
      expect(MIGRATION).toContain(c);
    }
    expect(alerts).not.toContain("@relation");
    expect(MIGRATION).toMatch(/special_meal_ready_alerts_occasion_date_choice_key UNIQUE \(occasion_id, serve_date, choice\)/);
    expect(MIGRATION).toContain("CHECK (choice IN ('VEG', 'NON_VEG'))");
  });

  it("locks every table away from the public API", () => {
    for (const t of ["special_meal_occasions", "special_meal_answers", "special_meal_ready_alerts"]) {
      expect(MIGRATION).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${t} FROM anon, authenticated`);
    }
  });
});
