/**
 * Agreement dates, in IST.
 *
 * PURE MODULE — no Prisma, no pdf-lib, no I/O.
 *
 * Lifted out of `agreement-generation-service` so the document composer's
 * resolver can format dates without importing the PDF service, which imports
 * the resolver in turn. That cycle happened to work, because both sides only
 * call each other at call time, but a circular import on the path that renders
 * a signed contract is not something to leave standing.
 */

const IST_TIMEZONE = "Asia/Kolkata";

export function formatAgreementDate(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return "N/A";
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return "N/A";

  const formatted = date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: IST_TIMEZONE,
  });
  return formatted.replace(/\//g, "-");
}

export function formatAgreementDateTime(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return "N/A";
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return "N/A";

  const formatted = date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: IST_TIMEZONE,
  });
  return `${formatted.replace(/\//g, "-")} IST`;
}
