import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockMeals, mockAssert } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockMeals: { getForecast: vi.fn(), recordServed: vi.fn() },
  mockAssert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code: string, status = 500) =>
    new Response(JSON.stringify({ success: false, error: { message, code } }), { status }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ success: true, ...data }), { status }),
}));
vi.mock("@/lib/security/scoped-query", () => ({
  assertHostelBelongsToOwner: mockAssert,
  requireHostelBelongsToOwner: mockAssert,
}));
vi.mock("@/src/services/meals/meal-forecast-service", () => ({ mealForecastService: mockMeals }));

import { GET as getForecast } from "../app/api/hostels/[id]/meals/forecast/route";
import { PUT as putServed } from "../app/api/hostels/[id]/meals/served/route";
import { MealError } from "@/src/services/meals/meal-errors";

const HOSTEL = "11111111-1111-4111-8111-111111111111";
const OWNER_SESSION = { sub: "o1", owner_id: "o1", role: "OWNER" };
const req = (body: unknown = {}, url = `http://test/api/hostels/${HOSTEL}/meals/forecast`) =>
  ({ json: async () => body, url }) as any;
const ctx = () => ({ params: Promise.resolve({ id: HOSTEL }) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockAssert.mockResolvedValue({ id: HOSTEL });
});

describe("meals routes", () => {
  it("keeps tenants out", async () => {
    mockSession.mockResolvedValue({ sub: "p1", role: "TENANT" });
    expect((await getForecast(req(), ctx())).status).toBe(403);
    expect((await putServed(req({}), ctx())).status).toBe(403);
  });

  it("scopes the forecast to a hostel the owner owns, and passes the range through", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockMeals.getForecast.mockResolvedValue({ today: "2026-09-14", days: [] });
    const res = await getForecast(req({}, "http://test/api?from=2026-09-14&to=2026-09-15"), ctx());
    expect(res.status).toBe(200);
    expect(mockAssert).toHaveBeenCalledWith("o1", HOSTEL);
    expect(mockMeals.getForecast).toHaveBeenCalledWith(HOSTEL, { from: "2026-09-14", to: "2026-09-15" });
  });

  it("refuses another owner's hostel", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockAssert.mockRejectedValue(Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" }));
    expect((await getForecast(req(), ctx())).status).toBe(403);
    expect(mockMeals.getForecast).not.toHaveBeenCalled();
  });

  it("records a served count with the session owner as the author", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockMeals.recordServed.mockResolvedValue({ mealType: "DINNER", served: 27 });
    const res = await putServed(req({ serveDate: "2026-09-14", mealType: "DINNER", servedCount: 27 }), ctx());
    expect(res.status).toBe(200);
    expect(mockMeals.recordServed).toHaveBeenCalledWith(
      expect.objectContaining({
        hostelId: HOSTEL,
        serveDate: "2026-09-14",
        mealType: "DINNER",
        servedCount: 27,
        recordedBy: "o1",
      }),
    );
  });

  it("carries a MealError's status and code through", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockMeals.recordServed.mockRejectedValue(new MealError("INVALID_REQUEST", "That meal has not been served yet", 400));
    const res = await putServed(req({ serveDate: "2026-09-15", mealType: "DINNER", servedCount: 1 }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ message: "That meal has not been served yet", code: "INVALID_REQUEST" });
  });
});
