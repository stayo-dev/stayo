export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { GET as getRoom } from "@/app/api/tenants/me/room/route";


/**
 * 🔗 ALIAS for /api/tenants/me/room
 * GET /api/allocations/my-room
 */
export async function GET(req: NextRequest) {
    return getRoom(req);
}
