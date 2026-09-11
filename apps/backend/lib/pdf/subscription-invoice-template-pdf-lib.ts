import fs from "fs/promises";
import path from "path";
import { PDFDocument, PDFFont, PDFPage, RGB, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { SubscriptionInvoiceContent } from "./subscription-invoice-content";

/**
 * The Stayo subscription invoice, rendered to A4 portrait.
 *
 * Layout only — every string comes from `subscription-invoice-content.ts`, the
 * same split the receipt and menu templates use. Inter is embedded because
 * pdf-lib's built-in Helvetica (WinAnsi) has no `₹` glyph — the receipt
 * template documents this at length.
 *
 * No GST anywhere: there is no tax-percentage line, no GSTIN box, and the doc
 * never calls itself a "tax invoice". See ADR-172.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RIGHT = PAGE_W - MARGIN;

const INK = rgb(0.184, 0.184, 0.184); // Charcoal #2F2F2F
const MUTED = rgb(0.42, 0.42, 0.42);
const FAINT = rgb(0.6, 0.6, 0.6);
const RULE = rgb(0.85, 0.82, 0.78);
const ACCENT = rgb(0.706, 0.416, 0.333); // Warm Clay #B46A55
const WASH = rgb(0.969, 0.953, 0.933); // Cream #F7F3EE

const FONT_DIR = path.join(process.cwd(), "lib", "pdf", "fonts");

interface Fonts {
  regular: PDFFont;
  medium: PDFFont;
}

async function loadFonts(pdfDoc: PDFDocument): Promise<Fonts> {
  pdfDoc.registerFontkit(fontkit);
  const [regular, medium] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, "inter-400.ttf")),
    fs.readFile(path.join(FONT_DIR, "inter-500.ttf")),
  ]);
  // Not subset — pdf-lib's subsetter drops Latin glyphs from these Inter
  // builds (see receipt-template-pdf-lib.ts).
  return {
    regular: await pdfDoc.embedFont(regular, { subset: false }),
    medium: await pdfDoc.embedFont(medium, { subset: false }),
  };
}

function draw(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; font: PDFFont; color?: RGB },
) {
  page.drawText(text, { x, y, size: opts.size ?? 10, font: opts.font, color: opts.color ?? INK });
}

function drawRight(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  opts: { size?: number; font: PDFFont; color?: RGB },
) {
  const size = opts.size ?? 10;
  const w = opts.font.widthOfTextAtSize(text, size);
  draw(page, text, rightX - w, y, opts);
}

/** A "LABEL" + value pair, label small-caps grey above the value. Returns the new y. */
function field(page: PDFPage, fonts: Fonts, label: string, value: string, x: number, y: number, valueWidth = 220): number {
  draw(page, label.toUpperCase(), x, y, { size: 7.5, font: fonts.medium, color: FAINT });
  const lines = wrap(value || "—", fonts.regular, 10, valueWidth);
  let cursor = y - 13;
  for (const line of lines) {
    draw(page, line, x, cursor, { size: 10, font: fonts.regular, color: INK });
    cursor -= 13;
  }
  return cursor - 6;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["—"];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderSubscriptionInvoicePdf(content: SubscriptionInvoiceContent): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await loadFonts(pdfDoc);
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  let y = PAGE_H - MARGIN;

  // ── Header ──────────────────────────────────────────────────────────────
  draw(page, content.brandName, MARGIN, y - 4, { size: 22, font: fonts.medium, color: INK });
  drawRight(page, content.docTitle, RIGHT, y - 2, { size: 12, font: fonts.medium, color: ACCENT });
  y -= 20;
  drawRight(page, `Invoice ${content.invoiceNumber}`, RIGHT, y - 6, { size: 9, font: fonts.regular, color: MUTED });
  y -= 16;
  drawRight(page, `Issued ${content.issueDateLabel}`, RIGHT, y - 6, { size: 9, font: fonts.regular, color: MUTED });

  y -= 24;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 1, color: RULE });
  y -= 26;

  // ── Bill to ─────────────────────────────────────────────────────────────
  const colGap = 28;
  const colW = (CONTENT_W - colGap) / 2;
  const leftX = MARGIN;
  const rightColX = MARGIN + colW + colGap;

  let leftY = y;
  leftY = field(page, fonts, "Billed to", content.billTo.name, leftX, leftY, colW);
  if (content.billTo.email) leftY = field(page, fonts, "Email", content.billTo.email, leftX, leftY, colW);
  if (content.billTo.phone) leftY = field(page, fonts, "Phone", content.billTo.phone, leftX, leftY, colW);
  if (content.billTo.address) leftY = field(page, fonts, "Address", content.billTo.address, leftX, leftY, colW);

  let rightY = y;
  rightY = field(page, fonts, "Plan", content.subscription.planName, rightColX, rightY, colW);
  if (content.subscription.extraBedsLabel) {
    rightY = field(page, fonts, "Extra beds", content.subscription.extraBedsLabel, rightColX, rightY, colW);
  }
  rightY = field(page, fonts, "Billing period start", content.subscription.periodStartLabel, rightColX, rightY, colW);
  rightY = field(page, fonts, "Billing period end", content.subscription.periodEndLabel, rightColX, rightY, colW);
  rightY = field(page, fonts, "Payment method", content.payment.methodLabel, rightColX, rightY, colW);
  if (content.payment.transactionReference) {
    rightY = field(page, fonts, "Transaction reference", content.payment.transactionReference, rightColX, rightY, colW);
  }
  rightY = field(page, fonts, "Currency", content.payment.currency, rightColX, rightY, colW);

  y = Math.min(leftY, rightY) - 8;

  // ── Summary block ───────────────────────────────────────────────────────
  const boxTop = y;
  // Phase 6.6: an extra-beds invoice gets one more line (Plan / Extra beds
  // instead of a single Subtotal) — grow the box by 20 to keep it comfortable.
  const rows = content.summary.extraBeds
    ? [content.summary.plan, content.summary.extraBeds, content.summary.subtotal, content.summary.tax]
    : [content.summary.subtotal, content.summary.tax];
  const boxH = 96 + (rows.length - 2) * 20;
  page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: CONTENT_W, height: boxH, color: WASH });

  let rowY = boxTop - 24;
  for (const row of rows) {
    draw(page, row.label, MARGIN + 18, rowY, { size: 10, font: fonts.regular, color: MUTED });
    drawRight(page, row.value, RIGHT - 18, rowY, { size: 10, font: fonts.regular, color: INK });
    rowY -= 20;
  }
  page.drawLine({
    start: { x: MARGIN + 18, y: rowY + 6 },
    end: { x: RIGHT - 18, y: rowY + 6 },
    thickness: 0.75,
    color: RULE,
  });
  rowY -= 8;
  draw(page, content.summary.total.label, MARGIN + 18, rowY, { size: 11, font: fonts.medium, color: INK });
  drawRight(page, content.summary.total.value, RIGHT - 18, rowY, { size: 13, font: fonts.medium, color: ACCENT });

  y = boxTop - boxH - 20;
  draw(page, "No GST is applicable — Stayo is not a GST-registered business.", MARGIN, y, {
    size: 8.5,
    font: fonts.regular,
    color: FAINT,
  });

  // ── Footer ──────────────────────────────────────────────────────────────
  draw(page, content.footerNote, MARGIN, MARGIN, { size: 8, font: fonts.regular, color: FAINT });

  return pdfDoc.save();
}
