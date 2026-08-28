import { PDFDocument, PDFFont, PDFPage, rgb, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs/promises";
import path from "path";
import QRCode from "qrcode";
import type { HostelPreferences } from "../preferences";
import { formatShortDate, formatMonthYear } from "../format";
import { buildReceiptContent, type ReceiptContent } from "./receipt-content";

export interface ReceiptSettlementAllocation {
  type: string;
  rent_month: Date | string | null;
  allocated: number;
  label: string;
}

export interface ReceiptRenderData {
  hostel_name: string;
  hostel_address: string;
  hostel_city: string | null;
  hostel_state: string | null;
  hostel_pincode: string | null;
  hostel_phone: string | null;
  hostel_gst: string | null;
  hostel_logo_url: string | null;

  receipt_number: string;
  issued_at: Date | string;

  tenant_name: string;
  tenant_phone: string | null;
  tenant_email: string | null;
  room_no: string | null;
  room_floor: string | null;

  amount: number;
  payment_method: string;
  transaction_id: string | null;
  reference_number: string | null;
  payment_date: Date | string;

  rent_month: Date | string | null;
  due_date: Date | string | null;
  obligation_amount: number | null;
  obligation_status: string | null;

  settlement_allocations: ReceiptSettlementAllocation[];
  future_credit_allocated: number;
  total_transaction_paid: number;
  outstanding_balance_after: number;
  future_credit_balance_after: number;

  payment_id: string;
  tenant_id: string;
  receipt_id: string;
  template_version: number;

  prefs: Partial<HostelPreferences>;
  footer?: string | null;

  verification_url?: string | null;
}

/**
 * Ink on paper, one restrained accent.
 *
 * The document this replaces was built from full-bleed charcoal bands and a
 * saturated orange, which reads as a promotion rather than a financial record
 * — and costs a lot of toner on the printout a resident actually keeps. The
 * palette below is the one banks and payment processors converged on for the
 * same reason: near-black text, hairline rules, and colour reserved for the
 * two things worth finding at a glance (who issued it, and that it is paid).
 */
const INK = rgb(0.10, 0.10, 0.11);
const MUTED = rgb(0.42, 0.42, 0.45);
const FAINT = rgb(0.60, 0.60, 0.63);
const RULE = rgb(0.87, 0.87, 0.88);
const RULE_STRONG = rgb(0.72, 0.72, 0.74);
const ACCENT = rgb(0.72, 0.28, 0.16);
const PAID_GREEN = rgb(0.11, 0.45, 0.28);
const PAID_WASH = rgb(0.94, 0.97, 0.95);
const PAPER = rgb(1, 1, 1);
const WASH = rgb(0.976, 0.976, 0.98);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const FONT_DIR = path.join(process.cwd(), "lib", "pdf", "fonts");
/** The Stayo mark, kept inside the backend so it deploys with it. */
const BRAND_MARK = path.join(process.cwd(), "lib", "pdf", "brand", "stayo-mark.png");

type Fonts = { regular: PDFFont; medium: PDFFont; mono: PDFFont };

/**
 * Inter carries U+20B9, pdf-lib's built-in Helvetica does not — its WinAnsi
 * encoding has no rupee glyph at all, which is the entire reason the old
 * template shipped `Rs. 16,000` on an Indian rent receipt. Embedding a real
 * font is what fixes it; `sanitizeText`'s `₹` → `Rs. ` substitution is gone.
 */
async function loadFonts(pdfDoc: PDFDocument): Promise<Fonts> {
  pdfDoc.registerFontkit(fontkit);
  const [regular, medium, mono] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, "inter-400.ttf")),
    fs.readFile(path.join(FONT_DIR, "inter-500.ttf")),
    fs.readFile(path.join(FONT_DIR, "dm-mono-400.ttf")),
  ]);
  return {
    // NOT subset, deliberately. pdf-lib's subsetter drops most Latin glyphs
    // from these Inter builds — the first render of this template came out as
    // "raba T a a 32" where "Hyderabad, Telangana 500032" belonged. A receipt
    // with missing letters is worse than a larger file, so Inter is embedded
    // whole (~350KB); DM Mono subsets correctly and does.
    regular: await pdfDoc.embedFont(regular, { subset: false }),
    medium: await pdfDoc.embedFont(medium, { subset: false }),
    // Reference codes only — DM Mono has no ₹ glyph, so no amount uses it.
    mono: await pdfDoc.embedFont(mono, { subset: true }),
  };
}

type TextOpts = {
  size?: number;
  font?: PDFFont;
  color?: RGB;
  /** Letter-spaced small caps, for section labels. */
  tracking?: number;
};

function draw(page: PDFPage, text: string, x: number, y: number, fonts: Fonts, opts: TextOpts = {}) {
  const size = opts.size ?? 9.5;
  const font = opts.font ?? fonts.regular;
  const color = opts.color ?? INK;
  if (!text) return;

  if (opts.tracking) {
    let cursor = x;
    for (const char of text) {
      page.drawText(char, { x: cursor, y, size, font, color });
      cursor += font.widthOfTextAtSize(char, size) + opts.tracking;
    }
    return;
  }
  page.drawText(text, { x, y, size, font, color });
}

function drawRight(page: PDFPage, text: string, right: number, y: number, fonts: Fonts, opts: TextOpts = {}) {
  const size = opts.size ?? 9.5;
  const font = opts.font ?? fonts.regular;
  draw(page, text, right - font.widthOfTextAtSize(text, size), y, fonts, opts);
}

function rule(page: PDFPage, y: number, color = RULE, thickness = 0.6, x = MARGIN, width = CONTENT_W) {
  page.drawRectangle({ x, y, width, height: thickness, color });
}

/** Section label — letter-spaced, small, muted. Does the work a heavy bar did. */
function sectionLabel(page: PDFPage, text: string, y: number, fonts: Fonts, x = MARGIN) {
  draw(page, text.toUpperCase(), x, y, fonts, {
    size: 7.5,
    font: fonts.medium,
    color: FAINT,
    tracking: 1.1,
  });
}

/** Wrap to a width, so a long hostel name or note never runs off the page. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function loadLogo(pdfDoc: PDFDocument, url: string | null) {
  if (url) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const bytes = await response.arrayBuffer();
        return url.toLowerCase().includes(".png")
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
      }
    } catch {
      // A missing logo is a monogram, not a failed receipt.
    }
  }
  return null;
}

export async function generateReceiptPdf(data: ReceiptRenderData): Promise<Uint8Array> {
  const p = data.prefs;

  const content: ReceiptContent = buildReceiptContent({
    hostel_name: data.hostel_name,
    hostel_address: data.hostel_address,
    hostel_city: data.hostel_city,
    hostel_state: data.hostel_state,
    hostel_pincode: data.hostel_pincode,
    hostel_phone: data.hostel_phone,
    hostel_gst: data.hostel_gst,
    receipt_number: data.receipt_number,
    issued_at_display: formatShortDate(data.issued_at, p),
    payment_date_display: formatShortDate(data.payment_date, p),
    payment_method: data.payment_method,
    transaction_id: data.transaction_id,
    reference_number: data.reference_number,
    tenant_name: data.tenant_name,
    tenant_phone: data.tenant_phone,
    tenant_email: data.tenant_email,
    room_no: data.room_no,
    room_floor: data.room_floor,
    settlement_allocations: (data.settlement_allocations || []).map((allocation) => ({
      type: allocation.type,
      label: allocation.label,
      allocated: allocation.allocated,
      rent_month_display: allocation.rent_month ? formatMonthYear(allocation.rent_month, p) : null,
    })),
    future_credit_allocated: data.future_credit_allocated,
    total_transaction_paid: data.total_transaction_paid,
    outstanding_balance_after: data.outstanding_balance_after,
    future_credit_balance_after: data.future_credit_balance_after,
    verification_url: data.verification_url || null,
    footer: data.footer || null,
  });

  const pdfDoc = await PDFDocument.create();

  // Metadata names the *issuing hostel*, from data. The old template hardcoded
  // a retired single-hostel identity here and in the footer — see
  // `receipt-content.ts` for the full list of what that broke.
  pdfDoc.setTitle(`Payment receipt ${content.receiptNumber} — ${content.issuerName}`);
  pdfDoc.setAuthor(content.issuerName);
  pdfDoc.setSubject("Payment receipt");
  pdfDoc.setCreator("Stayo");
  pdfDoc.setProducer("Stayo");
  pdfDoc.setKeywords([
    `ReceiptNumber:${content.receiptNumber}`,
    `PaymentID:${data.payment_id || ""}`,
    `TenantID:${data.tenant_id || ""}`,
    `ReceiptID:${data.receipt_id || ""}`,
    `TemplateVersion:${data.template_version || 5}`,
  ]);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const fonts = await loadFonts(pdfDoc);

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER });

  // A Stayo edge along the top. Both brands are present on this document and
  // this is the platform's: a 3pt rule reads as a mark of origin without
  // competing with the hostel, which is the party the money actually went to
  // and therefore the one that must head the page.
  page.drawRectangle({ x: 0, y: PAGE_H - 3, width: PAGE_W, height: 3, color: ACCENT });

  // The Stayo mark, watermarked. Drawn first so every line of the receipt sits
  // over it, and at 4% so it registers as a ground rather than as content —
  // a watermark that competes with an amount is a defect, not branding. It
  // also occupies the empty middle band an A4 receipt with few line items
  // inevitably leaves.
  try {
    const markBytes = await fs.readFile(BRAND_MARK);
    const mark = await pdfDoc.embedPng(markBytes);
    const markW = 300;
    const markH = (mark.height / mark.width) * markW;
    page.drawImage(mark, {
      x: (PAGE_W - markW) / 2,
      y: (PAGE_H - markH) / 2 - 40,
      width: markW,
      height: markH,
      opacity: 0.04,
    });
  } catch {
    // A missing mark is a plainer receipt, not a failed one.
  }

  let y = PAGE_H - MARGIN;

  // ── Masthead ─────────────────────────────────────────────────────────────
  // The hostel is the issuer of this document and reads first; Stayo carries
  // it and is attributed in the footer. Both brands are present, in the order
  // that matches who the money went to.
  const logo = await loadLogo(pdfDoc, data.hostel_logo_url);
  const markSize = 34;
  const markTop = y - markSize;

  if (logo) {
    page.drawImage(logo, { x: MARGIN, y: markTop, width: markSize, height: markSize });
  } else {
    page.drawRectangle({
      x: MARGIN,
      y: markTop,
      width: markSize,
      height: markSize,
      color: WASH,
      borderColor: RULE,
      borderWidth: 0.6,
    });
    const mono = content.monogram;
    draw(
      page,
      mono,
      MARGIN + (markSize - fonts.medium.widthOfTextAtSize(mono, 11)) / 2,
      markTop + 12,
      fonts,
      { size: 11, font: fonts.medium, color: ACCENT }
    );
  }

  const textLeft = MARGIN + markSize + 12;
  draw(page, content.issuerName, textLeft, y - 12, fonts, { size: 14, font: fonts.medium });
  if (content.issuerAddress) {
    const addressLines = wrap(content.issuerAddress, fonts.regular, 8.5, 260);
    addressLines.slice(0, 2).forEach((line, index) => {
      draw(page, line, textLeft, y - 25 - index * 10, fonts, { size: 8.5, color: MUTED });
    });
  }

  drawRight(page, content.documentTitle, PAGE_W - MARGIN, y - 12, fonts, {
    size: 12,
    font: fonts.medium,
    color: MUTED,
    tracking: 2.4,
  });
  drawRight(page, content.receiptNumber, PAGE_W - MARGIN, y - 27, fonts, {
    size: 10,
    font: fonts.mono,
    color: INK,
  });

  y = markTop - 20;
  rule(page, y, RULE_STRONG, 1);
  y -= 26;

  // ── Meta + payee, two columns ────────────────────────────────────────────
  const colRight = MARGIN + CONTENT_W * 0.52;
  let leftY = y;
  let rightY = y;

  sectionLabel(page, "Billed to", leftY, fonts);
  leftY -= 15;
  draw(page, content.payeeName, MARGIN, leftY, fonts, { size: 11, font: fonts.medium });
  leftY -= 13;
  for (const line of content.payeeLines) {
    draw(page, line, MARGIN, leftY, fonts, { size: 8.8, color: MUTED });
    leftY -= 11.5;
  }

  sectionLabel(page, "Payment", rightY, fonts, colRight);
  rightY -= 15;
  for (const entry of content.meta) {
    draw(page, entry.label, colRight, rightY, fonts, { size: 8.8, color: MUTED });
    // Codes in mono so a reference can be read back over the phone; everything
    // else in Inter, which is also the only font here carrying ₹.
    const isCode = entry.label === "Transaction ID" || entry.label === "Reference";
    draw(page, entry.value, colRight + 82, rightY, fonts, {
      size: isCode ? 8.4 : 9,
      font: isCode ? fonts.mono : fonts.medium,
    });
    rightY -= 13;
  }

  y = Math.min(leftY, rightY) - 16;

  // ── What this payment settled ────────────────────────────────────────────
  sectionLabel(page, content.settlementHeading, y, fonts);
  y -= 12;
  rule(page, y, RULE);
  y -= 17;

  for (const line of content.settlement) {
    draw(page, line.label, MARGIN, y, fonts, { size: 10 });
    drawRight(page, line.amount, PAGE_W - MARGIN, y, fonts, { size: 10, font: fonts.medium });
    y -= line.note ? 12 : 19;
    if (line.note) {
      draw(page, line.note, MARGIN, y, fonts, { size: 8, color: FAINT });
      y -= 17;
    }
  }

  if (content.settlement.length === 0) {
    draw(page, "Payment received", MARGIN, y, fonts, { size: 10, color: MUTED });
    y -= 19;
  }

  y -= 2;
  rule(page, y, RULE_STRONG, 0.8);
  y -= 22;

  draw(page, content.totalLabel, MARGIN, y, fonts, { size: 11, font: fonts.medium });
  drawRight(page, content.totalAmount, PAGE_W - MARGIN, y - 3, fonts, { size: 17, font: fonts.medium });
  y -= 30;

  // ── Paid stamp + position afterwards ─────────────────────────────────────
  const stampW = 92;
  const stampH = 26;
  const stampX = PAGE_W - MARGIN - stampW;
  page.drawRectangle({
    x: stampX,
    y: y - stampH + 8,
    width: stampW,
    height: stampH,
    color: PAID_WASH,
    borderColor: PAID_GREEN,
    borderWidth: 0.8,
  });
  const paidText = "PAID";
  draw(
    page,
    paidText,
    stampX + (stampW - fonts.medium.widthOfTextAtSize(paidText, 10) - 2.4 * (paidText.length - 1)) / 2,
    y - stampH + 18,
    fonts,
    { size: 10, font: fonts.medium, color: PAID_GREEN, tracking: 2.4 }
  );

  if (content.position.length > 0) {
    let positionY = y;
    for (const entry of content.position) {
      draw(page, entry.label, MARGIN, positionY, fonts, { size: 9, color: MUTED });
      draw(page, entry.value, MARGIN + 110, positionY, fonts, { size: 9.5, font: fonts.medium });
      positionY -= 14;
    }
    y = Math.min(y - stampH, positionY) - 8;
  } else {
    y -= stampH + 8;
  }

  // ── Verification ─────────────────────────────────────────────────────────
  // Anchored above the footer rather than directly under the content: a
  // receipt with one line item leaves most of an A4 page empty, and splitting
  // that space in two reads as composition instead of an unfinished document.
  const footerTop = MARGIN + 42;
  if (content.verifyUrl) {
    const panelH = 84;
    const panelY = footerTop + 26;
    // A panel rather than a bare rule: verification is the one promise the
    // platform makes on this document, so it is given a surface of its own.
    page.drawRectangle({
      x: MARGIN,
      y: panelY,
      width: CONTENT_W,
      height: panelH,
      color: WASH,
      borderColor: RULE,
      borderWidth: 0.6,
    });
    page.drawRectangle({ x: MARGIN, y: panelY, width: 2.5, height: panelH, color: ACCENT });

    const qrSize = 56;
    const qrX = MARGIN + 16;
    const qrY = panelY + (panelH - qrSize) / 2;
    try {
      const qrDataUrl = await QRCode.toDataURL(content.verifyUrl, {
        margin: 0,
        width: 240,
        color: { dark: "#1A1A1C", light: "#FFFFFF" },
      });
      const qrImage = await pdfDoc.embedPng(qrDataUrl);
      page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    } catch {
      // No QR is survivable; the URL below still verifies the receipt.
    }

    const panelTextX = qrX + qrSize + 16;
    draw(page, content.verifyHeading, panelTextX, panelY + panelH - 26, fonts, {
      size: 10,
      font: fonts.medium,
    });
    draw(page, content.verifyNote, panelTextX, panelY + panelH - 39, fonts, { size: 8.2, color: MUTED });
    wrap(content.verifyUrl, fonts.mono, 7.2, CONTENT_W - (panelTextX - MARGIN) - 20)
      .slice(0, 2)
      .forEach((line, index) => {
        draw(page, line, panelTextX, panelY + panelH - 54 - index * 9, fonts, {
          size: 7.2,
          font: fonts.mono,
          color: FAINT,
        });
      });
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  rule(page, footerTop, RULE);

  const noteLines = wrap(content.footerNote, fonts.regular, 7.6, CONTENT_W);
  noteLines.slice(0, 2).forEach((line, index) => {
    draw(page, line, MARGIN, footerTop - 14 - index * 9.5, fonts, { size: 7.6, color: FAINT });
  });

  draw(page, content.footerLeft, MARGIN, MARGIN - 8, fonts, { size: 8.4, font: fonts.medium, color: MUTED });
  if (content.issuerGst) {
    draw(page, `GSTIN ${content.issuerGst}`, MARGIN, MARGIN - 19, fonts, { size: 7.6, color: FAINT });
  }
  // The platform wordmark, set as a mark rather than a sentence — the hostel
  // still owns the left of the footer and the top of the page.
  drawRight(page, "STAYO", PAGE_W - MARGIN, MARGIN - 6, fonts, {
    size: 11,
    font: fonts.medium,
    color: ACCENT,
    tracking: 2.6,
  });
  drawRight(page, content.platformDomain, PAGE_W - MARGIN, MARGIN - 18, fonts, {
    size: 7.4,
    color: FAINT,
  });

  return pdfDoc.save();
}
