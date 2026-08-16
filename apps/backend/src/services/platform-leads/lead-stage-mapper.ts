/**
 * Translates the internal PlatformLeadStatus into what a prospective owner
 * sees on the public /enquiry/:token page.
 *
 * This exists so internal vocabulary ("INVITE_SENT", "HOSTEL_CREATED") can
 * never reach an applicant, and so several internal statuses can collapse
 * into one applicant-meaningful stage.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type LeadStageState = "done" | "current" | "pending";

export type LeadDisplayStage = {
  key: string;
  label: string;
  state: LeadStageState;
};

const STAGE_ORDER = [
  { key: "submitted", label: "Submitted", statuses: ["NEW"] },
  // CONTACTED/DEMO/NEGOTIATING are INTERNAL sales stages and must never reach
  // an applicant: a prospective owner reading "Negotiating" on their own
  // status page learns they are being haggled with. They collapse into the
  // one applicant-meaningful stage, exactly as UNDER_REVIEW always did.
  {
    key: "under_review",
    label: "Under review",
    statuses: ["UNDER_REVIEW", "CONTACTED", "DEMO", "NEGOTIATING"],
  },
  { key: "approved", label: "Approved — activation link sent", statuses: ["APPROVED", "INVITE_SENT"] },
  { key: "setup", label: "Setting up your hostel", statuses: ["OWNER_ACTIVATED", "HOSTEL_CREATED"] },
  { key: "live", label: "Live on Stayo", statuses: ["LIVE"] },
] as const;

const REJECTED_LABEL = "Not proceeding";
const UNKNOWN_LABEL = "In progress";

export function mapLeadStatusToStage(status: string): { label: string; isTerminal: boolean } {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "LOST") return { label: REJECTED_LABEL, isTerminal: true };
  if (normalized === "LIVE") return { label: "Live on Stayo", isTerminal: true };

  const stage = STAGE_ORDER.find((entry) => (entry.statuses as readonly string[]).includes(normalized));
  return { label: stage ? stage.label : UNKNOWN_LABEL, isTerminal: false };
}

export function buildLeadTimeline(status: string): LeadDisplayStage[] {
  const normalized = String(status || "").toUpperCase();

  // A declined enquiry is not a partially-climbed ladder — showing three
  // greyed-out future stages under "Not proceeding" reads as though the
  // process is still running.
  if (normalized === "LOST") {
    return [
      { key: "submitted", label: "Submitted", state: "done" },
      { key: "under_review", label: "Under review", state: "done" },
      { key: "not_proceeding", label: REJECTED_LABEL, state: "current" },
    ];
  }

  const currentIndex = STAGE_ORDER.findIndex((entry) =>
    (entry.statuses as readonly string[]).includes(normalized)
  );

  return STAGE_ORDER.map((entry, index) => {
    let state: LeadStageState = "pending";
    if (currentIndex === -1) {
      // Unrecognised status: show the first stage as reached and nothing more,
      // rather than guessing at progress we cannot justify.
      state = index === 0 ? "current" : "pending";
    } else if (index < currentIndex) {
      state = "done";
    } else if (index === currentIndex) {
      state = normalized === "LIVE" ? "done" : "current";
    }
    return { key: entry.key, label: entry.label, state };
  });
}
