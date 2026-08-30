import fs from "fs/promises";
import path from "path";
import { PDFDocument, PDFFont, PDFPage, RGB, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import type { MenuContent } from "./menu-content";

/**
 * The weekly menu, rendered for a wall.
 *
 * Layout only — every string comes from `menu-content.ts`, the same split the
 * receipt uses. The constraint that drives all of this is that **nobody holds
 * this document.** It is taped up in a canteen and read from two metres away
 * by someone deciding whether to eat in, so it is A4 **landscape** (seven rows
 * against four wide columns will not fit portrait without cramping the dish
 * lists), body text is far larger than any other document this system makes,
 * and rows alternate tint so the eye can track across a row at a distance.
 *
 * The hostel owns the page: its logo and name lead, and Stayo signs the
 * footer with a QR to that hostel's own listing. A prospective resident
 * scanning it lands on the hostel's page, which serves the owner and Stayo at
 * once — where a large Stayo mark on somebody else's menu would read as an
 * advert and quietly stop getting printed. See ADR-144.
 */

// A4 landscape.
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 34;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.1, 0.1, 0.11);
const MUTED = rgb(0.42, 0.42, 0.45);
const FAINT = rgb(0.6, 0.6, 0.63);
const RULE = rgb(0.84, 0.84, 0.86);
const RULE_STRONG = rgb(0.62, 0.62, 0.65);
const ACCENT = rgb(0.72, 0.28, 0.16);
const ZEBRA = rgb(0.973, 0.965, 0.957);
const HEADER_WASH = rgb(0.945, 0.925, 0.906);
const PAPER = rgb(1, 1, 1);

const FONT_DIR = path.join(process.cwd(), "lib", "pdf", "fonts");
const BRAND_MARK = path.join(process.cwd(), "lib", "pdf", "brand", "stayo-mark.png");

/** Day column, then four equal meal columns. */
const DAY_COL_W = 104;
const MEAL_COL_W = (CONTENT_W - DAY_COL_W) / 4;

interface Fonts {
  regular: PDFFont;
  medium: PDFFont;
  display: PDFFont;
}

async function loadFonts(pdfDoc: PDFDocument): Promise<Fonts> {
  pdfDoc.registerFontkit(fontkit);
  const [regular, medium, display] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, "inter-400.ttf")),
    fs.readFile(path.join(FONT_DIR, "inter-500.ttf")),
    fs.readFile(path.join(FONT_DIR, "playfair-700.ttf")),
  ]);
  // Not subset, for the reason the receipt template documents: pdf-lib's
  // subsetter drops most Latin glyphs from these Inter builds and the page
  // comes out with letters missing.
  return {
    regular: await pdfDoc.embedFont(regular, { subset: false }),
    medium: await pdfDoc.embedFont(medium, { subset: false }),
    display: await pdfDoc.embedFont(display, { subset: false }),
  };
}

function draw(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; font: PDFFont; color?: RGB },
) {
  page.drawText(text, {
    x,
    y,
    size: opts.size ?? 11,
    font: opts.font,
    color: opts.color ?? INK,
  });
}

/** Greedy wrap to a pixel width. Dish lists are the only thing here long enough to need it. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Never silently drop a dish: if it did not fit, say so with an ellipsis so
  // a reader knows to ask rather than assuming that is the whole meal.
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    const joined = lines.join(" ");
    if (joined.length < text.length) {
      let truncated = last;
      while (
        truncated &&
        font.widthOfTextAtSize(`${truncated} …`, size) > maxWidth
      ) {
        truncated = truncated.slice(0, -1);
      }
      lines[maxLines - 1] = `${truncated} …`;
    }
  }

  return lines;
}

export async function renderMenuPdf(content: MenuContent): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await loadFonts(pdfDoc);
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER });

  pdfDoc.setTitle(`${content.hostelName} — ${content.title} — ${content.monthLabel}`);
  pdfDoc.setAuthor(content.hostelName);
  pdfDoc.setCreator("Stayo");

  // ── Masthead ──────────────────────────────────────────────────────────
  let y = PAGE_H - MARGIN;

  // A thin accent edge, the same device the receipt uses to tie the document
  // to the product without taking the hostel's masthead away from it.
  page.drawRectangle({ x: 0, y: PAGE_H - 5, width: PAGE_W, height: 5, color: ACCENT });
  y -= 12;

  const badgeSize = 44;
  const badgeY = y - badgeSize;
  let logoDrawn = false;

  if (content.logoUrl) {
    try {
      const response = await fetch(content.logoUrl);
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const type = response.headers.get("content-type") ?? "";
        const image = type.includes("png")
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
        page.drawImage(image, { x: MARGIN, y: badgeY, width: badgeSize, height: badgeSize });
        logoDrawn = true;
      }
    } catch {
      // A logo that will not load must never cost the hostel its menu. The
      // monogram below is a complete substitute.
    }
  }

  if (!logoDrawn) {
    page.drawRectangle({
      x: MARGIN,
      y: badgeY,
      width: badgeSize,
      height: badgeSize,
      color: HEADER_WASH,
      borderColor: RULE,
      borderWidth: 0.75,
    });
    const monoWidth = fonts.display.widthOfTextAtSize(content.monogram, 18);
    draw(page, content.monogram, MARGIN + (badgeSize - monoWidth) / 2, badgeY + 15, {
      size: 18,
      font: fonts.display,
      color: ACCENT,
    });
  }

  const textX = MARGIN + badgeSize + 14;
  draw(page, content.hostelName, textX, badgeY + badgeSize - 20, {
    size: 21,
    font: fonts.display,
  });

  const subParts = [content.addressLine, content.contactLine].filter(Boolean).join("  ·  ");
  if (subParts) {
    draw(page, subParts, textX, badgeY + 6, { size: 9.5, font: fonts.regular, color: MUTED });
  }

  // Title block, right-aligned against the margin.
  const titleText = content.title.toUpperCase();
  const titleWidth = fonts.medium.widthOfTextAtSize(titleText, 12);
  draw(page, titleText, PAGE_W - MARGIN - titleWidth, badgeY + badgeSize - 16, {
    size: 12,
    font: fonts.medium,
    color: ACCENT,
  });

  const monthWidth = fonts.display.widthOfTextAtSize(content.monthLabel, 17);
  draw(page, content.monthLabel, PAGE_W - MARGIN - monthWidth, badgeY + badgeSize - 38, {
    size: 17,
    font: fonts.display,
  });

  if (content.draftNotice) {
    // Clear of the month by a full line. At the original spacing the notice
    // sat against the descenders of "August 2026" and read as one smudged
    // block — on a sheet whose entire job is being legible across a room.
    const noticeSize = 8.5;
    const noticeWidth = fonts.medium.widthOfTextAtSize(content.draftNotice, noticeSize);
    const padX = 7;
    const padY = 4;
    const pillW = noticeWidth + padX * 2;
    const pillH = noticeSize + padY * 2;
    const pillX = PAGE_W - MARGIN - pillW;
    const pillY = badgeY - 16;

    page.drawRectangle({
      x: pillX,
      y: pillY,
      width: pillW,
      height: pillH,
      color: HEADER_WASH,
      borderColor: ACCENT,
      borderWidth: 0.5,
    });
    draw(page, content.draftNotice, pillX + padX, pillY + padY + 1, {
      size: noticeSize,
      font: fonts.medium,
      color: ACCENT,
    });
  }

  y = badgeY - (content.draftNotice ? 30 : 18);

  // ── Table ─────────────────────────────────────────────────────────────
  const footerH = 54;
  const tableTop = y;
  const tableBottom = MARGIN + footerH;
  const headerH = 34;
  const bodyH = tableTop - headerH - tableBottom;
  const rowH = bodyH / content.rows.length;

  const columnX = (index: number) => MARGIN + DAY_COL_W + index * MEAL_COL_W;

  // Header band.
  page.drawRectangle({
    x: MARGIN,
    y: tableTop - headerH,
    width: CONTENT_W,
    height: headerH,
    color: HEADER_WASH,
  });

  draw(page, "DAY", MARGIN + 12, tableTop - 15, {
    size: 10.5,
    font: fonts.medium,
    color: MUTED,
  });

  content.columns.forEach((column, index) => {
    const x = columnX(index) + 10;
    draw(page, column.label.toUpperCase(), x, tableTop - 15, {
      size: 10.5,
      font: fonts.medium,
    });
    if (column.window) {
      draw(page, column.window, x, tableTop - 27, {
        size: 8.5,
        font: fonts.regular,
        color: MUTED,
      });
    }
  });

  // Body rows.
  content.rows.forEach((row, rowIndex) => {
    const rowTop = tableTop - headerH - rowIndex * rowH;
    const rowBottom = rowTop - rowH;

    if (rowIndex % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: rowBottom, width: CONTENT_W, height: rowH, color: ZEBRA });
    }

    draw(page, row.label, MARGIN + 12, rowBottom + rowH / 2 - 4, {
      size: 11,
      font: fonts.medium,
    });

    row.cells.forEach((cell, cellIndex) => {
      const x = columnX(cellIndex) + 10;
      const maxWidth = MEAL_COL_W - 20;
      const lines = wrap(cell, fonts.regular, 10.5, maxWidth, 3);
      const blockH = lines.length * 13;
      let lineY = rowBottom + rowH / 2 + blockH / 2 - 11;
      for (const line of lines) {
        draw(page, line, x, lineY, { size: 10.5, font: fonts.regular });
        lineY -= 13;
      }
    });

    page.drawLine({
      start: { x: MARGIN, y: rowBottom },
      end: { x: MARGIN + CONTENT_W, y: rowBottom },
      thickness: 0.5,
      color: RULE,
    });
  });

  // Column separators and the table's outer edge, drawn last so they sit on top.
  for (let index = 0; index <= 4; index += 1) {
    const x = index === 0 ? MARGIN + DAY_COL_W : columnX(index);
    page.drawLine({
      start: { x, y: tableTop },
      end: { x, y: tableBottom },
      thickness: 0.5,
      color: RULE,
    });
  }
  page.drawRectangle({
    x: MARGIN,
    y: tableBottom,
    width: CONTENT_W,
    height: tableTop - tableBottom,
    borderColor: RULE_STRONG,
    borderWidth: 0.75,
  });

  // ── Footer: Stayo signs it, the QR points at the hostel ───────────────
  const footerY = MARGIN;
  page.drawLine({
    start: { x: MARGIN, y: footerY + footerH - 8 },
    end: { x: MARGIN + CONTENT_W, y: footerY + footerH - 8 },
    thickness: 0.5,
    color: RULE,
  });

  try {
    const markBytes = await fs.readFile(BRAND_MARK);
    const mark = await pdfDoc.embedPng(markBytes);
    const markH = 16;
    const markW = (mark.width / mark.height) * markH;
    page.drawImage(mark, { x: MARGIN, y: footerY + 12, width: markW, height: markH });
    draw(page, content.footerNote, MARGIN + markW + 10, footerY + 16, {
      size: 8.5,
      font: fonts.regular,
      color: MUTED,
    });
  } catch {
    draw(page, content.footerNote, MARGIN, footerY + 16, {
      size: 8.5,
      font: fonts.regular,
      color: MUTED,
    });
  }

  if (content.qrUrl) {
    try {
      const qrDataUrl = await QRCode.toDataURL(content.qrUrl, {
        margin: 0,
        width: 240,
        color: { dark: "#1A1A1C", light: "#FFFFFF" },
      });
      const qrImage = await pdfDoc.embedPng(qrDataUrl);
      const qrSize = 40;
      const qrX = PAGE_W - MARGIN - qrSize;
      page.drawImage(qrImage, { x: qrX, y: footerY + 3, width: qrSize, height: qrSize });

      if (content.qrCaption) {
        const captionWidth = fonts.regular.widthOfTextAtSize(content.qrCaption, 8);
        draw(page, content.qrCaption, qrX - captionWidth - 10, footerY + 20, {
          size: 8,
          font: fonts.regular,
          color: FAINT,
        });
      }
    } catch {
      // No QR is entirely survivable — the menu is the point of the page.
    }
  }

  return pdfDoc.save();
}
