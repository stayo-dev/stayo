import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { invoiceRepository } from "@/src/repositories/invoiceRepository";
import { imagekit } from "@/lib/imagekit";
import { resolvePreferences } from "@/lib/preferences";
import { formatCurrency, formatShortDate, formatMonthYear, getCurrencySymbol } from "@/lib/format";
import { timed } from "@/lib/perf";
import { incrementPdfCache } from "@/lib/metrics";
import { acquireSystemLock, releaseSystemLock, sleep } from "@/lib/lock";

// ── Template Version (bump this when the PDF layout changes) ──
const INVOICE_TEMPLATE_VERSION = 3;

// ── Color Palette (Slate Design System) ──
const COLORS = {
  black:      rgb(0.06, 0.09, 0.16),   // #0f172a
  dark:       rgb(0.12, 0.14, 0.21),   // #1e293b
  body:       rgb(0.20, 0.25, 0.33),   // #334155
  muted:      rgb(0.39, 0.45, 0.53),   // #64748b
  light:      rgb(0.58, 0.64, 0.70),   // #94a3b8
  line:       rgb(0.89, 0.91, 0.94),   // #e2e8f0
  bgGray:     rgb(0.97, 0.98, 0.99),   // #f8fafc
  green:      rgb(0.02, 0.59, 0.41),   // #059669
  red:        rgb(0.86, 0.15, 0.15),   // #dc2626
  white:      rgb(1, 1, 1),
};

// ── Helper: Draw right-aligned text ──
function drawTextRight(page: PDFPage, text: string, rightX: number, y: number, font: PDFFont, size: number, color = COLORS.body) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - width, y, size, font, color });
}

// ── Helper: Draw a filled rectangle ──
function drawRect(page: PDFPage, x: number, y: number, w: number, h: number, color = COLORS.bgGray) {
  page.drawRectangle({ x, y, width: w, height: h, color });
}

export class InvoiceService {
  async generateInvoicePDF(paymentId: string) {
    // ── 1. DATA FETCH ──
    let receipt = await invoiceRepository.getReceiptByPaymentId(paymentId);

    if (!receipt) {
      const payment = await invoiceRepository.getPaymentWithObligationAndTenant(paymentId);
      if (!payment) throw new Error("Valid transaction payment not found");
      if (!payment.hostel_id) {
        throw new Error("HOSTEL_CONTEXT_REQUIRED: Payment is missing immutable hostel context");
      }
      if (payment.tenants?.hostel_id && payment.tenants.hostel_id !== payment.hostel_id) {
        throw new Error("HOSTEL_CONTEXT_MISMATCH: Payment hostel does not match tenant hostel");
      }
      if (payment.obligation?.hostel_id && payment.obligation.hostel_id !== payment.hostel_id) {
        throw new Error("HOSTEL_CONTEXT_MISMATCH: Payment hostel does not match obligation hostel");
      }

      receipt = await prisma.receipts.create({
        data: {
          id: crypto.randomUUID(),
          payment_id: payment.id,
          tenant_id: payment.tenant_id,
          amount: payment.amount_paid,
          payment_method: payment.payment_method,
          transaction_id: payment.reference_number || undefined,
          receipt_number: `HMS-${new Date().getFullYear()}-${new Date().getTime().toString().slice(-5)}`,
          rent_month: payment.obligation?.rent_month || undefined,
          tenant_name: payment.tenants?.profiles?.name || '-',
          owner_id: payment.owner_id,
          hostel_id: payment.hostel_id,
          hostel_name: payment.tenants?.hostel_id ? undefined : null,
        },
        include: {
          payments: true,
          tenants: { include: { profiles: true } }
        }
      });
    }

    // ── CACHE CHECK (version-aware) ──
    const cachedUrl     = receipt.invoice_pdf_url;
    const cachedVersion = receipt.invoice_template_version;
    if (cachedUrl && cachedVersion === INVOICE_TEMPLATE_VERSION) {
      incrementPdfCache("invoice_hit");
      return { url: cachedUrl, cached: true };
    }
    incrementPdfCache("invoice_miss");

    // 1.5 Concurrency Protection
    const lockKey = `pdf_invoice_${receipt.id}`;
    const acquired = await acquireSystemLock(lockKey, 30);
    
    if (!acquired) {
      incrementPdfCache("contention");
      // Another request is currently rendering this invoice.
      for (let i = 0; i < 6; i++) {
        await sleep(500);
        const fresh = await invoiceRepository.getReceiptByIdAndVersion(receipt.id, INVOICE_TEMPLATE_VERSION);
        if (fresh?.invoice_pdf_url && fresh.invoice_template_version === INVOICE_TEMPLATE_VERSION) {
          incrementPdfCache("invoice_hit");
          return { url: fresh.invoice_pdf_url, cached: true };
        }
      }
      // Timed out waiting for the other request. Proceed to render.
    }

    try {
      const hostelIdFromReceipt = (receipt as any).hostel_id || (receipt as any).payment?.hostel_id;
      if (!hostelIdFromReceipt) {
        throw new Error("HOSTEL_CONTEXT_REQUIRED: Receipt is missing immutable hostel context");
      }
      if ((receipt as any).payment?.hostel_id && (receipt as any).payment.hostel_id !== hostelIdFromReceipt) {
        throw new Error("HOSTEL_CONTEXT_MISMATCH: Receipt hostel does not match payment hostel");
      }
      const hostel = await prisma.hostels.findUnique({ where: { id: hostelIdFromReceipt } });
      const prefs = resolvePreferences(hostel);
      if (!hostel) throw new Error("Hostel details not found");

    const allocation = await prisma.roomAllocation.findFirst({
      where: { tenant_id: receipt.tenant_id, hostel_id: hostelIdFromReceipt },
      include: { room: true },
      orderBy: { start_date: 'desc' }
    });

    // ── 2. PREPARE DATA ──
    const tenantName = (receipt as any).tenants.profiles?.name || receipt.tenant_name || "Unknown Tenant";
    const tenantPhone = (receipt as any).tenants.profiles?.phone || "N/A";
    const tenantEmail = (receipt as any).tenants.profiles?.email || "";
    const roomNo = allocation?.room?.room_no || "N/A";
    const tenantId = (receipt as any).tenants.id.split('-')[0].toUpperCase();
    const curr = getCurrencySymbol(prefs);
    const amountVal = Number(receipt.amount).toFixed(2);
    const monthLabel = formatMonthYear(receipt.rent_month, prefs);
    const issueDate = formatShortDate(receipt.issued_at, prefs);
    const paymentDate = formatShortDate((receipt as any).payments.payment_date, prefs);

    // ── 3. CREATE PDF ──
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const LEFT = 48;
    const RIGHT = 547;
    const COL2_X = 320;
    let Y = 794; // Start cursor

    // ════════════════════════════════════════════════
    // HEADER ROW: Logo placeholder + Invoice Number
    // ════════════════════════════════════════════════
    page.drawText(hostel.name.toUpperCase(), { x: LEFT, y: Y, size: 9, font: fontBold, color: COLORS.light });
    drawTextRight(page, `NO. ${receipt.receipt_number}`, RIGHT, Y, font, 9, COLORS.muted);

    // ════════════════════════════════════════════════
    // TITLE: INVOICE
    // ════════════════════════════════════════════════
    Y -= 40;
    page.drawText("RECEIPT", { x: LEFT, y: Y, size: 42, font: fontBold, color: COLORS.black });

    // ════════════════════════════════════════════════
    // META ROW: Date | Rent Month | Status
    // ════════════════════════════════════════════════
    Y -= 36;
    // Date
    page.drawText("DATE", { x: LEFT, y: Y, size: 8, font: fontBold, color: COLORS.light });
    page.drawText(issueDate, { x: LEFT, y: Y - 14, size: 11, font: fontBold, color: COLORS.dark });

    // Rent Month
    page.drawText("RENT MONTH", { x: LEFT + 140, y: Y, size: 8, font: fontBold, color: COLORS.light });
    page.drawText(monthLabel, { x: LEFT + 140, y: Y - 14, size: 11, font: fontBold, color: COLORS.dark });

    // Status Badge
    page.drawText("STATUS", { x: LEFT + 320, y: Y, size: 8, font: fontBold, color: COLORS.light });
    // Green badge background
    drawRect(page, LEFT + 320, Y - 20, 52, 18, rgb(0.93, 0.99, 0.96));
    page.drawText("PAID", { x: LEFT + 332, y: Y - 15, size: 9, font: fontBold, color: COLORS.green });

    // Divider line
    Y -= 40;
    page.drawLine({ start: { x: LEFT, y: Y }, end: { x: RIGHT, y: Y }, thickness: 0.5, color: COLORS.line });

    // ════════════════════════════════════════════════
    // ADDRESS SECTION: Billed To | From
    // ════════════════════════════════════════════════
    Y -= 24;
    const addrStartY = Y;

    // — BILLED TO —
    page.drawText("BILLED TO", { x: LEFT, y: Y, size: 8, font: fontBold, color: COLORS.light });
    Y -= 16;
    page.drawText(tenantName, { x: LEFT, y: Y, size: 13, font: fontBold, color: COLORS.black });
    Y -= 16;
    page.drawText(`Room: ${roomNo}`, { x: LEFT, y: Y, size: 10, font, color: COLORS.body });
    Y -= 14;
    page.drawText(`ID: ${tenantId}`, { x: LEFT, y: Y, size: 10, font, color: COLORS.body });
    Y -= 14;
    page.drawText(`Phone: ${tenantPhone}`, { x: LEFT, y: Y, size: 10, font, color: COLORS.body });
    if (tenantEmail) {
      Y -= 14;
      page.drawText(tenantEmail, { x: LEFT, y: Y, size: 10, font, color: COLORS.body });
    }

    // — FROM —
    let fromY = addrStartY;
    page.drawText("FROM", { x: COL2_X, y: fromY, size: 8, font: fontBold, color: COLORS.light });
    fromY -= 16;
    page.drawText(hostel.name, { x: COL2_X, y: fromY, size: 13, font: fontBold, color: COLORS.black });
    fromY -= 16;
    page.drawText(hostel.address || "Address", { x: COL2_X, y: fromY, size: 10, font, color: COLORS.body });
    fromY -= 14;
    const cityLine = [hostel.city, hostel.state, hostel.pincode].filter(Boolean).join(", ");
    if (cityLine) {
      page.drawText(cityLine, { x: COL2_X, y: fromY, size: 10, font, color: COLORS.body });
      fromY -= 14;
    }
    if (hostel.phone) {
      page.drawText(`Phone: ${hostel.phone}`, { x: COL2_X, y: fromY, size: 10, font, color: COLORS.body });
      fromY -= 14;
    }
    if (hostel.upi_id) {
      page.drawText(`UPI: ${hostel.upi_id}`, { x: COL2_X, y: fromY, size: 10, font, color: COLORS.body });
      fromY -= 14;
    }
    if (hostel.gst_number) {
      page.drawText(`GST: ${hostel.gst_number}`, { x: COL2_X, y: fromY, size: 10, font, color: COLORS.body });
    }

    // ════════════════════════════════════════════════
    // ITEMS TABLE
    // ════════════════════════════════════════════════
    Y = Math.min(Y, fromY) - 36;

    // Table header background
    drawRect(page, LEFT, Y - 4, RIGHT - LEFT, 22, COLORS.bgGray);
    page.drawLine({ start: { x: LEFT, y: Y + 18 }, end: { x: RIGHT, y: Y + 18 }, thickness: 0.5, color: COLORS.line });
    page.drawLine({ start: { x: LEFT, y: Y - 4 }, end: { x: RIGHT, y: Y - 4 }, thickness: 0.5, color: COLORS.line });

    // Table header text
    page.drawText("DESCRIPTION", { x: LEFT + 8, y: Y + 4, size: 8, font: fontBold, color: COLORS.muted });
    page.drawText("MONTH", { x: 300, y: Y + 4, size: 8, font: fontBold, color: COLORS.muted });
    drawTextRight(page, "AMOUNT", RIGHT - 8, Y + 4, fontBold, 8, COLORS.muted);

    // Table row 1: Rent
    Y -= 28;
    page.drawText("Rent & Accommodation", { x: LEFT + 8, y: Y, size: 11, font, color: COLORS.body });
    page.drawText(monthLabel, { x: 300, y: Y, size: 11, font, color: COLORS.muted });
    drawTextRight(page, `${curr} ${amountVal}`, RIGHT - 8, Y, fontBold, 11, COLORS.black);
    page.drawLine({ start: { x: LEFT, y: Y - 12 }, end: { x: RIGHT, y: Y - 12 }, thickness: 0.3, color: COLORS.line });

    // ════════════════════════════════════════════════
    // TOTALS SECTION
    // ════════════════════════════════════════════════
    Y -= 36;
    const totalsX = 370;

    // Subtotal
    page.drawText("Subtotal", { x: totalsX, y: Y, size: 10, font, color: COLORS.body });
    drawTextRight(page, `${curr} ${amountVal}`, RIGHT - 8, Y, font, 10, COLORS.body);

    // Grand total line
    Y -= 20;
    page.drawLine({ start: { x: totalsX, y: Y + 6 }, end: { x: RIGHT - 8, y: Y + 6 }, thickness: 1.5, color: COLORS.black });

    Y -= 4;
    page.drawText("Total Paid", { x: totalsX, y: Y, size: 14, font: fontBold, color: COLORS.black });
    drawTextRight(page, `${curr} ${amountVal}`, RIGHT - 8, Y, fontBold, 14, COLORS.green);

    // ════════════════════════════════════════════════
    // PAYMENT DETAILS BOX
    // ════════════════════════════════════════════════
    Y -= 44;
    const payBoxH = 68;
    drawRect(page, LEFT, Y - payBoxH + 16, RIGHT - LEFT, payBoxH, COLORS.bgGray);

    // Title
    page.drawText("PAYMENT DETAILS", { x: LEFT + 16, y: Y, size: 8, font: fontBold, color: COLORS.light });

    // Row 1
    Y -= 18;
    page.drawText("Method:", { x: LEFT + 16, y: Y, size: 9, font, color: COLORS.light });
    page.drawText(receipt.payment_method || "N/A", { x: LEFT + 72, y: Y, size: 9, font: fontBold, color: COLORS.dark });

    page.drawText("Transaction ID:", { x: COL2_X, y: Y, size: 9, font, color: COLORS.light });
    page.drawText(receipt.transaction_id || "N/A", { x: COL2_X + 85, y: Y, size: 9, font: fontBold, color: COLORS.dark });

    // Row 2
    Y -= 16;
    page.drawText("Date:", { x: LEFT + 16, y: Y, size: 9, font, color: COLORS.light });
    page.drawText(paymentDate, { x: LEFT + 72, y: Y, size: 9, font: fontBold, color: COLORS.dark });

    page.drawText("Collected By:", { x: COL2_X, y: Y, size: 9, font, color: COLORS.light });
    page.drawText("System", { x: COL2_X + 85, y: Y, size: 9, font: fontBold, color: COLORS.dark });

    // ════════════════════════════════════════════════
    // FOOTER
    // ════════════════════════════════════════════════
    Y -= 44;
    page.drawLine({ start: { x: LEFT, y: Y }, end: { x: RIGHT, y: Y }, thickness: 0.5, color: COLORS.line });

    Y -= 18;
    const thankText = "Thank you for staying with us!";
    const thankWidth = fontBold.widthOfTextAtSize(thankText, 11);
    page.drawText(thankText, { x: (595 - thankWidth) / 2, y: Y, size: 11, font: fontBold, color: COLORS.body });

    Y -= 16;
    const supportText = "For support: support@example-hostel.in";
    const supportWidth = font.widthOfTextAtSize(supportText, 8);
    page.drawText(supportText, { x: (595 - supportWidth) / 2, y: Y, size: 8, font, color: COLORS.light });

    Y -= 14;
    const noteText = "This is a computer-generated invoice. No signature required.";
    const noteWidth = font.widthOfTextAtSize(noteText, 7);
    page.drawText(noteText, { x: (595 - noteWidth) / 2, y: Y, size: 7, font, color: COLORS.line });

    // ════════════════════════════════════════════════
    // DECORATIVE BOTTOM BAR
    // ════════════════════════════════════════════════
    drawRect(page, 0, 0, 595, 8, rgb(0.12, 0.14, 0.21));
    drawRect(page, 0, 8, 595, 4, rgb(0.28, 0.33, 0.41));

    // ════════════════════════════════════════════════
    // 4. SAVE & UPLOAD
    // ════════════════════════════════════════════════
    const pdfBytes = await timed(
      "pdf.invoice.render",
      async () => pdfDoc.save(),
      { receipt_id: receipt.id, slow_ms: 2_000 }
    );
    const base64Pdf = Buffer.from(pdfBytes).toString("base64");

    const uploadRes = await timed(
      "pdf.invoice.upload",
      () => imagekit.files.upload({
        file: base64Pdf,
        fileName: `invoice_${receipt.receipt_number}.pdf`,
        folder: "/invoices",
        tags: ["invoice", receipt.id]
      }),
      { receipt_id: receipt.id, slow_ms: 5_000 }
    );

    if (!uploadRes.url) throw new Error("Failed to upload PDF");

    await prisma.receipts.update({
      where: { id: receipt.id },
      data: {
        invoice_pdf_url:          uploadRes.url,
        invoice_template_version: INVOICE_TEMPLATE_VERSION,
      }
    });

    return { url: uploadRes.url, cached: false };
    } finally {
      if (acquired) {
        await releaseSystemLock(lockKey);
      }
    }
  }
}

export const invoiceService = new InvoiceService();
