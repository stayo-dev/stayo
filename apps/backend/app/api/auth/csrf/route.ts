export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/auth";
import { setCsrfCookie } from "@/lib/security/csrf";

export async function GET(_req: NextRequest) {
  const response = apiResponse({ ok: true });
  setCsrfCookie(response, 60 * 60 * 24);
  return response;
}
