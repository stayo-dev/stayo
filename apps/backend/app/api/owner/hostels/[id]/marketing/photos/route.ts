export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { marketingPageService } from "@/src/services/marketing/marketing-page-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * Listing photo upload.
 *
 * Returns URLs; it does not write the revision. The owner's draft in the
 * browser holds the photo list and persists it on the next save — see
 * `marketingPageService.uploadPhotos` for why that split matters.
 *
 * Accepts several files in one request because the editor lets an owner pick
 * or drop a whole gallery at once, and a request per photo would mean one
 * rejected file failing a batch the owner thought had succeeded.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      throw ApiError.forbidden("Owner access required");
    }

    const formData = await req.formData();
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    const result = await marketingPageService.uploadPhotos({ id: session.sub, isAdmin: session.role === "ADMIN" }, params.id, files);
    return ApiResponse.success(result, "Uploaded");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
