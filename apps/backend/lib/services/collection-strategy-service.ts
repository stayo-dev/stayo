export type ReminderType = "DUE_SOON" | "WARNING" | "FINAL_NOTICE";

export type CollectionStrategy = {
  enabled: boolean;
  after_due_days: number[];
  before_due_days: number[];
  auto_stop_after_payment: boolean;
  escalation_tone: string;
};

export const COLLECTION_STRATEGIES = {
  gentle: {
    name: "Gentle",
    badge: "Student Friendly",
    description: "Fewer reminders, polite tone.",
    before_due_days: [2],
    after_due_days: [1, 7],
    repeat_interval: 0,
    stop_condition: "paid",
    escalation_tone: "GENTLE",
  },
  standard: {
    name: "Standard",
    badge: "Recommended",
    description: "Standard reminder cadence, standard tone.",
    before_due_days: [3, 1],
    after_due_days: [1, 5, 10],
    repeat_interval: 5,
    stop_condition: "paid",
    escalation_tone: "STANDARD",
  },
  aggressive: {
    name: "Aggressive",
    badge: "Fast Collection",
    description: "Frequent reminders, escalating tone.",
    before_due_days: [5, 3, 1],
    after_due_days: [1, 2, 3, 5, 7, 10, 14],
    repeat_interval: 3,
    stop_condition: "paid",
    escalation_tone: "URGENT",
  },
  custom: {
    name: "Custom",
    badge: "Tailored schedule",
    description: "Configure your own days and frequency.",
    before_due_days: [],
    after_due_days: [],
    repeat_interval: 0,
    stop_condition: "paid",
    escalation_tone: "STANDARD",
  }
};

function uniqueSortedDays(value: unknown, fallback: number[]) {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from(new Set(
    source
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day > 0 && day <= 90)
  )).sort((a, b) => a - b);
}

function legacyAfterDueDays(config: any) {
  const days: number[] = [];
  if (config.reminder_day_1 !== false) days.push(1);
  if (config.reminder_day_5 !== false) days.push(5);
  if (config.reminder_day_10 !== false) days.push(10);
  return days;
}

export function resolveCollectionStrategy(config: any): CollectionStrategy {
  const afterDue = config.reminder_after_due_days ?? config.reminders_after_due_days;
  const beforeDue = config.reminder_before_due_days ?? config.reminders_before_due_days;
  return {
    enabled: config.auto_send_reminders ?? config.reminders_enabled ?? true,
    after_due_days: uniqueSortedDays(afterDue, legacyAfterDueDays(config)),
    before_due_days: uniqueSortedDays(beforeDue, []),
    auto_stop_after_payment: config.reminder_auto_stop_after_payment ?? true,
    escalation_tone: String(config.reminder_escalation_tone || "STANDARD"),
  };
}

export function reminderTypeForScheduleIndex(index: number, total: number): ReminderType {
  if (index <= 0) return "DUE_SOON";
  if (index === total - 1 && total >= 3) return "FINAL_NOTICE";
  return "WARNING";
}

export function selectReminderForOverdueDay(
  daysOverdue: number,
  lastReminderType: string | null | undefined,
  config: any,
): ReminderType | null {
  const strategy = resolveCollectionStrategy(config);
  if (!strategy.enabled) return null;

  const index = strategy.after_due_days.indexOf(daysOverdue);
  if (index === -1) return null;

  const type = reminderTypeForScheduleIndex(index, strategy.after_due_days.length);
  if (lastReminderType === type) return null;
  if (lastReminderType === "FINAL_NOTICE") return null;
  return type;
}

export function selectReminderForDay(
  daysOffset: number, // negative for before due, 0 for due day, positive for overdue
  config: any,
): ReminderType | null {
  const strategy = resolveCollectionStrategy(config);
  if (!strategy.enabled) return null;

  if (daysOffset < 0) {
    const daysBefore = Math.abs(daysOffset);
    if (strategy.before_due_days.includes(daysBefore)) {
      return "DUE_SOON";
    }
  } else if (daysOffset === 0) {
    // Check if send_due_day_reminder is enabled
    if (config.send_due_day_reminder ?? true) {
      return "DUE_SOON"; // maps to RENT_DUE_TODAY template
    }
  } else {
    // Overdue
    const index = strategy.after_due_days.indexOf(daysOffset);
    if (index !== -1) {
      return reminderTypeForScheduleIndex(index, strategy.after_due_days.length);
    }
  }
  return null;
}
