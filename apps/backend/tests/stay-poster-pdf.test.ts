import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderStayPosterPdf, stayPosterLines } from "@/lib/pdf/stay-poster-pdf-lib";

describe("stay QR poster", () => {
  it("leads with the hostel and the one action", () => {
    expect(stayPosterLines("Sri Adithya Hostel")).toEqual({
      title: "Sri Adithya Hostel",
      headline: "Back? Scan me.",
      subline: "One tap tells the hostel you're here.",
      footnote: "Going home? Scan, then tap More.",
    });
  });

  it("renders a one-page A4 PDF, even for a very long hostel name", async () => {
    const bytes = await renderStayPosterPdf({
      hostelName: "Sri Venkateswara Luxury Boys Hostel and Paying Guest Accommodation",
      url: "https://yourstayo.com/stay/7b0c5f5e-0000-4000-8000-000000000000",
    });
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  });
});
