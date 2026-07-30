import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "../app/api/owner/hostels/[id]/agreement-template/route";
import { NextRequest } from "next/server";
import { prisma } from "../lib/db";
import { getSession } from "../lib/auth";

vi.mock("../lib/auth", () => ({
  getSession: vi.fn(),
  apiError: (msg: string, code: string, status = 400) => {
    return Response.json({ error: msg, code }, { status });
  },
  apiResponse: (data: any) => {
    return Response.json(data);
  },
}));

vi.mock("../lib/db", () => ({
  prisma: {
    hostels: {
      findFirst: vi.fn(),
    },
  },
}));

describe("Agreement Template Validation constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fail validation if categories is not an array", async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: "owner-1", role: "OWNER" } as any);
    vi.mocked(prisma.hostels.findFirst).mockResolvedValue({ id: "hostel-1", name: "Test Hostel" } as any);

    const req = new NextRequest("http://localhost/api/owner/hostels/hostel-1/agreement-template", {
      method: "POST",
      body: JSON.stringify({
        action: "save_draft",
        type: "RESIDENCY",
        rules_content: { categories: "not-an-array" },
      }),
    });

    const res = await POST(req, { params: { id: "hostel-1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("categories must be an array");
  });

  it("should fail validation if categories array is empty", async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: "owner-1", role: "OWNER" } as any);
    vi.mocked(prisma.hostels.findFirst).mockResolvedValue({ id: "hostel-1", name: "Test Hostel" } as any);

    const req = new NextRequest("http://localhost/api/owner/hostels/hostel-1/agreement-template", {
      method: "POST",
      body: JSON.stringify({
        action: "save_draft",
        type: "RESIDENCY",
        rules_content: { categories: [] },
      }),
    });

    const res = await POST(req, { params: { id: "hostel-1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("at least one rules category");
  });

  it("should fail validation if category does not have ID or title", async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: "owner-1", role: "OWNER" } as any);
    vi.mocked(prisma.hostels.findFirst).mockResolvedValue({ id: "hostel-1", name: "Test Hostel" } as any);

    const req = new NextRequest("http://localhost/api/owner/hostels/hostel-1/agreement-template", {
      method: "POST",
      body: JSON.stringify({
        action: "save_draft",
        type: "RESIDENCY",
        rules_content: {
          categories: [
            { id: "cat-1", title: "", rules: [] }
          ]
        },
      }),
    });

    const res = await POST(req, { params: { id: "hostel-1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Category title is required");
  });

  it("should fail validation if category rules is not an array", async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: "owner-1", role: "OWNER" } as any);
    vi.mocked(prisma.hostels.findFirst).mockResolvedValue({ id: "hostel-1", name: "Test Hostel" } as any);

    const req = new NextRequest("http://localhost/api/owner/hostels/hostel-1/agreement-template", {
      method: "POST",
      body: JSON.stringify({
        action: "save_draft",
        type: "RESIDENCY",
        rules_content: {
          categories: [
            { id: "cat-1", title: "Valid Category", rules: "not-array" }
          ]
        },
      }),
    });

    const res = await POST(req, { params: { id: "hostel-1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("must contain a rules array");
  });
});
