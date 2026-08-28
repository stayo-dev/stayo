import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fsp from "fs/promises";
import nodePath from "path";
import QRCode from "qrcode";
import {
  rupees,
  executionStatement,
  numberClauses,
  pageFooter,
  placeFromAddress,
  platformAttestation,
  preamble,
  standardLegalClauses,
} from "@/lib/pdf/agreement-content";
import { prisma } from "../../../lib/db";
import { imagekit } from "../../../lib/imagekit";
import axios from "axios";

const IST_TIMEZONE = "Asia/Kolkata";

export function formatAgreementDate(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return "N/A";
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return "N/A";

  const formatted = date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: IST_TIMEZONE,
  });
  return formatted.replace(/\//g, "-");
}

export function formatAgreementDateTime(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return "N/A";
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return "N/A";

  const formatted = date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: IST_TIMEZONE,
  });
  return `${formatted.replace(/\//g, "-")} IST`;
}

export function sanitizeIp(ip: string | null | undefined): string {
  if (!ip || ip === "unknown") return "N/A";
  if (ip.includes(",")) {
    return ip.split(",")[0].trim();
  }
  return ip.trim();
}

export function parseUserAgent(ua: string | null | undefined): { device: string; os: string; browser: string } {
  if (!ua || ua === "unknown" || ua === "N/A") {
    return { device: "Unknown Device", os: "Unknown OS", browser: "Unknown Browser" };
  }

  let device = "Desktop";
  let os = "Unknown OS";
  let browser = "Unknown Browser";

  const uaLower = ua.toLowerCase();

  // Detect Device Type
  if (/mobi|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(uaLower)) {
    if (/ipad|tablet/i.test(uaLower)) {
      device = "Tablet";
    } else {
      device = "Mobile";
    }
  }

  // Detect OS
  if (/android/i.test(uaLower)) {
    os = "Android";
    const match = ua.match(/Android\s+([0-9\.]+)/i);
    if (match) os += ` ${match[1]}`;
  } else if (/iphone|ipad|ipod/i.test(uaLower)) {
    os = "iOS";
    const match = ua.match(/OS\s+([0-9_]+)/i);
    if (match) os += ` ${match[1].replace(/_/g, ".")}`;
  } else if (/windows/i.test(uaLower)) {
    os = "Windows";
    if (/phone/i.test(uaLower)) os = "Windows Phone";
  } else if (/macintosh|mac os x/i.test(uaLower)) {
    os = "macOS";
  } else if (/linux/i.test(uaLower)) {
    os = "Linux";
  }

  // Detect Browser
  if (/edg/i.test(uaLower)) {
    browser = "Edge";
  } else if (/chrome|crios/i.test(uaLower)) {
    browser = "Chrome";
  } else if (/safari/i.test(uaLower)) {
    browser = "Safari";
  } else if (/firefox|fxios/i.test(uaLower)) {
    browser = "Firefox";
  } else if (/opr/i.test(uaLower)) {
    browser = "Opera";
  }

  return { device, os, browser };
}


import { DEFAULT_RULES_TEMPLATE, DEFAULT_TERMS_AND_CONDITIONS, interpolateRulesContent, interpolateText } from "../../utils/default-rules";

export const DEFAULT_RULE_CONTENT = DEFAULT_RULES_TEMPLATE;



export interface AgreementData {
  hostelName: string;
  hostelAddress: string;
  ownerName: string;
  ownerSignatureUrl?: string | null;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  permanentAddress?: string | null;
  roomNo?: string | null;
  monthlyRent: number;
  advanceDeposit: number;
  maintenanceCharge: number;
  maintenanceType: string;
  joiningDate: Date | string;
  paymentFrequency: string;
  customRules?: string | null;
  hostelRules?: any;

  tenantSignatureUrl?: string | null;
  tenantSignatureName?: string | null;
  tenantSignedAt?: Date | string | null;
  tenantIp?: string | null;
  tenantUserAgent?: string | null;

  guardianSignatureUrl?: string | null;
  guardianSignatureName?: string | null;
  guardianRelation?: string | null;
  guardianSignedAt?: Date | string | null;
  guardianIp?: string | null;
  guardianUserAgent?: string | null;

  ownerSignedAt?: Date | string | null;

  // Overhaul simplification fields
  agreementStartDate?: Date | string | null;
  agreementEndDate?: Date | string | null;
  agreementDurationMonths?: number | null;
  termsAndConditions?: { id: string; title: string; content: string; }[] | null;
}

/**
 * Was a WinAnsi guard; now only trims.
 *
 * The document embeds Inter, which is a Unicode font, so neither of this
 * function's original jobs applies any more — and both were actively wrong on
 * a financial instrument. It rewrote `₹` to `Rs. `, and then stripped every
 * character above U+00FF, which silently deleted the rupee sign outright when
 * the substitution was removed. Amounts rendered as a bare "8,500".
 */
function sanitizeText(str: string | null | undefined): string {
  if (!str) return "";
  return String(str).trim();
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

function wrapTextWithNewlines(text: string, width: number, font: any, fontSize: number): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  for (const para of paragraphs) {
    const wrapped = wrapText(para, width, font, fontSize);
    if (wrapped.length === 0) {
      lines.push("");
    } else {
      lines.push(...wrapped);
    }
  }
  return lines;
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer" });
    return Buffer.from(res.data);
  } catch (error) {
    console.error("Failed to fetch image for agreement PDF:", url, error);
    return null;
  }
}

export class AgreementGenerationService {
  /**
   * Helper to fetch tenant, hostel, room details and format for PDF generation.
   */
  static async getAgreementRenderData(agreementId: string): Promise<AgreementData> {
    const agreement = await prisma.agreement.findUnique({
      where: { id: agreementId },
      include: {
        tenant: {
          include: {
            profiles: true,
            room_allocations: {
              where: { is_active: true },
              include: { room: true },
            },
          },
        },
        hostel: true,
        template: true,
      },
    });

    if (!agreement) {
      throw new Error(`Agreement not found: ${agreementId}`);
    }

    const snapshot = (agreement.content_snapshot as any) || {};
    const tenant = agreement.tenant;
    const hostel = agreement.hostel;
    const template = agreement.template;

    const joiningDate = snapshot.joining_date || tenant.joined_on || new Date();
    const formattedJoiningDate = formatAgreementDate(joiningDate);

    const monthlyRent = Number(snapshot.monthly_rent || tenant.monthly_rent || 0);
    const advanceDeposit = Number(snapshot.advance_deposit || tenant.security_deposit || 0);
    const maintenanceCharge = Number(snapshot.maintenance_charge || tenant.maintenance_charge || 0);
    const ownerName = snapshot.owner_name || template?.owner_name || "Hostel Owner";
    const tenantName = snapshot.tenant_name || tenant.profiles?.name || tenant.personal_email || "N/A";
    const roomNo = snapshot.room_number || "N/A";
    const hostelName = snapshot.hostel_name || hostel.name;

    const variables = {
      TENANT_NAME: tenantName,
      ROOM_NUMBER: roomNo,
      MONTHLY_RENT: monthlyRent,
      SECURITY_DEPOSIT_AMOUNT: advanceDeposit,
      MAINTENANCE_CHARGE_AMOUNT: maintenanceCharge,
      HOSTEL_NAME: hostelName,
      OWNER_NAME: ownerName,
      JOINING_DATE: formattedJoiningDate,
    };

    const rawHostelRules = (agreement.rules_snapshot as any) ||
      snapshot.interpolated_rules ||
      snapshot.hostel_rules ||
      template?.rules_content ||
      DEFAULT_RULE_CONTENT;

    const hostelRules = interpolateRulesContent(rawHostelRules, variables, true);

    // Support for configurable agreement duration and dynamic date calculation
    const agreementStartDate = agreement.agreement_start_date || snapshot.agreement_start_date || tenant.joined_on || null;
    const agreementEndDate = agreement.agreement_end_date || snapshot.agreement_end_date || null;
    const agreementDurationMonths = agreement.agreement_duration_months || snapshot.agreement_duration_months || null;

    // Resolve Terms & Conditions
    let rawTermsAndConditions = snapshot.terms_and_conditions || 
      template?.rules_content?.terms_and_conditions || 
      null;

    if (!rawTermsAndConditions && template?.rules_content && typeof template.rules_content === "object") {
      const parsedRules = template.rules_content as any;
      if (Array.isArray(parsedRules.terms_and_conditions)) {
        rawTermsAndConditions = parsedRules.terms_and_conditions;
      }
    }

    if (!rawTermsAndConditions || !Array.isArray(rawTermsAndConditions) || rawTermsAndConditions.length === 0) {
      rawTermsAndConditions = DEFAULT_TERMS_AND_CONDITIONS;
    }

    // Interpolate placeholders inside terms & conditions content
    const termsAndConditions = rawTermsAndConditions.map((term: any) => ({
      ...term,
      content: interpolateText(term.content || "", variables, true),
    }));

    return {
      hostelName: hostelName,
      hostelAddress: [hostel.address, hostel.city, hostel.state, hostel.pincode].filter(Boolean).join(", "),
      ownerName: ownerName,
      ownerSignatureUrl: template?.owner_signature_url || null,
      tenantName: tenantName,
      // Snapshot-first, like every other contractual value above.
      //
      // These three used to read the tenant row live. That was survivable while
      // identity was per-tenancy and effectively frozen after activation; phase
      // B made identity person-level and editable from a profile screen, so a
      // live read meant regenerating an old agreement's PDF could print an
      // address or email the signatory never agreed to. The `tenant.*` fallback
      // stays for agreements signed before the snapshot carried these fields.
      tenantEmail: snapshot.tenant_email || tenant.personal_email || "",
      tenantPhone: snapshot.tenant_phone || tenant.phone_1 || "",
      permanentAddress: snapshot.permanent_address || tenant.permanent_address || "N/A",
      roomNo: roomNo,
      monthlyRent,
      advanceDeposit,
      maintenanceCharge,
      maintenanceType: snapshot.maintenance_type || tenant.maintenance_type || "MONTHLY",
      joiningDate: formattedJoiningDate,
      paymentFrequency: snapshot.payment_frequency || tenant.payment_frequency || "MONTHLY",
      customRules: snapshot.custom_rules || template?.custom_rules || null,
      hostelRules,

      tenantSignatureUrl: agreement.tenant_signature_url,
      tenantSignatureName: agreement.tenant_signature_name,
      tenantSignedAt: agreement.tenant_signed_at,
      tenantIp: agreement.tenant_ip,
      tenantUserAgent: agreement.tenant_user_agent,

      guardianSignatureUrl: agreement.guardian_signature_url,
      guardianSignatureName: agreement.guardian_signature_name,
      guardianRelation: agreement.guardian_relation,
      guardianSignedAt: agreement.guardian_signed_at,
      guardianIp: agreement.guardian_ip,
      guardianUserAgent: agreement.guardian_user_agent,

      ownerSignedAt: agreement.owner_signed_at,

      agreementStartDate,
      agreementEndDate,
      agreementDurationMonths,
      termsAndConditions,
    };
  }

  /**
   * Generates the A4 Agreement PDF and uploads it to ImageKit, returning the URL.
   */
  static async generateAndUploadPdf(agreementId: string): Promise<string> {
    const data = await this.getAgreementRenderData(agreementId);
    const pdfBuffer = await this.generatePdfBuffer(data);

    // Upload PDF to ImageKit
    const uploadRes = await imagekit.files.upload({
      file: pdfBuffer.toString("base64"),
      fileName: `agreement_${agreementId}.pdf`,
      folder: `/agreements`,
      useUniqueFileName: true,
      tags: ["AGREEMENT", agreementId],
    });

    if (!uploadRes?.url) {
      throw new Error("Failed to upload agreement PDF to storage provider");
    }

    // Update agreement with PDF URL
    await prisma.agreement.update({
      where: { id: agreementId },
      data: { pdf_url: uploadRes.url },
    });

    return uploadRes.url;
  }

  /**
   * Generates the PDF buffer directly from the provided AgreementData snapshots.
   */
  static async generatePdfBuffer(data: AgreementData): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const FONT_DIR = nodePath.join(process.cwd(), "lib", "pdf", "fonts");
    // `subset: false` deliberately — pdf-lib's subsetter drops most Latin
    // glyphs from these Inter builds. See lib/pdf/receipt-template-pdf-lib.ts.
    const [interRegular, interMedium] = await Promise.all([
      fsp.readFile(nodePath.join(FONT_DIR, "inter-400.ttf")),
      fsp.readFile(nodePath.join(FONT_DIR, "inter-500.ttf")),
    ]);
    const fontRegular = await pdfDoc.embedFont(interRegular, { subset: false });
    const fontBold = await pdfDoc.embedFont(interMedium, { subset: false });
    const fontItalic = fontRegular;

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

    // The legal furniture this document was missing. See lib/pdf/agreement-content.
    const placeOfExecution = placeFromAddress(data.hostelAddress);
    const executionDateDisplay = data.ownerSignedAt
      ? formatAgreementDate(data.ownerSignedAt)
      : formatAgreementDate(data.agreementStartDate || data.joiningDate);
    const agreementReference = (data as any).agreementReference || "";
    const verificationUrl = (data as any).verificationUrl || null;

    const legalContext = {
      hostelName: data.hostelName,
      hostelAddress: data.hostelAddress,
      ownerName: data.ownerName,
      tenantName: data.tenantName,
      agreementReference,
      executionDateDisplay,
      placeOfExecution,
      terms: [],
      verificationUrl,
    };

    // Initialize first page header
    drawHeader();

    // ── Preamble ──
    // A contract opens by naming its parties and its date. This one opened
    // with two boxes of contact details and no operative sentence at all.
    currentY -= 6;
    const preambleLines = wrapText(preamble(legalContext), contentWidth, fontRegular, 9);
    checkPageBreak(preambleLines.length * 12 + 12);
    preambleLines.forEach((line) => {
      page.drawText(sanitizeText(line), {
        x: margin,
        y: currentY,
        size: 9,
        font: fontRegular,
        color: COLORS.textPrimary,
      });
      currentY -= 12;
    });
    currentY -= 10;

    // 1. Parties Info Box
    checkPageBreak(120);
    // Draw Lessor Box (Left side)
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

    // Draw Lessee Box (Right side)
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
      { label: "Room Allocated", value: data.roomNo || "Not yet allocated" },
      { label: "Agreement Duration", value: data.agreementDurationMonths ? `${data.agreementDurationMonths} Months` : "12 Months" },
      { label: "Monthly Rent", value: rupees(data.monthlyRent) },
      { label: "Agreement Start", value: formatAgreementDate(data.agreementStartDate || data.joiningDate) },
      { label: "Security Deposit", value: rupees(data.advanceDeposit) },
      { label: "Agreement End", value: formatAgreementDate(data.agreementEndDate) },
      // "N/A" against a maintenance fee reads as unknown; "None" is the fact.
      { label: "Maintenance Fee", value: data.maintenanceCharge > 0 ? `${rupees(data.maintenanceCharge)} (${data.maintenanceType})` : "None" },
      { label: "Payment Frequency", value: data.paymentFrequency },
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

    // The hostel's own terms lead; the structural clauses every contract needs
    // follow. `numberClauses` also strips a title the stored content repeats —
    // the source of "4. Notice Period: Notice Period: Either party…".
    const termsList = numberClauses([
      ...(data.termsAndConditions || DEFAULT_TERMS_AND_CONDITIONS),
      ...standardLegalClauses(legalContext),
    ]);

    termsList.forEach((term) => {
      const termWrapped = wrapText(`${term.number}. ${term.title}: ${term.body}`, contentWidth, fontRegular, 9);
      checkPageBreak(termWrapped.length * 12 + 10);
      termWrapped.forEach((line) => {
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
      checkPageBreak(80);
      currentY -= 10;
      page.drawText(sanitizeText("HOSTEL RULES & REGULATIONS"), {
        x: margin,
        y: currentY,
        size: 11,
        font: fontBold,
        color: COLORS.textPrimary,
      });
      currentY -= 16;

      const descText = "This agreement incorporates by reference the following rules accepted by the tenant during account activation.";
      const descWrapped = wrapText(descText, contentWidth, fontItalic, 9);
      checkPageBreak(descWrapped.length * 12 + 10);
      descWrapped.forEach((line) => {
        page.drawText(sanitizeText(line), {
          x: margin,
          y: currentY,
          size: 9,
          font: fontItalic,
          color: COLORS.textMuted,
        });
        currentY -= 12;
      });
      currentY -= 10;

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

    // 4.5 Custom Hostel Rules Section
    if (data.customRules && data.customRules.trim()) {
      checkPageBreak(60);
      currentY -= 10;
      page.drawText(sanitizeText("ADDITIONAL / CUSTOM HOSTEL RULES"), {
        x: margin,
        y: currentY,
        size: 11,
        font: fontBold,
        color: COLORS.textPrimary,
      });
      currentY -= 20;

      const customWrapped = wrapTextWithNewlines(data.customRules, contentWidth, fontRegular, 9);
      customWrapped.forEach((line) => {
        if (line === "") {
          currentY -= 8;
        } else {
          checkPageBreak(12);
          page.drawText(sanitizeText(line), {
            x: margin,
            y: currentY,
            size: 9,
            font: fontRegular,
            color: COLORS.textPrimary,
          });
          currentY -= 12;
        }
      });
    }

    // 5. Signatures and Audit Logs (Force to the bottom or next page)
    const hasTenantSigner = Boolean(data.tenantSignatureName || data.tenantSignatureUrl);
    const hasGuardianSigner = Boolean(data.guardianSignatureName || data.guardianSignatureUrl);
    const colCount = hasGuardianSigner ? 3 : 2;
    const colWidth = contentWidth / colCount;

    // Check if we need a new page for signatures
    checkPageBreak(180);
    currentY -= 15;
    page.drawLine({
      start: { x: margin, y: currentY },
      end: { x: width - margin, y: currentY },
      thickness: 1,
      color: COLORS.border,
    });
    currentY -= 20;

    // The operative execution statement. Signature images with no statement of
    // when and where the parties signed are not an execution block.
    const witnessLines = wrapText(executionStatement(legalContext), contentWidth, fontRegular, 9);
    witnessLines.forEach((line) => {
      page.drawText(sanitizeText(line), {
        x: margin,
        y: currentY,
        size: 9,
        font: fontRegular,
        color: COLORS.textPrimary,
      });
      currentY -= 12;
    });
    currentY -= 14;

    page.drawText(sanitizeText("DIGITAL SIGNATURES & AUDIT LOGS"), {
      x: margin,
      y: currentY,
      size: 11,
      font: fontBold,
      color: COLORS.textPrimary,
    });
    currentY -= 15;

    // Draw Column Headers
    const sigYStart = currentY;

    // Draw Tenant Col (Left)
    page.drawText(sanitizeText("Lessee (Tenant)"), {
      x: margin,
      y: sigYStart,
      size: 9,
      font: fontBold,
      color: COLORS.textPrimary,
    });

    // Draw Guardian Col (Center, if student)
    if (hasGuardianSigner) {
      page.drawText(sanitizeText(`Parent/Guardian (${data.guardianRelation || "Parent"})`), {
        x: margin + colWidth,
        y: sigYStart,
        size: 9,
        font: fontBold,
        color: COLORS.textPrimary,
      });
    }

    // Draw Owner Col (Right)
    const ownerColX = margin + colWidth * (colCount - 1);
    page.drawText(sanitizeText("Lessor (Owner)"), {
      x: ownerColX,
      y: sigYStart,
      size: 9,
      font: fontBold,
      color: COLORS.textPrimary,
    });

    const drawSignatureImage = async (url: string, xPos: number, yPos: number) => {
      const buf = await fetchImageBuffer(url);
      if (buf) {
        try {
          const img = await pdfDoc.embedPng(buf);
          page.drawImage(img, {
            x: xPos,
            y: yPos,
            width: 80,
            height: 35,
          });
        } catch (e) {
          // If it fails to embed as PNG, try JPEG
          try {
            const img = await pdfDoc.embedJpg(buf);
            page.drawImage(img, {
              x: xPos,
              y: yPos,
              width: 80,
              height: 35,
            });
          } catch (err) {
            console.error("Failed to embed image as PNG/JPEG:", err);
            page.drawText(sanitizeText("[Signature Image]"), {
              x: xPos,
              y: yPos + 10,
              size: 8,
              font: fontItalic,
              color: COLORS.textMuted,
            });
          }
        }
      } else {
        page.drawText(sanitizeText("[Signature Image]"), {
          x: xPos,
          y: yPos + 10,
          size: 8,
          font: fontItalic,
          color: COLORS.textMuted,
        });
      }
    };

    // Embed Tenant Signature
    if (data.tenantSignatureUrl) {
      await drawSignatureImage(data.tenantSignatureUrl, margin, sigYStart - 42);
    } else if (hasTenantSigner) {
      page.drawText(sanitizeText("Signed Digitally"), {
        x: margin,
        y: sigYStart - 25,
        size: 9,
        font: fontItalic,
        color: COLORS.textMuted,
      });
    } else {
      page.drawText(sanitizeText("Not signed"), {
        x: margin,
        y: sigYStart - 25,
        size: 9,
        font: fontItalic,
        color: COLORS.textMuted,
      });
    }

    // Embed Guardian Signature
    if (hasGuardianSigner && data.guardianSignatureUrl) {
      await drawSignatureImage(data.guardianSignatureUrl, margin + colWidth, sigYStart - 42);
    } else if (hasGuardianSigner) {
      page.drawText(sanitizeText("Signed Digitally"), {
        x: margin + colWidth,
        y: sigYStart - 25,
        size: 9,
        font: fontItalic,
        color: COLORS.textMuted,
      });
    }

    // Embed Owner Signature
    if (data.ownerSignatureUrl) {
      await drawSignatureImage(data.ownerSignatureUrl, ownerColX, sigYStart - 42);
    } else {
      page.drawText(sanitizeText("Authorized Signatory"), {
        x: ownerColX,
        y: sigYStart - 25,
        size: 9,
        font: fontItalic,
        color: COLORS.textMuted,
      });
    }

    // Draw Names & Metadata
    const metaY = sigYStart - 55;

    // Tenant details
    const tenantIpClean = sanitizeIp(data.tenantIp);
    const tenantUAInfo = parseUserAgent(data.tenantUserAgent);
    page.drawText(sanitizeText(`Name: ${hasTenantSigner ? (data.tenantSignatureName || data.tenantName) : "N/A"}`), {
      x: margin,
      y: metaY,
      size: 8,
      font: fontRegular,
      color: COLORS.textPrimary,
    });
    page.drawText(sanitizeText(`Date: ${formatAgreementDateTime(data.tenantSignedAt)}`), {
      x: margin,
      y: metaY - 10,
      size: 7,
      font: fontRegular,
      color: COLORS.textMuted,
    });
    page.drawText(sanitizeText(`IP: ${tenantIpClean}`), {
      x: margin,
      y: metaY - 18,
      size: 7,
      font: fontRegular,
      color: COLORS.textMuted,
    });
    page.drawText(sanitizeText(`Device: ${tenantUAInfo.device} (${tenantUAInfo.os}, ${tenantUAInfo.browser})`), {
      x: margin,
      y: metaY - 26,
      size: 7,
      font: fontRegular,
      color: COLORS.textMuted,
    });
    const wrappedUA = wrapText(data.tenantUserAgent || "N/A", colWidth - 10, fontRegular, 5);
    page.drawText(sanitizeText(`UA: ${wrappedUA[0] || "N/A"}`), {
      x: margin,
      y: metaY - 34,
      size: 5,
      font: fontRegular,
      color: COLORS.textMuted,
    });

    // Guardian details
    if (hasGuardianSigner) {
      const gX = margin + colWidth;
      const guardianIpClean = sanitizeIp(data.guardianIp);
      const guardianUAInfo = parseUserAgent(data.guardianUserAgent);
      page.drawText(sanitizeText(`Name: ${data.guardianSignatureName || "N/A"}`), {
        x: gX,
        y: metaY,
        size: 8,
        font: fontRegular,
        color: COLORS.textPrimary,
      });
      page.drawText(sanitizeText(`Date: ${formatAgreementDateTime(data.guardianSignedAt)}`), {
        x: gX,
        y: metaY - 10,
        size: 7,
        font: fontRegular,
        color: COLORS.textMuted,
      });
      page.drawText(sanitizeText(`IP: ${guardianIpClean}`), {
        x: gX,
        y: metaY - 18,
        size: 7,
        font: fontRegular,
        color: COLORS.textMuted,
      });
      page.drawText(sanitizeText(`Device: ${guardianUAInfo.device} (${guardianUAInfo.os}, ${guardianUAInfo.browser})`), {
        x: gX,
        y: metaY - 26,
        size: 7,
        font: fontRegular,
        color: COLORS.textMuted,
      });
      const wrappedGUA = wrapText(data.guardianUserAgent || "N/A", colWidth - 10, fontRegular, 5);
      page.drawText(sanitizeText(`UA: ${wrappedGUA[0] || "N/A"}`), {
        x: gX,
        y: metaY - 34,
        size: 5,
        font: fontRegular,
        color: COLORS.textMuted,
      });
    }

    // Owner details
    page.drawText(sanitizeText(`Name: ${data.ownerName}`), {
      x: ownerColX,
      y: metaY,
      size: 8,
      font: fontRegular,
      color: COLORS.textPrimary,
    });
    page.drawText(sanitizeText(`Date: ${formatAgreementDateTime(data.ownerSignedAt)}`), {
      x: ownerColX,
      y: metaY - 10,
      size: 7,
      font: fontRegular,
      color: COLORS.textMuted,
    });

    // ── Per-page furniture ────────────────────────────────────────────────
    // Applied last, when the total page count is finally known.
    //
    // Page numbering is the most important thing added to this document: a
    // multi-page contract that does not say "Page 2 of 5" can have a page
    // removed or substituted without either party being able to demonstrate
    // it. The agreement reference on every sheet ties the paper to the record.
    const pages = pdfDoc.getPages();
    const total = pages.length;
    const attestation = platformAttestation(verificationUrl);

    pages.forEach((p, index) => {
      const { width: pw } = p.getSize();
      const footerText = pageFooter(agreementReference, index + 1, total);

      p.drawLine({
        start: { x: margin, y: margin + 26 },
        end: { x: pw - margin, y: margin + 26 },
        thickness: 0.5,
        color: COLORS.border,
      });

      p.drawText(sanitizeText(footerText), {
        x: margin,
        y: margin + 14,
        size: 7,
        font: fontRegular,
        color: COLORS.textMuted,
      });

      // Space for the parties to initial each page — standard practice for a
      // multi-page instrument, and meaningless without page numbers above.
      const initials = "Initials: ______ / ______";
      p.drawText(sanitizeText(initials), {
        x: pw - margin - fontRegular.widthOfTextAtSize(initials, 7),
        y: margin + 14,
        size: 7,
        font: fontRegular,
        color: COLORS.textMuted,
      });

      // Platform attestation on the final page only — it is a statement about
      // the record, not a term of the contract, and Stayo is not a party.
      if (index === total - 1) {
        p.drawText(sanitizeText(attestation), {
          x: margin,
          y: margin + 4,
          size: 6.5,
          font: fontRegular,
          color: COLORS.textMuted,
        });
      }
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
}
