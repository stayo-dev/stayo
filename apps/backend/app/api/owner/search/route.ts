export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const logger = getLogger("search-api");

/**
 * GET /api/owner/search?q=ram&limit=10
 * Optimized multi-tenant search endpoint used for the global navbar.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    // Explicitly enforce OWNER/ADMIN roles for global search
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      return NextResponse.json(
        { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() || "";
    const limitParams = searchParams.get("limit");
    const limit = limitParams ? Math.min(parseInt(limitParams, 10), 20) : 10;

    // 1. Prevent expensive empty/short queries
    if (q.length < 2) {
      return NextResponse.json([]);
    }

    // 2. Perform highly indexed lookup across active tenants
    // We search the Profile model (which acts as the user details table) connected to tenants 
    // owned by this owner.
    const profiles = await prisma.profile.findMany({
      where: {
        owner_id: session.sub, // MUST restrict by owner!
        // We only want tenant profiles
        role: "TENANT", 
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { email: { contains: q, mode: "insensitive" } },
        ]
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        tenants: {
          select: {
            id: true,
            status: true,
            photo_url: true,
          }
        }
      },
      take: limit, // NEVER return full tables
      orderBy: { created_at: "desc" }
    });

    // 3. Format response for frontend 
    // Usually the frontend expects an array of tenant objects.
    const results = profiles.map(p => ({
      id: p.tenants?.id, // Tenant ID
      profile_id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      status: p.tenants?.status,
      photo_url: p.tenants?.photo_url,
    })).filter(p => p.id); // Valid tenants only

    return NextResponse.json(results);
  } catch (error) {
    logger.error("Search API Error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: { message: "Search failed", code: "INTERNAL_ERROR" } },
      { status: 500 }
    );
  }
}
