import { getSelectionState } from "../whatsapp-selection-state";
import { Intent, IntentResolutionInput, IntentResolver } from "./types";

/** Registry keys, so resolvers and the registry can't drift apart on strings. */
export const INTENTS = {
  BALANCE: "BALANCE",
  DUES: "DUES",
  PAY: "PAY",
  STATUS: "STATUS",
  SWITCH: "SWITCH",
  HELP: "HELP",
  INTERACTIVE_REPLY: "INTERACTIVE_REPLY",
  CONTINUE_SELECTION: "CONTINUE_SELECTION",
  OWNER_ASSISTANT: "OWNER_ASSISTANT",
} as const;

const KEYWORD_TO_INTENT: Record<string, string> = {
  BAL: INTENTS.BALANCE,
  BALANCE: INTENTS.BALANCE,
  DUES: INTENTS.DUES,
  PAY: INTENTS.PAY,
  STATUS: INTENTS.STATUS,
  SWITCH: INTENTS.SWITCH,
  HELP: INTENTS.HELP,
};

/**
 * Map free text onto a command keyword, tolerating how people actually type.
 * Order: whole message → first word → the single known keyword anywhere in it.
 * The last step needs exactly one distinct match, so "should I pay or check
 * dues" stays ambiguous instead of being guessed; a message that *opens* with
 * a keyword honours it ("pay or dues?" → PAY).
 */
export function resolveCommandKey(body: string): string | null {
  const normalized = String(body || "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!normalized) return null;

  const known = new Set(Object.keys(KEYWORD_TO_INTENT));
  if (known.has(normalized)) return normalized;

  const tokens = normalized
    .split(" ")
    .map((token) => token.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  if (known.has(tokens[0])) return tokens[0];

  const matched = Array.from(new Set(tokens.filter((token) => known.has(token))));
  return matched.length === 1 ? matched[0] : null;
}

/** A button or list reply the user tapped — the highest-confidence signal there is. */
export const interactiveIntentResolver: IntentResolver = {
  name: "interactive",
  async resolve({ message }: IntentResolutionInput): Promise<Intent[]> {
    if (message.messageType !== "interactive") return [];
    return [
      {
        name: INTENTS.INTERACTIVE_REPLY,
        source: "INTERACTIVE",
        confidence: 1,
        slots: { payloadId: message.body, interactiveType: message.interactiveType },
        metadata: { resolver: "interactive" },
      },
    ];
  },
};

/** The message is an answer to a prompt we sent (e.g. "which resident?"). */
export const selectionStateIntentResolver: IntentResolver = {
  name: "selection-state",
  async resolve({ message }: IntentResolutionInput): Promise<Intent[]> {
    const state = await getSelectionState(message.from);
    if (!state || state.action !== "BALANCE_SELECTION") return [];
    return [
      {
        name: INTENTS.CONTINUE_SELECTION,
        source: "SELECTION_STATE",
        confidence: 0.9,
        slots: { state },
        metadata: { resolver: "selection-state" },
      },
    ];
  },
};

/**
 * A verified owner's messages go to the owner assistant first — it owns a much
 * richer command surface (menus, invites, briefings) than the tenant keywords.
 * It may decline, in which case the router falls through to the keyword intent.
 */
export const ownerAssistantIntentResolver: IntentResolver = {
  name: "owner-assistant",
  async resolve({ identity }: IntentResolutionInput): Promise<Intent[]> {
    if (!identity.roles.includes("OWNER")) return [];
    return [
      {
        name: INTENTS.OWNER_ASSISTANT,
        source: "OWNER_ASSISTANT",
        confidence: 0.8,
        metadata: { resolver: "owner-assistant", ownerId: identity.ownerId },
      },
    ];
  },
};

/**
 * The LINK command has to reach the owner assistant from a phone we do *not*
 * recognise — that is how an owner links their number in the first place. It is
 * therefore resolved for everyone and permitted for everyone; the assistant
 * itself validates the code.
 */
export const linkIntentResolver: IntentResolver = {
  name: "link",
  async resolve({ message, identity }: IntentResolutionInput): Promise<Intent[]> {
    const firstWord = String(message.body || "").trim().split(/\s+/)[0]?.toUpperCase();
    if (firstWord !== "LINK") return [];
    if (identity.roles.includes("OWNER")) return []; // already covered by the owner resolver
    return [
      {
        name: INTENTS.OWNER_ASSISTANT,
        source: "OWNER_ASSISTANT",
        confidence: 0.95,
        metadata: { resolver: "link" },
      },
    ];
  },
};

export const keywordIntentResolver: IntentResolver = {
  name: "keyword",
  async resolve({ message }: IntentResolutionInput): Promise<Intent[]> {
    const key = resolveCommandKey(message.body);
    if (!key) return [];
    return [
      {
        name: KEYWORD_TO_INTENT[key],
        source: "KEYWORD",
        confidence: 0.7,
        slots: { keyword: key },
        metadata: { resolver: "keyword" },
      },
    ];
  },
};

/**
 * Runs resolvers in order and concatenates their candidates, dropping repeats.
 * An LLM resolver is appended here — last, so deterministic signals keep
 * priority and the model only speaks when nothing else understood the message.
 */
export function createCompositeIntentResolver(resolvers: IntentResolver[]): IntentResolver {
  return {
    name: "composite",
    async resolve(input: IntentResolutionInput): Promise<Intent[]> {
      const candidates: Intent[] = [];
      const seen = new Set<string>();

      for (const resolver of resolvers) {
        const resolved = await resolver.resolve(input);
        for (const intent of resolved) {
          if (seen.has(intent.name)) continue;
          seen.add(intent.name);
          candidates.push(intent);
        }
      }

      return candidates;
    },
  };
}

/** The default chain: tapped buttons, then pending prompts, then owner, then keywords. */
export const defaultIntentResolver = createCompositeIntentResolver([
  interactiveIntentResolver,
  selectionStateIntentResolver,
  linkIntentResolver,
  ownerAssistantIntentResolver,
  keywordIntentResolver,
]);
