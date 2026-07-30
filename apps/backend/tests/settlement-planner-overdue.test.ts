import { describe, expect, it } from "vitest";
import { isOverdue } from "@/src/services/payments/settlement-planner";

const today = new Date("2026-07-15T00:00:00Z");
const yesterday = new Date("2026-07-14T00:00:00Z");
const tomorrow = new Date("2026-07-16T00:00:00Z");

describe("SettlementPlanner - isOverdue", () => {
  it("is true for PENDING with a due_date in the past", () => {
    expect(isOverdue({ status: "PENDING", due_date: yesterday }, today)).toBe(true);
  });

  it("is true for PARTIAL with a due_date in the past", () => {
    expect(isOverdue({ status: "PARTIAL", due_date: yesterday }, today)).toBe(true);
  });

  it("is false for PENDING with a due_date in the future", () => {
    expect(isOverdue({ status: "PENDING", due_date: tomorrow }, today)).toBe(false);
  });

  it("is false for PENDING due exactly today", () => {
    expect(isOverdue({ status: "PENDING", due_date: today }, today)).toBe(false);
  });

  it("is false for PAID regardless of due date", () => {
    expect(isOverdue({ status: "PAID", due_date: yesterday }, today)).toBe(false);
  });

  it("is false for WAIVED regardless of due date", () => {
    expect(isOverdue({ status: "WAIVED", due_date: yesterday }, today)).toBe(false);
  });

  it("is false for CANCELLED regardless of due date", () => {
    expect(isOverdue({ status: "CANCELLED", due_date: yesterday }, today)).toBe(false);
  });

  it("is true for a stale UPCOMING row whose due_date has already passed — diverges from isRemindable", () => {
    // This is the deliberate difference from isRemindable: a transient
    // pre-sync UPCOMING row that's already past due should still read as
    // overdue for defensive/monitoring purposes, even though it isn't yet
    // "remindable" by the stricter reminder-timing definition.
    expect(isOverdue({ status: "UPCOMING", due_date: yesterday }, today)).toBe(true);
  });

  it("is false for UPCOMING with a due_date in the future", () => {
    expect(isOverdue({ status: "UPCOMING", due_date: tomorrow }, today)).toBe(false);
  });
});
