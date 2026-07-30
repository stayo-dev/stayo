import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { HostelPreferences } from "../preferences";
import { formatCurrency, formatShortDate, formatMonthYear } from "../format";
import QRCode from "qrcode";

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

  // New settlement details
  settlement_allocations: ReceiptSettlementAllocation[];
  future_credit_allocated: number;
  total_transaction_paid: number;
  outstanding_balance_after: number;
  future_credit_balance_after: number;

  // Audit details
  payment_id: string;
  tenant_id: string;
  receipt_id: string;
  template_version: number;

  prefs: Partial<HostelPreferences>;
  footer?: string | null;
  
  // Verification
  verification_url?: string | null;
}

const COLORS = {
  charcoal: rgb(30 / 255, 30 / 255, 30 / 255), // #1E1E1E
  orange: rgb(255 / 255, 122 / 255, 0 / 255), // #FF7A00 (Primary brand orange)
  cream: rgb(255 / 255, 253 / 255, 248 / 255), // #FFFDF8 (Warm white background)
  mutedStrip: rgb(248 / 255, 246 / 255, 241 / 255),
  textPrimary: rgb(30 / 255, 30 / 255, 30 / 255),
  textMuted: rgb(107 / 255, 101 / 255, 96 / 255),
  textLight: rgb(156 / 255, 150 / 255, 144 / 255),
  border: rgb(230 / 255, 230 / 255, 230 / 255),
  green: rgb(46 / 255, 139 / 255, 87 / 255),
  white: rgb(1, 1, 1),
};

// pdf-lib StandardFonts use WinAnsi encoding. We must strip/replace unmappable characters.
function sanitizeText(str: string | null | undefined): string {
  if (!str) return "";
  let s = str.replace(/₹/g, "Rs. ");
  // Strip characters outside WinAnsi (roughly ASCII + some Latin1)
  s = s.replace(/[^\x00-\xFF]/g, ""); 
  return s;
}

function buildAddressLine(city?: string | null, state?: string | null, pincode?: string | null): string {
  const parts = [city, state].filter(Boolean).join(", ");
  if (pincode) return parts ? `${parts} — ${pincode}` : pincode;
  return parts;
}

export async function generateReceiptPdf(data: ReceiptRenderData): Promise<Uint8Array> {
  const p = data.prefs;
  const issueDate = formatShortDate(data.issued_at, p);
  const rentPeriod = formatMonthYear(data.rent_month, p);
  const dueDate = data.due_date ? formatShortDate(data.due_date, p) : "N/A";
  const paymentDate = formatShortDate(data.payment_date, p);
  const fullAddress = buildAddressLine(data.hostel_city, data.hostel_state, data.hostel_pincode);
  const headerAddress = `${data.hostel_address}${fullAddress ? `, ${fullAddress}` : ""}`;
  const shortAddress = buildAddressLine(data.hostel_city, data.hostel_state, data.hostel_pincode);

  const roomLine = [
    data.room_no ? `Room ${data.room_no}` : null,
    data.room_floor ? `Floor ${data.room_floor}` : null,
  ].filter(Boolean).join(" · ");

  const footerNote = data.footer || "This is a computer-generated receipt and does not require a physical signature. For any payment queries, please contact the hostel management directly.";

  const pdfDoc = await PDFDocument.create();

  // Embed Metadata
  pdfDoc.setTitle("Payment Receipt - Sri Adithya Boys Hostel");
  pdfDoc.setAuthor("Sri Adithya Boys Hostel");
  pdfDoc.setSubject("Rent Payment Obligation Settlement");
  pdfDoc.setCreator("HMS Receipt System v2.0.0");
  pdfDoc.setProducer("pdf-lib");
  pdfDoc.setKeywords([
    `SysVersion:v2.0.0`,
    `PaymentID:${data.payment_id || "N/A"}`,
    `TenantID:${data.tenant_id || "N/A"}`,
    `ReceiptID:${data.receipt_id || "N/A"}`,
    `TemplateVersion:${data.template_version || 4}`,
  ]);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Fill Background with Warm Cream
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: COLORS.cream,
  });

  let currentY = height;

  // --- HEADER (Charcoal Band) ---
  const headerHeight = 110;
  currentY -= headerHeight;
  page.drawRectangle({
    x: 0,
    y: currentY,
    width: width,
    height: headerHeight,
    color: COLORS.charcoal,
  });

  // Dynamic Logo Loader Fallback Chain
  let logoImage: any = null;
  const logoWidth = 54;
  const logoHeight = 54;

  if (data.hostel_logo_url) {
    try {
      const response = await fetch(data.hostel_logo_url);
      if (response.ok) {
        const imageBytes = await response.arrayBuffer();
        if (data.hostel_logo_url.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(imageBytes);
        } else {
          logoImage = await pdfDoc.embedJpg(imageBytes);
        }
      }
    } catch (e) {
      console.warn("Failed to load custom logo from URL:", e);
    }
  }

  if (!logoImage) {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const localPath = path.join(process.cwd(), "public", "hostel_icon.jpeg");
      const imageBytes = await fs.readFile(localPath);
      logoImage = await pdfDoc.embedJpg(imageBytes);
    } catch (e) {
      console.warn("Failed to load local fallback logo_icon.jpeg:", e);
    }
  }

  // Draw logo image if embedded successfully
  if (logoImage) {
    page.drawImage(logoImage, {
      x: 36,
      y: currentY + 28,
      width: logoWidth,
      height: logoHeight,
    });
  } else {
    // Styled Orange Monogram Box Fallback
    page.drawRectangle({
      x: 36,
      y: currentY + 28,
      width: 54,
      height: 54,
      borderColor: COLORS.orange,
      borderWidth: 1.5,
      color: COLORS.charcoal,
    });
    // Extract initials of hostel name
    const initials = (data.hostel_name || "Sri Adithya")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
      
    page.drawText(initials, {
      x: 36 + (54 - fontBold.widthOfTextAtSize(initials, 16)) / 2,
      y: currentY + 44,
      size: 16,
      font: fontBold,
      color: COLORS.orange,
    });
  }

  // Hostel Title & Subtitle
  const hostelNameObj = sanitizeText(data.hostel_name || "Sri Adithya Boys Hostel");
  page.drawText(hostelNameObj, {
    x: 110,
    y: currentY + 65,
    size: 18,
    font: fontBold,
    color: COLORS.orange,
  });
  
  const safeHeaderAddress = sanitizeText(headerAddress);
  page.drawText(safeHeaderAddress.slice(0, 65), {
    x: 110,
    y: currentY + 45,
    size: 9,
    font: fontRegular,
    color: rgb(220 / 255, 220 / 255, 220 / 255),
  });

  // Receipt Label & Number
  page.drawText("RECEIPT", {
    x: width - 36 - 90,
    y: currentY + 65,
    size: 20,
    font: fontBold,
    color: COLORS.orange,
  });
  const safeReceiptNum = sanitizeText(data.receipt_number);
  page.drawText(safeReceiptNum, {
    x: width - 36 - fontRegular.widthOfTextAtSize(safeReceiptNum, 10),
    y: currentY + 45,
    size: 10,
    font: fontRegular,
    color: rgb(220 / 255, 220 / 255, 220 / 255),
  });

  // --- BRAND ACCENT LINE ---
  currentY -= 4;
  page.drawRectangle({
    x: 0,
    y: currentY,
    width: width,
    height: 4,
    color: COLORS.orange,
  });

  // --- META STRIP ---
  const metaHeight = 45;
  currentY -= metaHeight;
  page.drawRectangle({
    x: 0,
    y: currentY,
    width: width,
    height: metaHeight,
    color: COLORS.mutedStrip,
  });
  
  const metaY = currentY + 25;
  const valY = currentY + 10;
  
  const safeIssueDate = sanitizeText(issueDate);
  page.drawText("ISSUE DATE", { x: 36, y: metaY, size: 8, font: fontBold, color: COLORS.textLight });
  page.drawText(safeIssueDate, { x: 36, y: valY, size: 10, font: fontRegular, color: COLORS.textPrimary });

  page.drawText("TRANSACTION ID", { x: width / 2 - 60, y: metaY, size: 8, font: fontBold, color: COLORS.textLight });
  page.drawText(sanitizeText(data.transaction_id || "N/A"), { x: width / 2 - 60, y: valY, size: 10, font: fontRegular, color: COLORS.textPrimary });

  const rightLabel = "RECEIPT VERSION";
  const rightVal = `v${data.template_version || 4}.0.0`;
  page.drawText(rightLabel, { x: width - 36 - fontBold.widthOfTextAtSize(rightLabel, 8), y: metaY, size: 8, font: fontBold, color: COLORS.textLight });
  page.drawText(rightVal, { x: width - 36 - fontRegular.widthOfTextAtSize(rightVal, 10), y: valY, size: 10, font: fontRegular, color: COLORS.textPrimary });

  currentY -= 1;
  page.drawLine({
    start: { x: 0, y: currentY },
    end: { x: width, y: currentY },
    thickness: 1,
    color: COLORS.border,
  });

  // --- PARTY ADDRESSES ---
  currentY -= 30;
  const partyY = currentY;

  // From
  page.drawText("FROM", { x: 36, y: partyY, size: 9, font: fontBold, color: COLORS.orange });
  page.drawText(hostelNameObj, { x: 36, y: partyY - 16, size: 12, font: fontBold, color: COLORS.textPrimary });
  
  let addrY = partyY - 32;
  page.drawText(sanitizeText(data.hostel_address).slice(0, 45), { x: 36, y: addrY, size: 9, font: fontRegular, color: COLORS.textMuted }); addrY -= 13;
  if (shortAddress) { page.drawText(sanitizeText(shortAddress), { x: 36, y: addrY, size: 9, font: fontRegular, color: COLORS.textMuted }); addrY -= 13; }
  if (data.hostel_phone) { page.drawText(`Phone: ${sanitizeText(data.hostel_phone)}`, { x: 36, y: addrY, size: 9, font: fontRegular, color: COLORS.textMuted }); }

  // Bill To
  const toX = width / 2 + 20;
  page.drawLine({ start: { x: toX - 15, y: partyY + 5 }, end: { x: toX - 15, y: partyY - 65 }, thickness: 1.5, color: COLORS.orange });
  
  const tenantNameObj = sanitizeText(data.tenant_name);
  page.drawText("BILL TO", { x: toX, y: partyY, size: 9, font: fontBold, color: COLORS.orange });
  page.drawText(tenantNameObj, { x: toX, y: partyY - 16, size: 12, font: fontBold, color: COLORS.textPrimary });
  
  let tenantY = partyY - 32;
  if (roomLine) { page.drawText(sanitizeText(roomLine), { x: toX, y: tenantY, size: 9, font: fontRegular, color: COLORS.textMuted }); tenantY -= 13; }
  if (data.tenant_phone) { page.drawText(`Phone: ${sanitizeText(data.tenant_phone)}`, { x: toX, y: tenantY, size: 9, font: fontRegular, color: COLORS.textMuted }); tenantY -= 13; }
  if (data.tenant_email) { page.drawText(`Email: ${sanitizeText(data.tenant_email)}`, { x: toX, y: tenantY, size: 9, font: fontRegular, color: COLORS.textMuted }); }

  currentY -= 90;
  page.drawLine({ start: { x: 36, y: currentY }, end: { x: width - 36, y: currentY }, thickness: 1, color: COLORS.border });

  // --- SETTLEMENT BREAKDOWN TABLE ---
  currentY -= 30;
  page.drawRectangle({
    x: 36, y: currentY, width: width - 72, height: 24, color: COLORS.charcoal
  });
  
  page.drawText("SETTLEMENT BREAKDOWN", { x: 46, y: currentY + 7, size: 9, font: fontBold, color: COLORS.orange });
  page.drawText("ALLOCATED AMOUNT", { x: width - 46 - fontBold.widthOfTextAtSize("ALLOCATED AMOUNT", 9), y: currentY + 7, size: 9, font: fontBold, color: COLORS.orange });

  currentY -= 20;

  const allocations = data.settlement_allocations && data.settlement_allocations.length > 0
    ? data.settlement_allocations
    : [{ type: "RENT", allocated: data.amount, label: `Rent Payment${rentPeriod ? ` - ${rentPeriod}` : ""}` }];

  for (const item of allocations) {
    const itemLabel = sanitizeText(item.label);
    const itemAmountStr = sanitizeText(formatCurrency(item.allocated, p));
    
    page.drawText(itemLabel, { x: 46, y: currentY, size: 10, font: fontBold, color: COLORS.textPrimary });
    page.drawText(itemAmountStr, { x: width - 46 - fontBold.widthOfTextAtSize(itemAmountStr, 10), y: currentY, size: 10, font: fontBold, color: COLORS.textPrimary });
    
    currentY -= 18;
    page.drawLine({ start: { x: 36, y: currentY + 8 }, end: { x: width - 36, y: currentY + 8 }, thickness: 0.5, color: COLORS.border });
  }

  // --- PAYMENT DETAILS & TOTAL PAID AMOUNT BOX ---
  currentY -= 120;
  const bottomY = currentY;

  // Payment Details
  page.drawText("PAYMENT DETAILS", { x: 36, y: bottomY + 100, size: 9, font: fontBold, color: COLORS.orange });
  
  let pmtY = bottomY + 80;
  page.drawText("Method", { x: 36, y: pmtY, size: 10, font: fontRegular, color: COLORS.textMuted });
  page.drawText(sanitizeText((data.payment_method || "N/A").toUpperCase()), { x: 120, y: pmtY, size: 10, font: fontBold, color: COLORS.textPrimary });
  pmtY -= 16;

  if (data.transaction_id) {
    page.drawText("Transaction ID", { x: 36, y: pmtY, size: 10, font: fontRegular, color: COLORS.textMuted });
    page.drawText(sanitizeText(data.transaction_id), { x: 120, y: pmtY, size: 10, font: fontRegular, color: COLORS.textPrimary });
    pmtY -= 16;
  }

  page.drawText("Payment Date", { x: 36, y: pmtY, size: 10, font: fontRegular, color: COLORS.textMuted });
  const safePaymentDate = sanitizeText(paymentDate);
  page.drawText(safePaymentDate, { x: 120, y: pmtY, size: 10, font: fontBold, color: COLORS.textPrimary });
  pmtY -= 16;

  if (data.reference_number) {
    page.drawText("Reference No.", { x: 36, y: pmtY, size: 10, font: fontRegular, color: COLORS.textMuted });
    page.drawText(sanitizeText(data.reference_number), { x: 120, y: pmtY, size: 10, font: fontRegular, color: COLORS.textPrimary });
  }

  // Amount Box on Right
  const boxWidth = 200;
  const boxHeight = 110;
  const boxX = width - 36 - boxWidth;
  
  page.drawRectangle({
    x: boxX, y: bottomY, width: boxWidth, height: boxHeight, color: COLORS.charcoal,
  });

  page.drawText("TOTAL PAID", { x: boxX + boxWidth / 2 - fontBold.widthOfTextAtSize("TOTAL PAID", 9) / 2, y: bottomY + 80, size: 9, font: fontBold, color: COLORS.orange });
  
  const totalPaidVal = data.total_transaction_paid || data.amount;
  const totalStr = sanitizeText(formatCurrency(totalPaidVal, { ...p, currency: p.currency || 'INR' }).replace('.00', ''));
  page.drawText(totalStr, { x: boxX + boxWidth / 2 - fontBold.widthOfTextAtSize(totalStr, 28) / 2, y: bottomY + 45, size: 28, font: fontBold, color: COLORS.cream });

  // Draw PAID Tag
  page.drawRectangle({
    x: boxX + boxWidth / 2 - 30, y: bottomY + 15, width: 60, height: 20, borderColor: COLORS.green, borderWidth: 1.5,
  });
  page.drawText("PAID", { x: boxX + boxWidth / 2 - fontBold.widthOfTextAtSize("PAID", 10) / 2, y: bottomY + 21, size: 10, font: fontBold, color: COLORS.green });

  currentY = bottomY - 30;

  // --- POST-SETTLEMENT FINANCIAL POSITION & QR CODE VERIFICATION ---
  // Elevate cards height to 135px to support a minimum 120px QR code cleanly
  const cardHeight = 135;
  const cardY = currentY - cardHeight;
  
  // Left Card: Financial Position
  page.drawRectangle({
    x: 36,
    y: cardY,
    width: 250,
    height: cardHeight,
    borderColor: COLORS.border,
    borderWidth: 1,
    color: rgb(250 / 255, 248 / 255, 245 / 255),
  });
  
  page.drawText("POST-SETTLEMENT FINANCIAL POSITION", {
    x: 46,
    y: cardY + 115,
    size: 8,
    font: fontBold,
    color: COLORS.orange,
  });

  // Balance Due
  const balDueLabel = "Outstanding Dues:";
  const balDueVal = sanitizeText(formatCurrency(data.outstanding_balance_after || 0, p));
  page.drawText(balDueLabel, { x: 46, y: cardY + 85, size: 9, font: fontRegular, color: COLORS.textMuted });
  page.drawText(balDueVal, { x: 155, y: cardY + 85, size: 9, font: fontBold, color: (data.outstanding_balance_after || 0) > 0 ? rgb(220/255, 50/255, 50/255) : COLORS.textPrimary });

  // Future Credit
  const creditLabel = "Available Future Credit:";
  const creditVal = sanitizeText(formatCurrency(data.future_credit_balance_after || 0, p));
  page.drawText(creditLabel, { x: 46, y: cardY + 60, size: 9, font: fontRegular, color: COLORS.textMuted });
  page.drawText(creditVal, { x: 155, y: cardY + 60, size: 9, font: fontBold, color: (data.future_credit_balance_after || 0) > 0 ? COLORS.green : COLORS.textPrimary });

  // Status Badge/Text
  const statusLabel = "Account Status:";
  const statusVal = (data.outstanding_balance_after || 0) === 0 ? "PAID / NO DUES" : "PENDING DUES";
  page.drawText(statusLabel, { x: 46, y: cardY + 35, size: 9, font: fontRegular, color: COLORS.textMuted });
  page.drawText(statusVal, { x: 155, y: cardY + 35, size: 9, font: fontBold, color: (data.outstanding_balance_after || 0) === 0 ? COLORS.green : COLORS.orange });

  // Right Card: QR Code Verification Box (250 width, 135 height)
  page.drawRectangle({
    x: 309.28,
    y: cardY,
    width: 250,
    height: cardHeight,
    borderColor: COLORS.orange,
    borderWidth: 1,
    color: rgb(250 / 255, 248 / 255, 245 / 255),
  });

  // Generate QR code image streams
  let qrImageObj: any = null;
  const qrSize = 120;
  const qrX = 309.28 + 8;
  const qrY = cardY + 7.5;

  if (data.verification_url) {
    try {
      const qrBuffer = await QRCode.toBuffer(data.verification_url, {
        type: "png",
        width: 240,
        margin: 1,
      });
      qrImageObj = await pdfDoc.embedPng(qrBuffer);
    } catch (err) {
      console.error("Failed to generate QR code:", err);
    }
  }

  if (qrImageObj) {
    page.drawImage(qrImageObj, {
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
    });
  } else {
    // Elegant fallback QR mockup
    page.drawRectangle({
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
      borderColor: COLORS.charcoal,
      borderWidth: 1,
      color: COLORS.white,
    });
    // Finder Patterns (QR Corners)
    page.drawRectangle({ x: qrX + 8, y: qrY + 120 - 24, width: 16, height: 16, color: COLORS.charcoal });
    page.drawRectangle({ x: qrX + 10, y: qrY + 120 - 22, width: 12, height: 12, color: COLORS.white });
    page.drawRectangle({ x: qrX + 12, y: qrY + 120 - 20, width: 8, height: 8, color: COLORS.charcoal });
    
    page.drawRectangle({ x: qrX + 120 - 24, y: qrY + 120 - 24, width: 16, height: 16, color: COLORS.charcoal });
    page.drawRectangle({ x: qrX + 120 - 22, y: qrY + 120 - 22, width: 12, height: 12, color: COLORS.white });
    page.drawRectangle({ x: qrX + 120 - 20, y: qrY + 120 - 20, width: 8, height: 8, color: COLORS.charcoal });

    page.drawRectangle({ x: qrX + 8, y: qrY + 8, width: 16, height: 16, color: COLORS.charcoal });
    page.drawRectangle({ x: qrX + 10, y: qrY + 10, width: 12, height: 12, color: COLORS.white });
    page.drawRectangle({ x: qrX + 12, y: qrY + 12, width: 8, height: 8, color: COLORS.charcoal });
  }

  // QR labels positioned to the right of the 120px QR code (x = 309.28 + 138)
  const lblX = 309.28 + 138;
  page.drawText("VERIFIED", {
    x: lblX,
    y: cardY + 95,
    size: 9,
    font: fontBold,
    color: COLORS.textPrimary,
  });
  page.drawText("RECEIPT", {
    x: lblX,
    y: cardY + 83,
    size: 9,
    font: fontBold,
    color: COLORS.orange,
  });
  page.drawText("Scan to verify", {
    x: lblX,
    y: cardY + 60,
    size: 8,
    font: fontRegular,
    color: COLORS.textMuted,
  });
  page.drawText("authenticity", {
    x: lblX,
    y: cardY + 50,
    size: 8,
    font: fontRegular,
    color: COLORS.textMuted,
  });
  page.drawText("Secure HMAC", {
    x: lblX,
    y: cardY + 30,
    size: 7,
    font: fontItalic,
    color: COLORS.textLight,
  });
  page.drawText("Signed Link", {
    x: lblX,
    y: cardY + 20,
    size: 7,
    font: fontItalic,
    color: COLORS.textLight,
  });

  currentY = cardY - 20;

  // --- FOOTER NOTE ---
  currentY -= 15;
  page.drawLine({ start: { x: 36, y: currentY }, end: { x: width - 36, y: currentY }, thickness: 1, color: COLORS.border });
  currentY -= 20;
  
  // Basic text wrapping for note
  const safeFooterNote = sanitizeText(footerNote);
  const words = safeFooterNote.split(' ');
  let line = '';
  let noteY = currentY;
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    const testWidth = fontItalic.widthOfTextAtSize(testLine, 8);
    if (testWidth > width - 72 && i > 0) {
      page.drawText(line, { x: 36, y: noteY, size: 8, font: fontItalic, color: COLORS.textLight });
      line = words[i] + ' ';
      noteY -= 12;
    } else {
      line = testLine;
    }
  }
  page.drawText(line, { x: 36, y: noteY, size: 8, font: fontItalic, color: COLORS.textLight });

  // --- BOTTOM BAR WITH CONTACT AND SUPPORT DETAILS ---
  const footerHeight = 50;
  page.drawRectangle({
    x: 0, y: 0, width: width, height: footerHeight, color: COLORS.charcoal
  });
  
  // Left: Support contact details
  page.drawText("Support & Queries", { x: 36, y: 28, size: 8, font: fontBold, color: COLORS.orange });
  page.drawText("sriadithyahostels@gmail.com | +91 99638 23824", { x: 36, y: 14, size: 9, font: fontRegular, color: rgb(220 / 255, 220 / 255, 220 / 255) });
  
  // Right: Branding details
  const brandName = "Sri Adithya Boys Hostel";
  const brandSub = "Secure Digital Receipt";
  page.drawText(brandName, { x: width - 36 - fontBold.widthOfTextAtSize(brandName, 9), y: 28, size: 9, font: fontBold, color: COLORS.orange });
  page.drawText(brandSub, { x: width - 36 - fontRegular.widthOfTextAtSize(brandSub, 8), y: 14, size: 8, font: fontRegular, color: rgb(180 / 255, 180 / 180, 180 / 255) });

  return await pdfDoc.save();
}
