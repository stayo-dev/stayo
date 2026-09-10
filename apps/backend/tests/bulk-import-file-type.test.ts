import { describe, expect, it } from "vitest";
import { isAcceptedImportFile } from "@/lib/services/bulk-import/file-type";

describe("isAcceptedImportFile", () => {
  it("accepts a real xlsx MIME type", () => {
    expect(
      isAcceptedImportFile(
        "tenants.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe(true);
  });

  it("accepts an xlsx the browser reported as octet-stream", () => {
    expect(isAcceptedImportFile("tenants.xlsx", "application/octet-stream")).toBe(true);
  });

  it("accepts a csv the OS reported as text/plain", () => {
    expect(isAcceptedImportFile("tenants.csv", "text/plain")).toBe(true);
  });

  it("accepts an empty MIME type when the extension is right", () => {
    expect(isAcceptedImportFile("tenants.xls", "")).toBe(true);
  });

  it("rejects a PDF whatever it claims to be", () => {
    expect(isAcceptedImportFile("tenants.pdf", "application/pdf")).toBe(false);
    expect(
      isAcceptedImportFile(
        "tenants.pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe(false);
  });

  it("rejects a file with no usable extension", () => {
    expect(isAcceptedImportFile("tenants", "application/octet-stream")).toBe(false);
  });
});
