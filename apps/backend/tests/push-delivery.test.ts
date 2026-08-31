import { describe, it, expect, vi } from "vitest";
import { deliver } from "@/src/services/notifications/push/push-delivery";

const sub = (endpoint: string) => ({ endpoint, p256dh: "k", auth: "a" });
const payload = { title: "Rent due", body: "₹8,000 due today", url: "/tenant/money" };

describe("deliver", () => {
  it("sends to every subscription a profile has, because one person has many devices", async () => {
    const send = vi.fn(async () => undefined);
    const result = await deliver({ send }, [sub("a"), sub("b"), sub("c")], payload);
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.sent).toBe(3);
  });

  it("prunes a subscription the push service reports as gone (410)", async () => {
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint === "dead") throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const result = await deliver({ send }, [sub("live"), sub("dead")], payload);
    expect(result.pruned).toEqual(["dead"]);
    expect(result.sent).toBe(1);
  });

  it("prunes on 404 as well", async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    });
    const result = await deliver({ send }, [sub("x")], payload);
    expect(result.pruned).toEqual(["x"]);
  });

  it("does NOT prune on a transient failure, which would lose a live device", async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("service unavailable"), { statusCode: 503 });
    });
    const result = await deliver({ send }, [sub("x")], payload);
    expect(result.pruned).toEqual([]);
    expect(result.sent).toBe(0);
  });

  it("one dead device does not stop the others being reached", async () => {
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint === "dead") throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const result = await deliver({ send }, [sub("dead"), sub("live1"), sub("live2")], payload);
    expect(result.sent).toBe(2);
  });

  it("resolves rather than rejecting when every send fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("total outage");
    });
    await expect(deliver({ send }, [sub("x")], payload)).resolves.toBeDefined();
  });
});
