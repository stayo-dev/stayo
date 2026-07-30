import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "../lib/db";
import { AgreementGenerationService } from "../src/services/tenants/agreement-generation-service";
import fs from "fs";
import path from "path";

async function main() {
  const agreementId = "e1ef22bf-5f70-4003-90d8-91c39cf260bc";
  console.log(`Generating local PDF for agreement ID: ${agreementId}`);
  
  const data = await AgreementGenerationService.getAgreementRenderData(agreementId);
  console.log("Rules metadata:", JSON.stringify(data.hostelRules, null, 2));

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 50;
  const contentWidth = width - margin * 2; // 495.28

  let currentY = height - margin;

  const COLORS = {
    textPrimary: rgb(26 / 255, 25 / 255, 24 / 255),
    textMuted: rgb(107 / 255, 101 / 255, 96 / 255),
    border: rgb(220 / 255, 220 / 255, 220 / 255),
    lineColor: rgb(240 / 255, 240 / 255, 240 / 255),
  };

  // Helper to sanitize
  function sanitizeText(str: string | null | undefined): string {
    if (!str) return "";
    let s = str.replace(/₹/g, "Rs. ");
    s = s.replace(/[^\x00-\xFF]/g, ""); 
    return s.trim();
  }

  function wrapText(text: string, width: number, font: any, fontSize: number): string[] {
    const sanitized = sanitizeText(text);
    const words = sanitized.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (testWidth > width) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  const drawHeader = () => {
    page.drawText(sanitizeText("HOSTEL ACCOMMODATION AGREEMENT"), {
      x: margin,
      y: currentY,
      size: 16,
      font: fontBold,
      color: COLORS.textPrimary,
    });
    currentY -= 8;
    page.drawLine({
      start: { x: margin, y: currentY },
      end: { x: width - margin, y: currentY },
      thickness: 1,
      color: COLORS.border,
    });
    currentY -= 20;
  };

  const checkPageBreak = (neededHeight: number) => {
    if (currentY - neededHeight < margin + 40) {
      page = pdfDoc.addPage([595.28, 841.89]);
      currentY = height - margin;
      drawHeader();
    }
  };

  // Initialize
  drawHeader();

  // 1. Parties Info Box
  checkPageBreak(120);
  const boxWidth = contentWidth / 2 - 10;
  page.drawText(sanitizeText("LESSOR (Hostel Owner)"), {
    x: margin,
    y: currentY,
    size: 10,
    font: fontBold,
    color: COLORS.textPrimary,
  });
  page.drawText(sanitizeText(`Name: ${data.ownerName}`), {
    x: margin,
    y: currentY - 16,
    size: 9,
    font: fontRegular,
    color: COLORS.textMuted,
  });
  page.drawText(sanitizeText(`Hostel: ${data.hostelName}`), {
    x: margin,
    y: currentY - 28,
    size: 9,
    font: fontRegular,
    color: COLORS.textMuted,
  });
  const wrappedAddr = wrapText(data.hostelAddress, boxWidth, fontRegular, 9);
  let addrY = currentY - 40;
  wrappedAddr.slice(0, 3).forEach((line) => {
    page.drawText(sanitizeText(line), {
      x: margin,
      y: addrY,
      size: 9,
      font: fontRegular,
      color: COLORS.textMuted,
    });
    addrY -= 12;
  });

  const rightColX = margin + boxWidth + 20;
  page.drawText(sanitizeText("LESSEE (Tenant)"), {
    x: rightColX,
    y: currentY,
    size: 10,
    font: fontBold,
    color: COLORS.textPrimary,
  });
  page.drawText(sanitizeText(`Name: ${data.tenantName}`), {
    x: rightColX,
    y: currentY - 16,
    size: 9,
    font: fontRegular,
    color: COLORS.textMuted,
  });
  page.drawText(sanitizeText(`Phone: ${data.tenantPhone}`), {
    x: rightColX,
    y: currentY - 28,
    size: 9,
    font: fontRegular,
    color: COLORS.textMuted,
  });
  page.drawText(sanitizeText(`Email: ${data.tenantEmail}`), {
    x: rightColX,
    y: currentY - 40,
    size: 9,
    font: fontRegular,
    color: COLORS.textMuted,
  });
  const wrappedPerm = wrapText(data.permanentAddress || "N/A", boxWidth, fontRegular, 9);
  let permY = currentY - 52;
  wrappedPerm.slice(0, 3).forEach((line) => {
    page.drawText(sanitizeText(line), {
      x: rightColX,
      y: permY,
      size: 9,
      font: fontRegular,
      color: COLORS.textMuted,
    });
    permY -= 12;
  });

  currentY -= 90;

  // 2. Room & Financial Terms Grid
  checkPageBreak(120);
  page.drawLine({
    start: { x: margin, y: currentY },
    end: { x: width - margin, y: currentY },
    thickness: 1,
    color: COLORS.border,
  });
  currentY -= 15;

  page.drawText(sanitizeText("ACCOMMODATION & FINANCIAL TERMS"), {
    x: margin,
    y: currentY,
    size: 11,
    font: fontBold,
    color: COLORS.textPrimary,
  });
  currentY -= 20;

  const gridItems = [
    { label: "Room Allocated", value: data.roomNo || "N/A" },
    { label: "Joining Date", value: new Date(data.joiningDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) },
    { label: "Monthly Rent", value: `Rs. ${data.monthlyRent.toLocaleString("en-IN")}` },
    { label: "Payment Frequency", value: data.paymentFrequency },
    { label: "Security Deposit", value: `Rs. ${data.advanceDeposit.toLocaleString("en-IN")}` },
    { label: "Maintenance Fee", value: data.maintenanceCharge > 0 ? `Rs. ${data.maintenanceCharge.toLocaleString("en-IN")} (${data.maintenanceType})` : "N/A" },
  ];

  let gridY = currentY;
  gridItems.forEach((item, index) => {
    const isEven = index % 2 === 0;
    const xPos = isEven ? margin : rightColX;
    if (!isEven && index > 0) {
      gridY -= 20;
    }
    page.drawText(sanitizeText(item.label), {
      x: xPos,
      y: isEven ? gridY : gridY + 20,
      size: 9,
      font: fontBold,
      color: COLORS.textMuted,
    });
    page.drawText(sanitizeText(item.value), {
      x: xPos + 120,
      y: isEven ? gridY : gridY + 20,
      size: 9,
      font: fontRegular,
      color: COLORS.textPrimary,
    });
  });
  currentY = gridY - 15;

  // 3. Terms & Conditions Section
  checkPageBreak(150);
  page.drawLine({
    start: { x: margin, y: currentY },
    end: { x: width - margin, y: currentY },
    thickness: 1,
    color: COLORS.border,
  });
  currentY -= 15;

  page.drawText(sanitizeText("STANDARD TERMS & CONDITIONS"), {
    x: margin,
    y: currentY,
    size: 11,
    font: fontBold,
    color: COLORS.textPrimary,
  });
  currentY -= 20;

  const standardRules = [
    "The Lessee shall use the allocated room solely for residential purposes. Sub-letting or transferring the room to any other person is strictly prohibited.",
    "Monthly rent is payable in advance as per the agreed rent cycle. Late payments may attract fees or lead to suspension of access.",
    "The security deposit is refundable upon vacating the premises, subject to clearance of all pending dues and room inspection for damages.",
    "Notice Period: Either party must provide at least 30 days written notice prior to terminating this agreement.",
    "Hostel Rules Compliance: The Lessee explicitly agrees to comply fully with, follow, and be bound by each and every rule, policy, and regulation of the hostel (including fee refund rules, discipline policies, late fee obligations, and property damage liabilities). Any breach of these rules constitutes a violation of this residency agreement and may result in immediate termination of stay.",
  ];

  standardRules.forEach((rule, idx) => {
    const ruleWrapped = wrapText(`${idx + 1}. ${rule}`, contentWidth, fontRegular, 9);
    checkPageBreak(ruleWrapped.length * 12 + 10);
    ruleWrapped.forEach((line) => {
      page.drawText(sanitizeText(line), {
        x: margin,
        y: currentY,
        size: 9,
        font: fontRegular,
        color: COLORS.textPrimary,
      });
      currentY -= 12;
    });
    currentY -= 4;
  });

  // 4. Hostel Rules & Regulations Section
  if (data.hostelRules && data.hostelRules.categories) {
    checkPageBreak(60);
    currentY -= 10;
    page.drawText(sanitizeText("HOSTEL RULES & REGULATIONS"), {
      x: margin,
      y: currentY,
      size: 11,
      font: fontBold,
      color: COLORS.textPrimary,
    });
    currentY -= 20;

    data.hostelRules.categories.forEach((cat: any) => {
      // Category Title
      const catTitleWrapped = wrapText(cat.title || "", contentWidth, fontBold, 10);
      checkPageBreak(catTitleWrapped.length * 14 + 10);
      catTitleWrapped.forEach((line) => {
        page.drawText(sanitizeText(line), {
          x: margin,
          y: currentY,
          size: 10,
          font: fontBold,
          color: COLORS.textPrimary,
        });
        currentY -= 14;
      });
      currentY -= 4;

      // Highlights
      if (Array.isArray(cat.highlights) && cat.highlights.length > 0) {
        cat.highlights.forEach((hl: string) => {
          const hlWrapped = wrapText(`• ${hl}`, contentWidth - 15, fontItalic, 9);
          checkPageBreak(hlWrapped.length * 12 + 6);
          hlWrapped.forEach((line, lineIdx) => {
            page.drawText(sanitizeText(lineIdx === 0 ? line : "  " + line), {
              x: margin + 10,
              y: currentY,
              size: 9,
              font: fontItalic,
              color: COLORS.textMuted,
            });
            currentY -= 12;
          });
          currentY -= 2;
        });
      }

      // Rules
      if (Array.isArray(cat.rules) && cat.rules.length > 0) {
        cat.rules.forEach((rule: string) => {
          const ruleWrapped = wrapText(`- ${rule}`, contentWidth - 15, fontRegular, 9);
          checkPageBreak(ruleWrapped.length * 12 + 6);
          ruleWrapped.forEach((line, lineIdx) => {
            page.drawText(sanitizeText(lineIdx === 0 ? line : "  " + line), {
              x: margin + 10,
              y: currentY,
              size: 9,
              font: fontRegular,
              color: COLORS.textPrimary,
            });
            currentY -= 12;
          });
          currentY -= 2;
        });
      }

      currentY -= 10;
    });
  }

  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(__dirname, "test-agreement.pdf");
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`Saved PDF to ${outputPath}`);
}

main().catch(console.error);
