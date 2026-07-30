import crypto from "crypto";
import { AgreementTemplateType } from "@prisma/client";

/**
 * Default Terms & Conditions — previously hardcoded in agreement-generation-service.ts.
 * Each term is a structured object that owners can edit, reorder, and reset individually.
 */
export const DEFAULT_TERMS_AND_CONDITIONS = [
  {
    id: "residential_use",
    title: "Residential Use Only",
    content: "The Lessee shall use the allocated room solely for residential purposes. Sub-letting or transferring the room to any other person is strictly prohibited.",
  },
  {
    id: "rent_payment",
    title: "Rent Payment",
    content: "Monthly rent is payable in advance as per the agreed rent cycle. Late payments may attract fees or lead to suspension of access.",
  },
  {
    id: "security_deposit",
    title: "Security Deposit",
    content: "The security deposit is refundable upon vacating the premises, subject to clearance of all pending dues and room inspection for damages.",
  },
  {
    id: "notice_period",
    title: "Notice Period",
    content: "Notice Period: Either party must provide at least 30 days written notice prior to terminating this agreement.",
  },
  {
    id: "hostel_rules_compliance",
    title: "Hostel Rules Compliance",
    content: "Hostel Rules Compliance: The Lessee explicitly agrees to comply fully with, follow, and be bound by each and every rule, policy, and regulation of the hostel as set forth in the hostel rules snapshot incorporated herein. The Lessee acknowledges that the specific rule version accepted during account activation is legally binding and forms an integral part of this residency agreement.",
  },
];

export const DEFAULT_RULES_TEMPLATE = {
  categories: [
    {
      id: "payments",
      title: "1. Fee Structure & Payment Policy",
      severity: "important",
      icon: "receipt",
      highlights: [
        "Hostel fee is applicable only for the academic year period of 12 months.",
        "Hostel fees once paid are strictly non-refundable and non-adjustable under any circumstances.",
        "If GST becomes applicable as per government regulations, additional GST charges will be added to the hostel fee."
      ],
      rules: [
        "Students are required to pay monthly rent of ₹{{MONTHLY_RENT}} and a security deposit of ₹{{SECURITY_DEPOSIT_AMOUNT}}.",
        "Any delay in fee payment will attract a late fee of ₹50 per day."
      ],
    },
    {
      id: "facilities",
      title: "2. Accommodation & Hostel Facilities",
      severity: "standard",
      icon: "wifi",
      highlights: [
        "The hostel management is responsible only for providing Accommodation, Breakfast, Lunch, and Dinner.",
        "Facilities such as Internet/Wi-Fi, Washing machines, and Hot water are provided free of cost and may face occasional interruptions or maintenance delays.",
        "Hostel premises will remain closed during major college holidays and festival vacations (Semester Holidays, Dussehra, Sankranthi, etc.). Students must vacate during these periods."
      ],
      rules: [
        "Complaints regarding internet or washing machine issues may take up to 10 days for resolution.",
        "Hostel rooms may be reshuffled under unavoidable or operational circumstances. Allocation of the same room throughout the year is not guaranteed.",
        "Visitors who wish to stay in the hostel must pay ₹500 per day, subject to management approval."
      ],
    },
    {
      id: "discipline",
      title: "3. Discipline & Conduct",
      severity: "critical",
      icon: "shield",
      highlights: [
        "Smoking, alcohol consumption, illegal activities, violence, or misconduct inside the hostel premises are strictly prohibited.",
        "Ragging in any form is strictly prohibited. Involved students will be immediately removed without any fee refund."
      ],
      rules: [
        "Students must maintain proper discipline and respectful behavior inside the hostel premises at all times.",
        "Outsiders, friends, parents, or visitors are not allowed inside hostel rooms. Visitors may wait only in the office area or front lobby.",
        "Hostel gate closes strictly at 9:30 PM every day.",
        "Students leaving the hostel premises must inform the management through WhatsApp message as proof and record.",
        "Food is not allowed inside hostel rooms. Students must use the dining hall for meals."
      ],
    },
    {
      id: "safety",
      title: "4. Safety & Responsibility",
      severity: "important",
      icon: "lock",
      highlights: [
        "Students are fully responsible for their personal belongings (Mobile phones, Laptops, Gold, Cash, Certificates, etc.).",
        "Use of electrical appliances such as iron boxes, water heaters, micro-ovens, or inflammable items is strictly prohibited inside rooms."
      ],
      rules: [
        "The hostel management is not responsible for theft, loss, damage, injuries, accidents, personal disputes, or matters occurring outside hostel responsibility.",
        "Students found using prohibited appliances will be charged a fine of ₹1000.",
        "Any damage caused to hostel property (beds, mattresses, lockers, furniture, fittings, etc.) must be repaired or compensated by the student(s) responsible."
      ],
    },
    {
      id: "vacating",
      title: "5. Vacating & Maintenance Charges",
      severity: "important",
      icon: "door-open",
      highlights: [
        "No refund will be provided for early vacating under any circumstances."
      ],
      rules: [
        "If a student vacates the hostel during the academic year, hostel charges will be recalculated at ₹12,000 per month for the occupied duration.",
        "Students vacating the hostel during the academic year must additionally pay ₹{{MAINTENANCE_CHARGE_AMOUNT}} as maintenance charges."
      ],
    },
    {
      id: "rights",
      title: "6. Management Rights",
      severity: "standard",
      icon: "shield",
      highlights: [
        "Decisions made by hostel management regarding hostel administration, discipline, and accommodation shall be final and binding."
      ],
      rules: [
        "The hostel management reserves the full right to discontinue hostel accommodation for any student involved in misconduct, indiscipline, rule violations, or behavior affecting hostel operations."
      ],
    }
  ]
};

/**
 * Unified default agreement template combining Terms & Conditions + Hostel Rules.
 * This is the master default used when creating new templates or resetting to defaults.
 */
export const DEFAULT_AGREEMENT_TEMPLATE = {
  terms_and_conditions: DEFAULT_TERMS_AND_CONDITIONS,
  categories: DEFAULT_RULES_TEMPLATE.categories,
};

/**
 * Retrieve a single default term by ID for per-section reset.
 */
export function getDefaultTermById(termId: string) {
  return DEFAULT_TERMS_AND_CONDITIONS.find((t) => t.id === termId) || null;
}

/**
 * Retrieve a single default category by ID for per-section reset.
 */
export function getDefaultCategoryById(categoryId: string) {
  return DEFAULT_RULES_TEMPLATE.categories.find((c) => c.id === categoryId) || null;
}

export function interpolateText(text: string, variables: Record<string, any>, isFinal: boolean = false): string {
  if (!text) return "";
  return text.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (variables[trimmedKey] !== undefined && variables[trimmedKey] !== null) {
      return String(variables[trimmedKey]);
    }
    return isFinal ? "____" : match;
  });
}

export function interpolateRulesContent(rulesContent: any, variables: Record<string, any>, isFinal: boolean = false): any {
  if (!rulesContent) return null;
  const content = typeof rulesContent === "string" ? JSON.parse(rulesContent) : rulesContent;
  if (!content.categories) return content;

  const categories = content.categories.map((cat: any) => {
    return {
      ...cat,
      highlights: (cat.highlights || []).map((h: string) => interpolateText(h, variables, isFinal)),
      rules: (cat.rules || []).map((r: string) => interpolateText(r, variables, isFinal)),
    };
  });
  return { ...content, categories };
}

/**
 * Resolves the active AgreementTemplate for a hostel and ensures a matching RuleVersion exists
 * for referential integrity.
 */
export async function getActiveTemplateAndSyncRuleVersion(
  prismaClient: any,
  hostelId: string,
  type: AgreementTemplateType = "RESIDENCY"
) {
  let template = await prismaClient.agreementTemplate.findFirst({
    where: {
      hostel_id: hostelId,
      status: "PUBLISHED",
      type: type,
    },
    orderBy: { created_at: "desc" },
  });

  // Fallback to RESIDENCY if looking for RENEWAL or MOVE_OUT and none exists
  if (!template && type !== "RESIDENCY") {
    template = await prismaClient.agreementTemplate.findFirst({
      where: {
        hostel_id: hostelId,
        status: "PUBLISHED",
        type: "RESIDENCY",
      },
      orderBy: { created_at: "desc" },
    });
  }

  // If still no template exists, create a default published one
  if (!template) {
    const hostel = await prismaClient.hostels.findFirst({
      where: { id: hostelId },
      include: { profiles: { select: { name: true } } },
    });
    const ownerName = hostel?.profiles?.name || hostel?.name || "Hostel Owner";
    const templateId = crypto.randomUUID();

    template = await prismaClient.agreementTemplate.create({
      data: {
        id: templateId,
        hostel_id: hostelId,
        version: "v1-default",
        title: hostel ? `${hostel.name} Residency Agreement` : "Standard Tenant Agreement",
        custom_rules: "",
        owner_name: ownerName,
        is_active: true,
        rules_content: DEFAULT_RULES_TEMPLATE,
        type: "RESIDENCY",
        status: "PUBLISHED",
        version_number: 1,
        effective_from: new Date(),
        published_at: new Date(),
      },
    });
  }

  // Sync / Ensure matching RuleVersion exists
  const ruleVersion = await prismaClient.ruleVersion.findUnique({
    where: { id: template.id },
  });

  if (!ruleVersion) {
    await prismaClient.ruleVersion.create({
      data: {
        id: template.id,
        hostel_id: hostelId,
        version: `v${template.version_number}`,
        title: template.title,
        content: template.rules_content || DEFAULT_RULES_TEMPLATE,
        content_snapshot: template.rules_content || DEFAULT_RULES_TEMPLATE,
        is_active: true,
        active: true,
      },
    });
  }

  return template;
}
