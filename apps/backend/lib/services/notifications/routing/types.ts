/**
 * WhatsApp inbound routing contracts.
 *
 * The pipeline is: identity → intent(s) → permission → handler → fallback.
 * Nothing in here knows *how* an intent is derived, which is the point: a
 * keyword matcher and an LLM classifier are the same shape, so adding the
 * latter never touches routing. Likewise a new role is a union member plus an
 * `allowedRoles` entry — no branching in the router.
 */

/**
 * STAFF is declared but never produced today: this codebase's `Role` enum is
 * OWNER | TENANT | ADMIN, and there is no staff table to resolve against.
 * It exists so the union and the permission tables are ready when one lands.
 */
export type SenderRole = "OWNER" | "TENANT" | "GUARDIAN" | "STAFF" | "ADMIN" | "UNKNOWN";

/** Every known role — the permission list for intents anyone recognised may use. */
export const KNOWN_ROLES: SenderRole[] = ["OWNER", "TENANT", "GUARDIAN", "STAFF", "ADMIN"];

/** Including UNKNOWN — for intents that must work before we know who is calling. */
export const ANY_ROLE: SenderRole[] = [...KNOWN_ROLES, "UNKNOWN"];

export type InboundMessage = {
  from: string;
  messageId: string;
  timestamp: string;
  body: string;
  messageType: "text" | "interactive";
  interactiveType?: "button_reply" | "list_reply";
};

/**
 * Capability names, one level below roles. Roles map onto these (below), and
 * intents require these rather than roles wherever the distinction matters —
 * so "STAFF may read a balance but not start a payment" is expressible without
 * a new branch anywhere.
 */
export const PERMISSIONS = {
  SELF_SERVICE: "self.service",
  BILLING_READ: "billing.read",
  PAYMENT_INITIATE: "payment.initiate",
  RESIDENT_SWITCH: "resident.switch",
  OWNER_CONSOLE: "owner.console",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<SenderRole, Permission[]> = {
  OWNER: [
    PERMISSIONS.SELF_SERVICE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.PAYMENT_INITIATE,
    PERMISSIONS.RESIDENT_SWITCH,
    PERMISSIONS.OWNER_CONSOLE,
  ],
  ADMIN: [
    PERMISSIONS.SELF_SERVICE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.PAYMENT_INITIATE,
    PERMISSIONS.RESIDENT_SWITCH,
    PERMISSIONS.OWNER_CONSOLE,
  ],
  TENANT: [
    PERMISSIONS.SELF_SERVICE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.PAYMENT_INITIATE,
    PERMISSIONS.RESIDENT_SWITCH,
  ],
  /**
   * A parent or guardian, recognised through `tenants.guardian_phone`. They
   * may read the money and start a payment — that is the entire reason the
   * channel exists for them — but they hold no `RESIDENT_SWITCH`, because the
   * mode that permission escaped no longer exists: which resident an action
   * is about now travels inside the interactive payload.
   *
   * Note what is *absent*. The guardian command surface is RENT, PAY, PLAN,
   * RECEIPT and HELP, and none of them reads a move-out request, a document,
   * or a KYC field. The scope decision ("money and stay basics, not the whole
   * tenancy") is enforced by the command set itself, not by copy discipline.
   * See [[Business-Rules]] § Guardian access.
   */
  GUARDIAN: [
    PERMISSIONS.SELF_SERVICE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.PAYMENT_INITIATE,
  ],
  // Inert until a staff record exists — deliberately read-only on money.
  STAFF: [PERMISSIONS.SELF_SERVICE, PERMISSIONS.BILLING_READ],
  UNKNOWN: [PERMISSIONS.SELF_SERVICE],
};

/** How a phone matched a tenant — the basis for `confidence`. */
export type ResidentMatch = "OWN_PHONE" | "GUARDIAN_PHONE" | "PROFILE_PHONE";

/**
 * A tenant this phone resolved to, carrying the context a handler would
 * otherwise re-query for. `hostelId` is non-null because `tenants.hostel_id`
 * is non-null in the schema — every tenant belongs to exactly one hostel.
 */
export type ResolvedResident = {
  tenantId: string;
  hostelId: string;
  name: string | null;
  status: string;
  matchedVia: ResidentMatch;
};

export type SenderIdentity = {
  phone: string;
  normalizedPhone: string;
  /**
   * The primary role, chosen by precedence when a phone holds several (an
   * owner who also rents a room resolves to OWNER). Permission checks use
   * `roles`/`permissions`, not this — this is for logging and copy.
   */
  role: SenderRole;
  /** Every role this phone holds. A permission check passes on any overlap. */
  roles: SenderRole[];
  /** Capabilities derived from `roles` — what the router actually enforces. */
  permissions: Permission[];

  ownerId: string | null;
  /**
   * Set only when the phone resolves to exactly one tenant. Ambiguous senders
   * (a guardian paying for two siblings) keep this null and use `residents`;
   * picking the first would be the "first hostel" bug in another costume.
   */
  tenantId: string | null;
  tenantIds: string[];
  /** Likewise: only when unambiguous. Never `residents[0].hostelId`. */
  hostelId: string | null;
  hostelIds: string[];
  /** Full resolved context, so handlers need not re-query for it. */
  residents: ResolvedResident[];
  /**
   * The subset of `residents` this phone reached as a *guardian* rather than
   * as the resident themselves. Non-empty means the guardian verification gate
   * applies before any financial answer — see `command-center/guardian-access`.
   */
  guardianResidents: ResolvedResident[];

  profileId: string | null;
  displayName: string | null;

  /**
   * 0..1 in how sure we are of the classification. A verified owner link is 1;
   * a tenant matched through a *guardian's* phone is lower, because the person
   * holding that handset is probably not the resident.
   */
  confidence: number;
  resolvedAt: string;
};

export type IntentSource =
  | "INTERACTIVE"
  | "SELECTION_STATE"
  | "KEYWORD"
  | "OWNER_ASSISTANT"
  | "LLM";

export type Intent = {
  /** Registry key. */
  name: string;
  source: IntentSource;
  /** 0..1. Ranking signal once several resolvers (or an LLM) propose candidates. */
  confidence: number;
  /** Extracted parameters — the slot bag an LLM resolver fills in. */
  slots?: Record<string, unknown>;
  /**
   * Provenance and anything a resolver wants to carry without it becoming a
   * handler input: which resolver produced this, the model and latency for an
   * LLM resolver, the raw classification, alternatives it considered. Handlers
   * must not need this — that is what keeps a model swap from touching them.
   */
  metadata?: {
    resolver?: string;
    model?: string;
    latencyMs?: number;
    reasoning?: string;
    alternatives?: Array<{ name: string; confidence: number }>;
    [key: string]: unknown;
  };
};

export type IntentResolutionInput = {
  message: InboundMessage;
  identity: SenderIdentity;
};

/**
 * Implement this to add a new way of understanding a message. An LLM resolver
 * is just one that awaits a model call and returns ranked intents with slots.
 */
export interface IntentResolver {
  readonly name: string;
  resolve(input: IntentResolutionInput): Promise<Intent[]>;
}

export type IntentHandlerContext = {
  message: InboundMessage;
  identity: SenderIdentity;
  intent: Intent;
};

/**
 * Returning `null` (or `{ handled: false }`) means "not mine after all" — the
 * router moves on to the next candidate intent rather than declaring success.
 * That is what lets the owner assistant decline a message and have the tenant
 * commands still get a shot at it.
 */
export type IntentHandler = (ctx: IntentHandlerContext) => Promise<unknown>;

export type IntentDefinition = {
  name: string;
  /** Human-readable purpose. Doubles as the tool description for an LLM resolver. */
  description: string;
  allowedRoles: SenderRole[];
  /** All of these must be held. Finer-grained than roles; both are enforced. */
  requiredPermissions?: Permission[];
  /**
   * Reject a low-confidence classification for consequential intents. An LLM
   * resolver that is 40% sure someone wants to pay should fall through to the
   * fallback, not send a payment link.
   */
  minConfidence?: number;
  handler: IntentHandler;
};

export type RouteStatus = "HANDLED" | "FALLBACK" | "DENIED" | "FAILED";

export type RouteOutcome = {
  status: RouteStatus;
  identity: SenderIdentity;
  /** The intent that actually ran (HANDLED), or was refused (DENIED). */
  intent: Intent | null;
  /** Every intent the resolvers proposed, in the order they were tried. */
  candidates: Intent[];
  result?: unknown;
  error?: string;
};

export function isHandled(result: unknown): boolean {
  if (result === null || result === undefined) return false;
  if (typeof result === "object" && "handled" in (result as any)) {
    return Boolean((result as any).handled);
  }
  return true;
}

export function permissionsForRoles(roles: SenderRole[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] || []) granted.add(permission);
  }
  return Array.from(granted);
}

export function hasPermission(identity: SenderIdentity, definition: IntentDefinition): boolean {
  if (!definition.allowedRoles.some((role) => identity.roles.includes(role))) return false;
  if (!definition.requiredPermissions?.length) return true;
  return definition.requiredPermissions.every((permission) => identity.permissions.includes(permission));
}

/** Separate from permission: "allowed to" vs "sure enough that they asked for it". */
export function meetsConfidenceFloor(intent: Intent, definition: IntentDefinition): boolean {
  if (definition.minConfidence === undefined) return true;
  return intent.confidence >= definition.minConfidence;
}
