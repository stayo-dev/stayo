export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

const GONE = { ok: false, message: "Decommissioned: legacy owner finance/subscription route removed in single-business migration" };

export async function GET(_req: NextRequest) { return NextResponse.json(GONE, { status: 410 }); }
export async function POST(_req: NextRequest) { return NextResponse.json(GONE, { status: 410 }); }
export async function PATCH(_req: NextRequest) { return NextResponse.json(GONE, { status: 410 }); }
export async function DELETE(_req: NextRequest) { return NextResponse.json(GONE, { status: 410 }); }
