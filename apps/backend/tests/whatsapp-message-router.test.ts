import { describe, expect, it, vi, beforeEach } from "vitest";
import { routeInboundMessage } from "@/lib/services/notifications/routing/message-router";
import {
  INTENTS,
  createCompositeIntentResolver,
  interactiveIntentResolver,
  keywordIntentResolver,
  linkIntentResolver,
  ownerAssistantIntentResolver,
  selectionStateIntentResolver,
} from "@/lib/services/notifications/routing/intent-resolvers";
import {
  ANY_ROLE,
  InboundMessage,
  IntentDefinition,
  KNOWN_ROLES,
  PERMISSIONS,
  SenderIdentity,
  permissionsForRoles,
} from "@/lib/services/notifications/routing/types";
import { getSelectionState } from "@/lib/services/notifications/whatsapp-selection-state";

vi.mock("@/lib/services/notifications/whatsapp-selection-state", () => ({
  getSelectionState: vi.fn(async () => null),
}));

vi.mock("@/lib/logger", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), metrics: vi.fn() };
  return { getLogger: () => logger };
});

const identity = (over: Partial<SenderIdentity> = {}): SenderIdentity => {
  const base: SenderIdentity = {
    phone: "917901070333",
    normalizedPhone: "917901070333",
    role: "UNKNOWN",
    roles: ["UNKNOWN"],
    permissions: [],
    ownerId: null,
    tenantId: null,
    tenantIds: [],
    hostelId: null,
    hostelIds: [],
    residents: [],
    profileId: null,
    displayName: null,
    confidence: 0,
    resolvedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
  // Permissions follow from roles unless a test pins them explicitly.
  return over.permissions ? base : { ...base, permissions: permissionsForRoles(base.roles) };
};

const tenant = identity({ role: "TENANT", roles: ["TENANT"], tenantIds: ["t-1"] });
const owner = identity({ role: "OWNER", roles: ["OWNER"], ownerId: "o-1" });
const ownerTenant = identity({ role: "OWNER", roles: ["OWNER", "TENANT"], ownerId: "o-1", tenantIds: ["t-1"] });

const message = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  from: "917901070333",
  messageId: "wamid.1",
  timestamp: "1718000000",
  body: "dues",
  messageType: "text",
  ...over,
});

function makeDeps(over: Partial<Parameters<typeof routeInboundMessage>[1]> = {}) {
  const calls: string[] = [];
  const definition = (name: string, allowedRoles = KNOWN_ROLES, result: unknown = { ok: true }): IntentDefinition => ({
    name,
    description: name,
    allowedRoles,
    handler: async () => {
      calls.push(name);
      return typeof result === "function" ? (result as any)() : result;
    },
  });

  const deps = {
    resolveIdentity: vi.fn(async () => tenant),
    intentResolver: keywordIntentResolver,
    registry: {
      [INTENTS.DUES]: definition(INTENTS.DUES),
      [INTENTS.HELP]: definition(INTENTS.HELP, ANY_ROLE),
    } as Record<string, IntentDefinition>,
    onFallback: vi.fn(async () => ({ fallback: true })),
    onDenied: vi.fn(async () => ({ denied: true })),
    onError: vi.fn(async () => ({ error: true })),
    ...over,
  };

  return { deps, calls, definition };
}

describe("message router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSelectionState).mockResolvedValue(null as any);
  });

  it("executes the matched intent for a permitted sender", async () => {
    const { deps, calls } = makeDeps();

    const outcome = await routeInboundMessage(message(), deps as any);

    expect(outcome.status).toBe("HANDLED");
    expect(outcome.intent?.name).toBe(INTENTS.DUES);
    expect(calls).toEqual([INTENTS.DUES]);
    expect(deps.onFallback).not.toHaveBeenCalled();
  });

  it("resolves intent BEFORE authorization — an unknown sender still reaches an open intent", async () => {
    const { deps, calls } = makeDeps({ resolveIdentity: vi.fn(async () => identity()) });

    const outcome = await routeInboundMessage(message({ body: "help" }), deps as any);

    expect(outcome.status).toBe("HANDLED");
    expect(calls).toEqual([INTENTS.HELP]);
  });

  it("denies — with a reply, never silence — when the intent is role-gated", async () => {
    const { deps, calls } = makeDeps({ resolveIdentity: vi.fn(async () => identity()) });

    const outcome = await routeInboundMessage(message({ body: "dues" }), deps as any);

    expect(outcome.status).toBe("DENIED");
    expect(outcome.intent?.name).toBe(INTENTS.DUES);
    expect(calls).toEqual([]);
    expect(deps.onDenied).toHaveBeenCalledTimes(1);
    expect(deps.onFallback).not.toHaveBeenCalled();
  });

  it("falls back — with a reply — when nothing is understood", async () => {
    const { deps } = makeDeps();

    const outcome = await routeInboundMessage(message({ body: "hello there" }), deps as any);

    expect(outcome.status).toBe("FALLBACK");
    expect(outcome.intent).toBeNull();
    expect(deps.onFallback).toHaveBeenCalledTimes(1);
    expect(deps.onDenied).not.toHaveBeenCalled();
  });

  it("moves to the next candidate when a handler declines", async () => {
    const { deps, calls, definition } = makeDeps({
      resolveIdentity: vi.fn(async () => ownerTenant),
      intentResolver: createCompositeIntentResolver([ownerAssistantIntentResolver, keywordIntentResolver]),
    });
    deps.registry[INTENTS.OWNER_ASSISTANT] = definition(INTENTS.OWNER_ASSISTANT, ANY_ROLE, { handled: false });

    const outcome = await routeInboundMessage(message({ body: "dues" }), deps as any);

    expect(calls).toEqual([INTENTS.OWNER_ASSISTANT, INTENTS.DUES]);
    expect(outcome.status).toBe("HANDLED");
    expect(outcome.intent?.name).toBe(INTENTS.DUES);
  });

  it("treats a null handler result as a decline, and falls back when nothing remains", async () => {
    const { deps, definition } = makeDeps({
      resolveIdentity: vi.fn(async () => owner),
      intentResolver: ownerAssistantIntentResolver,
    });
    deps.registry[INTENTS.OWNER_ASSISTANT] = definition(INTENTS.OWNER_ASSISTANT, ANY_ROLE, null);

    const outcome = await routeInboundMessage(message({ body: "summary" }), deps as any);

    expect(outcome.status).toBe("FALLBACK");
    expect(deps.onFallback).toHaveBeenCalledTimes(1);
  });

  it("reports a throwing handler and notifies the sender", async () => {
    const { deps } = makeDeps();
    deps.registry[INTENTS.DUES] = {
      name: INTENTS.DUES,
      description: "boom",
      allowedRoles: KNOWN_ROLES,
      handler: async () => {
        throw new Error("downstream exploded");
      },
    };

    const outcome = await routeInboundMessage(message(), deps as any);

    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toBe("downstream exploded");
    expect(deps.onError).toHaveBeenCalledTimes(1);
    expect(deps.onFallback).not.toHaveBeenCalled();
  });

  it("prefers a later permitted candidate over an earlier denied one", async () => {
    const { deps, calls, definition } = makeDeps({
      resolveIdentity: vi.fn(async () => identity()),
      intentResolver: createCompositeIntentResolver([
        { name: "fake-dues", resolve: async () => [{ name: INTENTS.DUES, source: "KEYWORD" as const, confidence: 0.7 }] },
        { name: "fake-help", resolve: async () => [{ name: INTENTS.HELP, source: "KEYWORD" as const, confidence: 0.5 }] },
      ]),
    });
    deps.registry[INTENTS.HELP] = definition(INTENTS.HELP, ANY_ROLE);

    const outcome = await routeInboundMessage(message(), deps as any);

    expect(outcome.status).toBe("HANDLED");
    expect(calls).toEqual([INTENTS.HELP]);
    expect(deps.onDenied).not.toHaveBeenCalled();
  });

  it("skips an intent with no registry entry instead of crashing", async () => {
    const { deps } = makeDeps({
      intentResolver: {
        name: "ghost",
        resolve: async () => [{ name: "NOT_REGISTERED", source: "LLM" as const, confidence: 1 }],
      },
    });

    const outcome = await routeInboundMessage(message(), deps as any);

    expect(outcome.status).toBe("FALLBACK");
  });
});

describe("intent resolvers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSelectionState).mockResolvedValue(null as any);
  });

  it("claims interactive replies with full confidence", async () => {
    const intents = await interactiveIntentResolver.resolve({
      message: message({ messageType: "interactive", interactiveType: "button_reply", body: "CMD:DUES" }),
      identity: tenant,
    });

    expect(intents[0]).toMatchObject({ name: INTENTS.INTERACTIVE_REPLY, confidence: 1 });
    expect(intents[0].slots).toMatchObject({ payloadId: "CMD:DUES" });
  });

  it("claims a pending selection prompt and carries the state as a slot", async () => {
    vi.mocked(getSelectionState).mockResolvedValue({ action: "BALANCE_SELECTION", tenants: [] } as any);

    const intents = await selectionStateIntentResolver.resolve({ message: message({ body: "2" }), identity: tenant });

    expect(intents[0].name).toBe(INTENTS.CONTINUE_SELECTION);
    expect((intents[0].slots as any).state.action).toBe("BALANCE_SELECTION");
  });

  it("routes a verified owner to the owner assistant, but not a tenant", async () => {
    expect(await ownerAssistantIntentResolver.resolve({ message: message(), identity: owner })).toHaveLength(1);
    expect(await ownerAssistantIntentResolver.resolve({ message: message(), identity: tenant })).toHaveLength(0);
  });

  it("lets an unrecognised number send LINK — the whole point of linking", async () => {
    const intents = await linkIntentResolver.resolve({ message: message({ body: "LINK 4821" }), identity: identity() });

    expect(intents[0]).toMatchObject({ name: INTENTS.OWNER_ASSISTANT, source: "OWNER_ASSISTANT" });
  });

  it("orders owner-assistant ahead of keywords for an owner, keywords alone otherwise", async () => {
    const chain = createCompositeIntentResolver([ownerAssistantIntentResolver, keywordIntentResolver]);

    const forOwner = await chain.resolve({ message: message({ body: "dues" }), identity: ownerTenant });
    const forTenant = await chain.resolve({ message: message({ body: "dues" }), identity: tenant });

    expect(forOwner.map((i) => i.name)).toEqual([INTENTS.OWNER_ASSISTANT, INTENTS.DUES]);
    expect(forTenant.map((i) => i.name)).toEqual([INTENTS.DUES]);
  });

  it("de-duplicates the same intent proposed by two resolvers", async () => {
    const twice = createCompositeIntentResolver([keywordIntentResolver, keywordIntentResolver]);

    const intents = await twice.resolve({ message: message({ body: "dues" }), identity: tenant });

    expect(intents).toHaveLength(1);
  });
});

describe("permissions and confidence floors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSelectionState).mockResolvedValue(null as any);
  });

  it("denies an intent whose required permission the role does not grant", async () => {
    const { deps, calls } = makeDeps({
      resolveIdentity: vi.fn(async () => identity({ role: "STAFF", roles: ["STAFF"] })),
    });
    deps.registry[INTENTS.DUES] = {
      name: INTENTS.DUES,
      description: "dues",
      allowedRoles: KNOWN_ROLES,
      requiredPermissions: [PERMISSIONS.PAYMENT_INITIATE],
      handler: async () => {
        calls.push(INTENTS.DUES);
        return { ok: true };
      },
    };

    const outcome = await routeInboundMessage(message({ body: "dues" }), deps as any);

    expect(outcome.status).toBe("DENIED");
    expect(calls).toEqual([]);
  });

  it("allows the same intent for a role that does grant it", async () => {
    const { deps, calls } = makeDeps({ resolveIdentity: vi.fn(async () => tenant) });
    deps.registry[INTENTS.DUES] = {
      name: INTENTS.DUES,
      description: "dues",
      allowedRoles: KNOWN_ROLES,
      requiredPermissions: [PERMISSIONS.PAYMENT_INITIATE],
      handler: async () => {
        calls.push(INTENTS.DUES);
        return { ok: true };
      },
    };

    const outcome = await routeInboundMessage(message({ body: "dues" }), deps as any);

    expect(outcome.status).toBe("HANDLED");
    expect(calls).toEqual([INTENTS.DUES]);
  });

  it("skips a candidate below its confidence floor and falls back instead of acting", async () => {
    const { deps, calls } = makeDeps({
      intentResolver: {
        name: "unsure-llm",
        resolve: async () => [
          {
            name: INTENTS.DUES,
            source: "LLM" as const,
            confidence: 0.4,
            metadata: { resolver: "llm", model: "test-model" },
          },
        ],
      },
    });
    deps.registry[INTENTS.DUES] = {
      name: INTENTS.DUES,
      description: "dues",
      allowedRoles: KNOWN_ROLES,
      minConfidence: 0.8,
      handler: async () => {
        calls.push(INTENTS.DUES);
        return { ok: true };
      },
    };

    const outcome = await routeInboundMessage(message(), deps as any);

    expect(outcome.status).toBe("FALLBACK");
    expect(calls).toEqual([]);
  });

  it("accepts an LLM-sourced intent that clears the floor, with no handler change", async () => {
    const { deps, calls } = makeDeps({
      intentResolver: {
        name: "confident-llm",
        resolve: async () => [
          {
            name: INTENTS.DUES,
            source: "LLM" as const,
            confidence: 0.93,
            slots: { month: "2026-08" },
            metadata: { resolver: "llm", model: "test-model", latencyMs: 210 },
          },
        ],
      },
    });
    deps.registry[INTENTS.DUES].minConfidence = 0.8;

    const outcome = await routeInboundMessage(message(), deps as any);

    expect(outcome.status).toBe("HANDLED");
    expect(calls).toEqual([INTENTS.DUES]);
    expect(outcome.intent?.slots).toMatchObject({ month: "2026-08" });
    expect(outcome.intent?.metadata).toMatchObject({ model: "test-model" });
  });
});
