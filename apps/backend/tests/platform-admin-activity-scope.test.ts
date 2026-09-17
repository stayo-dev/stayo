/**
 * GET /api/platform-admin/activity is scoped, server-side, to MANAGER/ADMIN
 * activity by default (see the route's own doc comment). `activity_logs` is
 * a shared table pre-existing owner-side event handlers
 * (`lib/events/index.ts`) also write to for routine tenant/room
 * create/update/allocate actions — this suite proves that owner-generated
 * rows never surface in this feed, with or without the optional filters,
 * and that manager/admin rows still do.
 *
 * Route-handler-level test against real Postgres, mirroring the pattern in
 * tests/admin-add-owner.test.ts (`x-auth-mode: legacy` headers, no mocking).
 */
import crypto from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getActivity } from "@/app/api/platform-admin/activity/route";
import { prisma } from "@/lib/db";
import { activityService } from "@/lib/services/activity.service";

const ADMIN_ID = crypto.randomUUID();

function adminReq(url: string): NextRequest {
  return new NextRequest(url, {
    method: "GET",
    headers: {
      "x-auth-mode": "legacy",
      "x-user-id": ADMIN_ID,
      "x-user-role": "ADMIN",
      "x-user-email": "admin@test.local",
    },
  } as any);
}

async function makeProfile(role: "OWNER" | "MANAGER" | "ADMIN") {
  const id = crypto.randomUUID();
  await prisma.profile.create({
    data: {
      id,
      email: `activity-scope-${role.toLowerCase()}-${id}@test.local`,
      name: `Test ${role}`,
      role,
      is_active: true,
    },
  });
  return id;
}

describe("GET /api/platform-admin/activity — role scoping", () => {
  let ownerId: string;
  let managerId: string;
  let adminActorId: string;
  const createdProfileIds: string[] = [];

  afterAll(async () => {
    await prisma.activity_logs.deleteMany({ where: { user_id: { in: [ownerId, managerId, adminActorId, ADMIN_ID] } } });
    await prisma.profile.deleteMany({ where: { id: { in: [...createdProfileIds, ADMIN_ID] } } });
  });

  it("sets up owner, manager and admin actors with real activity_logs rows", async () => {
    ownerId = await makeProfile("OWNER");
    managerId = await makeProfile("MANAGER");
    adminActorId = await makeProfile("ADMIN");
    createdProfileIds.push(ownerId, managerId, adminActorId);
    // The calling Super Admin session also needs a real profile row —
    // requireAdmin only checks the session header, but nothing else here
    // depends on it existing, so this is just for cleanup symmetry.
    await prisma.profile.create({
      data: { id: ADMIN_ID, email: `activity-scope-caller-${ADMIN_ID}@test.local`, name: "Caller Admin", role: "ADMIN", is_active: true },
    });

    // Owner-generated activity — the exact action types from the
    // pre-existing owner-side event system (lib/events/index.ts).
    for (const actionType of ["ALLOCATE", "CREATE", "UPDATE", "DELETE"]) {
      await activityService.log({
        userId: ownerId,
        ownerId,
        actionType,
        entityType: "ROOM",
        entityId: crypto.randomUUID(),
        metadata: { hostel_id: "11111111-1111-1111-1111-111111111111" },
      });
    }

    // Manager and admin activity — the shape manager-activity.ts writes.
    await activityService.log({
      userId: managerId,
      actionType: "HOSTEL_UPDATED",
      entityType: "HOSTEL",
      entityId: crypto.randomUUID(),
      metadata: { hostel_id: "22222222-2222-2222-2222-222222222222", actor_role: "MANAGER" },
    });
    await activityService.log({
      userId: adminActorId,
      actionType: "MANAGER_UPDATED",
      entityType: "MANAGER",
      entityId: crypto.randomUUID(),
      metadata: { actor_role: "ADMIN" },
    });

    expect(true).toBe(true);
  });

  it("never returns owner-generated activity (ALLOCATE/CREATE/UPDATE/DELETE), even though it exists in activity_logs", async () => {
    const res = await getActivity(adminReq("http://localhost/api/platform-admin/activity?limit=200"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const actorIds = body.activity.map((a: any) => a.actorProfileId);
    expect(actorIds).not.toContain(ownerId);
    const actionTypes = body.activity.filter((a: any) => a.actorProfileId === ownerId).map((a: any) => a.actionType);
    expect(actionTypes).toEqual([]);
  });

  it("returns manager and admin activity by default", async () => {
    const res = await getActivity(adminReq("http://localhost/api/platform-admin/activity?limit=200"));
    const body = await res.json();
    const actorIds = body.activity.map((a: any) => a.actorProfileId);
    expect(actorIds).toContain(managerId);
    expect(actorIds).toContain(adminActorId);
  });

  it("the managerId filter cannot be used to smuggle an owner's activity into the feed", async () => {
    const res = await getActivity(
      adminReq(`http://localhost/api/platform-admin/activity?managerId=${ownerId}`),
    );
    const body = await res.json();
    expect(body.activity).toEqual([]);
  });

  it("the hostelId filter still narrows correctly within the manager/admin scope", async () => {
    const res = await getActivity(
      adminReq("http://localhost/api/platform-admin/activity?hostelId=22222222-2222-2222-2222-222222222222"),
    );
    const body = await res.json();
    expect(body.activity.every((a: any) => a.actorProfileId !== ownerId)).toBe(true);
    expect(body.activity.some((a: any) => a.actorProfileId === managerId)).toBe(true);
  });

  it("the actionType filter still works within the manager/admin scope", async () => {
    const res = await getActivity(
      adminReq("http://localhost/api/platform-admin/activity?actionType=HOSTEL_UPDATED"),
    );
    const body = await res.json();
    expect(body.activity.length).toBeGreaterThan(0);
    expect(body.activity.every((a: any) => a.actionType === "HOSTEL_UPDATED")).toBe(true);
  });

  it("a non-admin caller is still rejected (unrelated to scoping, guards against a regression here)", async () => {
    const req = new NextRequest("http://localhost/api/platform-admin/activity", {
      method: "GET",
      headers: { "x-auth-mode": "legacy", "x-user-id": ownerId, "x-user-role": "OWNER" },
    } as any);
    const res = await getActivity(req);
    expect(res.status).toBe(500);
  });
});
