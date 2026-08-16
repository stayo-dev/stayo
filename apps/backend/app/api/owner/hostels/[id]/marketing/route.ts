export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { marketingPageService } from "@/src/services/marketing/marketing-page-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * The owner's marketing-page editor state, and their draft saves.
 *
 * The hostel id comes from the path and is checked against ownership inside the
 * service — never defaulted to "the owner's first hostel", which is the
 * pattern `check:invariants` forbids and which would let a multi-hostel owner
 * edit the wrong listing entirely.
 */
async function requireOwner(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    throw ApiError.forbidden("Owner access required");
  }
  // An admin is unscoped: Stayo's team authors listings on an owner's behalf,
  // including for hostels the owner already runs. See marketing-scope.ts.
  return { id: session.sub, isAdmin: session.role === "ADMIN" };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ownerId = await requireOwner(req);
    const state = await marketingPageService.getEditorState(ownerId, params.id);
    return ApiResponse.success(state);
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ownerId = await requireOwner(req);
    const body = await req.json().catch(() => ({}));
    const saved = await marketingPageService.saveDraft(ownerId, params.id, body?.content);
    return ApiResponse.success(saved, "Saved");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
