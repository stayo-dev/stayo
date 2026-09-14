import fs from "fs/promises";
import path from "path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import { loadFonts } from "./menu-template-pdf-lib";

/**
 * The hostel's Stay QR, for a wall by the entrance. Laminated once, scanned
 * hundreds of times a day, read from arm's length by someone walking in with
 * a bag — so: one hostel name, one instruction, one very large code. The QR
 * encodes `/stay/<hostelId>` and never changes. See ADR-193.
 *
 * A designed PDF rather than a print view, for the kitchen sheet's reason
 * (ADR-144): phone print dialogs are unreliable on the devices owners use.
 */

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const INK = rgb(0.184, 0.184, 0.184); // Charcoal #2F2F2F
const MUTED = rgb(0.42, 0.42, 0.42);
const ACCENT = rgb(0.706, 0.416, 0.333); // Warm Clay #B46A55
const PAPER = rgb(1, 1, 1);
const BRAND_MARK = path.join(process.cwd(), "lib", "pdf", "brand", "stayo-mark.png");
const QR_SIZE = 340;

export function stayPosterLines(hostelName: string) {
  return {
    title: hostelName,
    headline: "Back? Scan me.",
    subline: "One tap tells the hostel you're here.",
    footnote: "Going home? Scan, then tap More.",
  };
}

function centred(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: RGB) {
  page.drawText(text, { x: (PAGE_W - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
}

export async function renderStayPosterPdf(content: { hostelName: string; url: string }): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await loadFonts(pdfDoc);
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER });

  const lines = stayPosterLines(content.hostelName);
  // A long hostel name shrinks to fit rather than running off the sheet.
  let titleSize = 34;
  while (titleSize > 14 && fonts.display.widthOfTextAtSize(lines.title, titleSize) > PAGE_W - 96) titleSize -= 2;
  centred(page, lines.title, PAGE_H - 120, titleSize, fonts.display, INK);
  centred(page, lines.headline, PAGE_H - 196, 44, fonts.display, ACCENT);

  const qrPng = await QRCode.toDataURL(content.url, {
    margin: 1,
    width: 1200,
    errorCorrectionLevel: "M",
    color: { dark: "#1A1A1C", light: "#FFFFFF" },
  });
  const qr = await pdfDoc.embedPng(qrPng);
  const qrTop = PAGE_H - 240;
  page.drawImage(qr, { x: (PAGE_W - QR_SIZE) / 2, y: qrTop - QR_SIZE, width: QR_SIZE, height: QR_SIZE });

  centred(page, lines.subline, qrTop - QR_SIZE - 44, 16, fonts.medium, INK);
  centred(page, lines.footnote, qrTop - QR_SIZE - 70, 13, fonts.regular, MUTED);

  try {
    const mark = await pdfDoc.embedPng(await fs.readFile(BRAND_MARK));
    const h = 18;
    const w = (mark.width / mark.height) * h;
    page.drawImage(mark, { x: (PAGE_W - w) / 2, y: 48, width: w, height: h });
  } catch {
    // The mark is decoration; the code is the point of the page.
  }

  return pdfDoc.save();
}
