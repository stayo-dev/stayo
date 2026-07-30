export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

function qrImageUrl(value: string, size: number) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Only owners can download admission QR codes"));
  }

  try {
    const params = new URL(req.url).searchParams;
    const data = params.get("data") || "";
    const requestedSize = Number(params.get("size") || 512);
    const size = Number.isFinite(requestedSize) ? Math.min(Math.max(requestedSize, 160), 1024) : 512;

    if (!data || data.length > 2048 || !/^https?:\/\//.test(data)) {
      return ApiResponse.error(ApiError.validationError("A valid QR link is required"));
    }

    const response = await fetch(qrImageUrl(data, size), { cache: "no-store" });
    if (!response.ok) {
      return ApiResponse.error(ApiError.internal("Could not generate QR image"));
    }

    const image = await response.arrayBuffer();
    return new NextResponse(image, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return ApiResponse.error(error);
  }
}
