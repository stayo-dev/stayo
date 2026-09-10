export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { eventLog } from "@/lib/services/event-log-service";
import { withOnboardingMetrics } from "@/lib/onboarding-metrics";
import type { Prisma } from "@prisma/client";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { activationSubjectFromRequest } from "@/src/services/tenants/activation-request-subject";
import { requiredKycDocTypes, recomputeDocumentVerified } from "@/src/services/tenants/kyc-status";
import { createSupersedingDocument, publicDocument } from "@/src/services/tenants/identification-document-service";
import { latestOwnerMessage } from "@/src/services/tenants/document-thread";

/**
 * KYC document upload during onboarding.
 *
 * The tenant has no login session until the final ACTIVATE step, so the
 * session-guarded `POST /api/tenants/me/documents` cannot be used here. This is
 * its activation-phase peer — token OR session, exactly like
 * `/api/tenants/activate/photo` — writing the same `identification_documents`
 * rows to the same ImageKit path. Uploads land PENDING; onboarding never waits
 * for owner approval (spec §4, §17).
 */

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE = 5 * 1024 * 1024;

async function resolveTenant(req: NextRequest, token: string | null) {
  const subject = await activationSubjectFromRequest(req, token);
  if (!subject.ok) {
    return { tenant: null, error: apiError("token is required", "VALIDATION_ERROR", 400) };
  }

  const resolved = subject.mode === "session"
    ? await tenantInvitationLifecycleService.resolveForSession(String(subject.tenantId || ""))
    : await tenantInvitationLifecycleService.resolveByToken(String(subject.token || ""));
  if (!resolved.tenant) {
    return { tenant: null, error: apiError("Invalid or expired activation link", "INVALID", 410) };
  }

  return { tenant: resolved.tenant, error: null };
}

/** Rehydrate the wizard: required types and where each one stands. */
export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  try {
    const token = new URL(req.url).searchParams.get("token");
    const { tenant, error } = await resolveTenant(req, token);
    if (error) return withOnboardingMetrics(error, { startedAt });

    const required = requiredKycDocTypes(tenant.profile_type);
    const active = await prisma.identificationDocument.findMany({
      where: { tenant_id: tenant.id, is_active: true, doc_type: { in: required } },
      orderBy: { created_at: "desc" },
    });

    const items = required.map((docType) => {
      const doc = active.find((d: { doc_type: string }) => d.doc_type === docType);
      if (!doc) return { doc_type: docType, document_status: "MISSING" as const, rejection_reason: null };
      return {
        doc_type: docType,
        document_status: doc.document_status,
        rejection_reason: doc.document_status === "REJECTED" ? latestOwnerMessage(doc.rejection_reason) : null,
      };
    });

    return withOnboardingMetrics(apiResponse({ required, items }), { startedAt });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return withOnboardingMetrics(apiError(msg || "Failed to load documents"), { startedAt });
  }
}

export async function POST(req: NextRequest) {
  const startedAt = performance.now();
  let externalCalls = 0;
  try {
    const formData = await req.formData();
    const token = formData.get("token") as string | null;
    const file = formData.get("file") as File | null;
    const docType = String(formData.get("doc_type") ?? "").toUpperCase();
    const docNumber = formData.get("doc_number") ? String(formData.get("doc_number")) : null;

    const { tenant, error } = await resolveTenant(req, token);
    if (error) return withOnboardingMetrics(error, { startedAt });

    if (!file) return withOnboardingMetrics(apiError("file is required", "VALIDATION_ERROR", 400), { startedAt });

    const allowedTypes = requiredKycDocTypes(tenant.profile_type);
    if (!allowedTypes.includes(docType)) {
      return withOnboardingMetrics(
        apiError(`Invalid doc_type. Upload only ${allowedTypes.join(" and ")}.`, "VALIDATION_ERROR", 400),
        { startedAt },
      );
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return withOnboardingMetrics(apiError("File must be JPG, PNG, WEBP, or PDF", "VALIDATION_ERROR", 400), { startedAt });
    }
    if (file.size > MAX_SIZE) {
      return withOnboardingMetrics(apiError("File must be under 5MB", "VALIDATION_ERROR", 400), { startedAt });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    externalCalls = 1;
    const upload = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: file.name || `${docType.toLowerCase()}.jpg`,
      folder: `owners/${tenant.owner_id}/tenants/${tenant.id}/documents/${docType}`,
      useUniqueFileName: true,
      tags: [docType, tenant.id],
    });

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const document = await createSupersedingDocument(tx, {
        tenantId: tenant.id,
        docType,
        docNumber,
        file: { url: upload.url, filePath: upload.filePath, fileId: upload.fileId },
        mimeType: file.type,
        fileSize: file.size,
        uploadedBy: tenant.profile_id ?? null,
      });
      await recomputeDocumentVerified(tx, tenant.id);
      return document;
    });

    await eventLog.log("documents_uploaded", tenant.owner_id || null, {
      tenant_id: tenant.id,
      doc_type: docType,
      document_id: created.id,
      via: "activation",
    }, tenant.id);

    return withOnboardingMetrics(apiResponse(publicDocument(created, tenant.id), 201), {
      startedAt,
      payload: { document_id: created.id },
      externalCalls,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return withOnboardingMetrics(apiError(msg || "Failed to upload document"), {
      startedAt,
      payload: { message: msg },
      externalCalls,
    });
  }
}
