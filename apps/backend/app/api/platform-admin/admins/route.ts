export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PlatformAdminTitle } from "@prisma/client";
import crypto from "crypto";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

const VALID_TITLES: string[] = Object.values(PlatformAdminTitle);

/** GET /api/platform-admin/admins */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const admins = await prisma.platform_admins.findMany({
      include: { profile: { select: { name: true, email: true, created_at: true } } },
      orderBy: { created_at: "desc" },
    });
    return apiResponse({ admins });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch admins");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * POST /api/platform-admin/admins
 * Body: { name, email, title }
 * Invites a new platform admin — no email delivery in V1, so the generated
 * temporary password is returned directly to the inviting admin to share
 * out-of-band (matches the "no public self-serve admin signup" posture —
 * see docs/obsidian/Decisions.md ADR-030).
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const { name, email, title } = body;

    if (!name?.trim()) return apiError("name is required", "VALIDATION_ERROR", 400);
    if (!email?.trim()) return apiError("email is required", "VALIDATION_ERROR", 400);
    if (title && !VALID_TITLES.includes(title)) return apiError(`title must be one of: ${VALID_TITLES.join(", ")}`, "VALIDATION_ERROR", 400);

    const existing = await prisma.profile.findUnique({ where: { email: email.trim() } });
    if (existing) return apiError("A profile with this email already exists", "VALIDATION_ERROR", 409);

    const tempPassword = crypto.randomBytes(6).toString("base64url");
    const passwordHash = await hashPassword(tempPassword);

    const profile = await prisma.profile.create({
      data: {
        id: crypto.randomUUID(),
        email: email.trim(),
        name: name.trim(),
        password_hash: passwordHash,
        role: "ADMIN",
        is_profile_completed: true,
        password_reset_required: true,
      },
    });
    const admin = await prisma.platform_admins.create({
      data: { profile_id: profile.id, title: (title as PlatformAdminTitle) ?? "SALES" },
    });

    return apiResponse({ admin, temporary_password: tempPassword }, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to invite admin");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
