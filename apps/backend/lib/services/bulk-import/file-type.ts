/**
 * Whether an uploaded file is plausibly a spreadsheet we can parse.
 *
 * The extension is authoritative, not the MIME type: browsers and operating
 * systems routinely report `.xlsx` as `application/octet-stream` and `.csv` as
 * `text/plain`, so a MIME-only allowlist refuses genuine files. Content is
 * validated for real by `parseFile`, which fails loudly on anything that is not
 * a workbook — this check only stops obviously wrong uploads early.
 */
const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;

export function isAcceptedImportFile(name: string, _mimeType: string): boolean {
  const lowered = String(name || "").trim().toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}
