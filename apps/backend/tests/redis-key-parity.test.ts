import { describe, expect, it, afterEach } from "vitest";
import { redisKeys } from "@/lib/redis/keys";
import { edgeSessionKeys } from "@/lib/redis/session-revocation-edge";

/**
 * Session revocation is a **cross-runtime contract**: the Node runtime writes
 * the key (`sessionLifecycleService.revokeSession` → `redisKeys.session.*`)
 * and the Edge runtime reads it (`middleware.ts` →
 * `checkSessionRevocationEdge` → `edgeSessionKeys.*`). The Edge module cannot
 * import `lib/redis/keys.ts`'s helpers without pulling Node-only code into
 * the Edge bundle, so it reimplements the key format — its own `clean()`, its
 * own `"v1"` literal, its own `"hms"` default.
 *
 * The two agree today only by hand. Nothing enforces it, and divergence fails
 * **open and silent**: writes land under one key, `checkSessionRevocationEdge`
 * reads another, finds nothing, and returns `{ ok: true }` — so a logged-out
 * access token keeps working until it expires, with no error anywhere.
 *
 * This test is the enforcement. It fails if the version segment, the prefix
 * resolution, the character cleaning, or the key structure drifts in either
 * file.
 */
const ORIGINAL_PREFIX = process.env.REDIS_KEY_PREFIX;

afterEach(() => {
  if (ORIGINAL_PREFIX === undefined) delete process.env.REDIS_KEY_PREFIX;
  else process.env.REDIS_KEY_PREFIX = ORIGINAL_PREFIX;
});

/** Every session key in the Node-write / Edge-read path. */
const SESSION_KEY_PAIRS = [
  {
    name: "revoked",
    node: (id: string) => redisKeys.session.revoked(id),
    edge: (id: string) => edgeSessionKeys.revoked(id),
  },
  {
    name: "userRevokedAfter",
    node: (id: string) => redisKeys.session.userRevokedAfter(id),
    edge: (id: string) => edgeSessionKeys.userRevokedAfter(id),
  },
  {
    name: "activity",
    node: (id: string) => redisKeys.session.activity(id),
    edge: (id: string) => edgeSessionKeys.activity(id),
  },
  {
    name: "activityThrottle",
    node: (id: string) => redisKeys.session.activityThrottle(id),
    edge: (id: string) => edgeSessionKeys.activityThrottle(id),
  },
] as const;

describe("Redis session key parity between the Node and Edge builders", () => {
  it.each(SESSION_KEY_PAIRS)("$name matches under the default prefix", ({ node, edge }) => {
    delete process.env.REDIS_KEY_PREFIX;

    expect(edge("session-abc")).toBe(node("session-abc"));
  });

  it.each(SESSION_KEY_PAIRS)("$name matches under a custom prefix", ({ node, edge }) => {
    process.env.REDIS_KEY_PREFIX = "stayo-prod";

    expect(edge("session-abc")).toBe(node("session-abc"));
  });

  it.each(SESSION_KEY_PAIRS)("$name matches for identifiers needing encoding", ({ node, edge }) => {
    delete process.env.REDIS_KEY_PREFIX;
    // A colon would split the key, and a space/slash exercises `clean()`. If
    // one builder encodes and the other doesn't, this is where it shows.
    const awkward = "a b/c:d?e";

    expect(edge(awkward)).toBe(node(awkward));
  });

  it("both builders honour REDIS_KEY_PREFIX rather than baking in a default", () => {
    process.env.REDIS_KEY_PREFIX = "stayo-testing";

    expect(edgeSessionKeys.revoked("s1")).toContain("stayo-testing:");
    expect(redisKeys.session.revoked("s1")).toContain("stayo-testing:");
  });

  it("both builders emit the same version segment", () => {
    delete process.env.REDIS_KEY_PREFIX;

    const nodeVersion = redisKeys.session.revoked("s1").split(":")[1];
    const edgeVersion = edgeSessionKeys.revoked("s1").split(":")[1];

    expect(edgeVersion).toBe(nodeVersion);
    // Pinned deliberately: bumping the version in one file only is the exact
    // silent-failure this suite exists to catch, so it must be a deliberate,
    // two-file change that also updates this expectation.
    expect(nodeVersion).toBe("v1");
  });

  it("produces the exact key structure the deployed data already uses", () => {
    delete process.env.REDIS_KEY_PREFIX;

    // Literal, not derived — a structural change (segment order, naming,
    // separator) would orphan every key already live in Upstash.
    expect(redisKeys.session.revoked("s1")).toBe("hms:v1:session:revoked:s1");
    expect(edgeSessionKeys.revoked("s1")).toBe("hms:v1:session:revoked:s1");
    expect(edgeSessionKeys.userRevokedAfter("u1")).toBe("hms:v1:session:user-revoked-after:u1");
    expect(edgeSessionKeys.activity("s1")).toBe("hms:v1:session:activity:s1");
    expect(edgeSessionKeys.activityThrottle("s1")).toBe("hms:v1:session:activity-throttle:s1");
  });
});
