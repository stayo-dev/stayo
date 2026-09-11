/**
 * Bulk tenant import — parsing, validation and the owner-facing issue model.
 *
 *   types.ts            row, defaults and result shapes
 *   workbook-parser.ts  uploaded workbook → TenantImportRow[]
 *   dates.ts            DD/MM/YYYY-first date parsing
 *   identity.ts         phone / email / formula checks
 *   room-resolution.ts  nearest-room suggestions for a mistyped room
 *   issues.ts           owner-readable RowIssue catalogue
 *   sanitize-row.ts     what is persisted for a validated row
 *   file-type.ts        which uploads are plausibly spreadsheets
 *   validation-service  orchestrates the above into a ValidationResult
 */
export * from "./types";
export * from "./workbook-parser";
export * from "./rooms-sheet";
export * from "./room-plan";
export * from "./financial-plan";
export * from "./template-builder";
export * from "./hostel-stamp";
export * from "./dates";
export * from "./identity";
export * from "./room-resolution";
export * from "./issues";
export * from "./sanitize-row";
export * from "./file-type";
export * from "./validation-service";
