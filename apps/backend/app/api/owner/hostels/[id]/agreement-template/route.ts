export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventSystem } from "@/lib/events";
import {
  getActiveTemplateAndSyncRuleVersion,
  DEFAULT_RULES_TEMPLATE,
  DEFAULT_AGREEMENT_TEMPLATE,
  DEFAULT_TERMS_AND_CONDITIONS,
  getDefaultTermById,
  getDefaultCategoryById,
} from "@/src/utils/default-rules";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const hostelId = params.id;

  try {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: session.sub },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    // Always resolve the single RESIDENCY template
    const activeTemplate = await getActiveTemplateAndSyncRuleVersion(prisma, hostelId, "RESIDENCY");

    // Find if there is an unsaved draft
    const draftTemplate = await prisma.agreementTemplate.findFirst({
      where: {
        hostel_id: hostelId,
        type: "RESIDENCY",
        status: "DRAFT",
      },
      orderBy: { created_at: "desc" },
    });

    return apiResponse({
      active: activeTemplate,
      draft: draftTemplate,
      default_rules: DEFAULT_RULES_TEMPLATE,
      default_terms: DEFAULT_TERMS_AND_CONDITIONS,
      default_template: DEFAULT_AGREEMENT_TEMPLATE,
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch agreement template");
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const hostelId = params.id;
  try {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: session.sub },
      include: { profiles: { select: { name: true } } },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const body = await req.json();
    const action = String(body.action || "save_draft"); // "save_draft" | "publish" | "reset_section" | "reset_all"

    // ── Reset Section Action ──────────────────────────────────────
    if (action === "reset_section") {
      const sectionType = String(body.section_type || "").trim();
      const sectionId = String(body.section_id || "").trim();
      if (!["term", "category"].includes(sectionType)) {
        return apiError("section_type must be 'term' or 'category'", "VALIDATION_ERROR", 400);
      }
      if (!sectionId) return apiError("section_id is required", "VALIDATION_ERROR", 400);

      const defaultSection = sectionType === "term"
        ? getDefaultTermById(sectionId)
        : getDefaultCategoryById(sectionId);

      if (!defaultSection) {
        return apiError(`Default ${sectionType} '${sectionId}' not found`, "NOT_FOUND", 404);
      }

      return apiResponse({ section_type: sectionType, section_id: sectionId, default: defaultSection });
    }

    // ── Reset All Action ──────────────────────────────────────────
    if (action === "reset_all") {
      return apiResponse({ default_template: DEFAULT_AGREEMENT_TEMPLATE });
    }

    // ── Save Draft / Publish ──────────────────────────────────────
    const type = "RESIDENCY" as const;
    const title = String(body.title || "Standard Tenant Agreement").trim();
    const owner_name = String(body.owner_name || hostel.profiles?.name || hostel.name).trim();
    const owner_signature_url = body.owner_signature_url ? String(body.owner_signature_url).trim() : null;
    const custom_rules = String(body.custom_rules || "").trim();
    const rules_content = body.rules_content || DEFAULT_AGREEMENT_TEMPLATE;

    // Validate rules_content structure
    if (rules_content) {
      if (typeof rules_content !== "object") {
        return apiError("Invalid rules structure", "VALIDATION_ERROR", 400);
      }

      // Validate categories (required)
      if (!Array.isArray(rules_content.categories)) {
        return apiError("Invalid rules structure: categories must be an array", "VALIDATION_ERROR", 400);
      }
      if (rules_content.categories.length === 0) {
        return apiError("Template must contain at least one rules category", "VALIDATION_ERROR", 400);
      }
      for (const cat of rules_content.categories) {
        if (!cat || typeof cat !== "object") {
          return apiError("Invalid category format", "VALIDATION_ERROR", 400);
        }
        if (!cat.id || typeof cat.id !== "string" || !cat.id.trim()) {
          return apiError("Category ID is required and must be a valid string", "VALIDATION_ERROR", 400);
        }
        if (!cat.title || typeof cat.title !== "string" || !cat.title.trim()) {
          return apiError("Category title is required and must be a valid string", "VALIDATION_ERROR", 400);
        }
        if (!Array.isArray(cat.rules)) {
          return apiError(`Category '${cat.title || cat.id}' must contain a rules array`, "VALIDATION_ERROR", 400);
        }
        if (cat.highlights && !Array.isArray(cat.highlights)) {
          return apiError(`Category '${cat.title || cat.id}' highlights must be an array of strings`, "VALIDATION_ERROR", 400);
        }
      }

      // Validate terms_and_conditions (optional — backward compat)
      if (rules_content.terms_and_conditions) {
        if (!Array.isArray(rules_content.terms_and_conditions)) {
          return apiError("terms_and_conditions must be an array", "VALIDATION_ERROR", 400);
        }
        for (const term of rules_content.terms_and_conditions) {
          if (!term || typeof term !== "object") {
            return apiError("Invalid term format", "VALIDATION_ERROR", 400);
          }
          if (!term.id || typeof term.id !== "string" || !term.id.trim()) {
            return apiError("Term ID is required", "VALIDATION_ERROR", 400);
          }
          if (!term.content || typeof term.content !== "string" || !term.content.trim()) {
            return apiError("Term content is required", "VALIDATION_ERROR", 400);
          }
        }
      }
    }

    if (action === "publish" && !owner_name) {
      return apiError("Authorized Signatory Name is required for publishing", "VALIDATION_ERROR", 400);
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // Find current draft if any
      const existingDraft = await tx.agreementTemplate.findFirst({
        where: { hostel_id: hostelId, type, status: "DRAFT" },
      });

      if (action === "save_draft") {
        if (existingDraft) {
          const updatedDraft = await tx.agreementTemplate.update({
            where: { id: existingDraft.id },
            data: {
              title,
              owner_name,
              owner_signature_url,
              custom_rules,
              rules_content,
              updated_at: new Date(),
            },
          });
          return updatedDraft;
        } else {
          const newDraft = await tx.agreementTemplate.create({
            data: {
              id: crypto.randomUUID(),
              hostel_id: hostelId,
              version: `v-draft-${Date.now()}`,
              title,
              owner_name,
              owner_signature_url,
              custom_rules,
              rules_content,
              type,
              status: "DRAFT",
              is_active: false,
              version_number: 0,
            },
          });
          return newDraft;
        }
      } else if (action === "publish") {
        // Find highest version number for this type/hostel
        const lastPublished = await tx.agreementTemplate.findFirst({
          where: { hostel_id: hostelId, type, status: "PUBLISHED" },
          orderBy: { version_number: "desc" },
        });
        const nextVersion = lastPublished ? lastPublished.version_number + 1 : 1;

        // Archive previous active template(s)
        await tx.agreementTemplate.updateMany({
          where: { hostel_id: hostelId, type, status: "PUBLISHED" },
          data: { status: "ARCHIVED", is_active: false },
        });

        // Delete the draft if it exists since it's now being published
        if (existingDraft) {
          await tx.agreementTemplate.delete({
            where: { id: existingDraft.id },
          });
        }

        // Create new published template
        const publishedTemplate = await tx.agreementTemplate.create({
          data: {
            id: crypto.randomUUID(),
            hostel_id: hostelId,
            version: `v${nextVersion}`,
            title,
            owner_name,
            owner_signature_url,
            custom_rules,
            rules_content,
            type,
            status: "PUBLISHED",
            is_active: true,
            version_number: nextVersion,
            effective_from: new Date(),
            published_at: new Date(),
            published_by_id: session.sub,
          },
        });

        // Sync RuleVersion for backward compatibility
        await tx.ruleVersion.upsert({
          where: { id: publishedTemplate.id },
          create: {
            id: publishedTemplate.id,
            hostel_id: hostelId,
            version: `v${publishedTemplate.version_number}`,
            title: publishedTemplate.title,
            content: publishedTemplate.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
            content_snapshot: publishedTemplate.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
            is_active: true,
            active: true,
          },
          update: {
            version: `v${publishedTemplate.version_number}`,
            title: publishedTemplate.title,
            content: publishedTemplate.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
            content_snapshot: publishedTemplate.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
            is_active: true,
            active: true,
          },
        });

        // Mark all other RuleVersions for this hostel as inactive
        await tx.ruleVersion.updateMany({
          where: { hostel_id: hostelId, id: { not: publishedTemplate.id } },
          data: { is_active: false, active: false },
        });

        return publishedTemplate;
      } else {
        throw new Error("Invalid action");
      }
    });

    if (action === "publish") {
      await eventSystem.trigger("agreement_template_updated", {
        owner_id: session.sub,
        hostel_id: hostelId,
        actionType: "PUBLISH",
        version: result.version,
        title: result.title,
        owner_signature_url: result.owner_signature_url,
      }).catch((err: any) => console.error("Event trigger failed:", err));
    }

    return apiResponse(result);
  } catch (error: any) {
    return apiError(error.message || "Failed to handle agreement template request");
  }
}
