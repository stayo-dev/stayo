import { Intent, IntentResolutionInput, IntentResolver } from "./types";
import { resolveCommand } from "../command-center/commands";
import { looksLikeOtp } from "../command-center/guardian-access";
import { decodePayload } from "../command-center/menu";
import { decodeMealPayload, decodeReadyPayload, parseTypedChoice } from "../providers/whatsapp/special-meal-template-contract";

/** Registry keys, so resolvers and the registry can't drift apart on strings. */
export const INTENTS = {
  /**
   * Everything a resident or guardian can ask for. One key, because the five
   * it replaces (BALANCE, DUES, PAY, STATUS, SWITCH) were never five separate
   * things — see `command-center/commands.ts`.
   */
  COMMAND_CENTER: "COMMAND_CENTER",
  /** A resident's special-meal answer (spec 2026-10-10). */
  MEAL_CHOICE: "MEAL_CHOICE",
  GUARDIAN_VERIFICATION: "GUARDIAN_VERIFICATION",
  INTERACTIVE_REPLY: "INTERACTIVE_REPLY",
  OWNER_ASSISTANT: "OWNER_ASSISTANT",
} as const;

/**
 * A special-meal answer: a tapped template button (`MEAL:` choice or
 * `MEALREADY:` on-my-way payload, both arriving as text) or a whole-message typed answer ("veg", "nv", "skip",
 * "I'm away"). First in the chain because its payloads are ours and exact. The
 * handler declines anything that is not an open serving for the sender's own
 * residency, so a guardian's "veg" falls through untouched.
 */
export const mealChoiceIntentResolver: IntentResolver = {
  name: "meal-choice",
  async resolve({ message }: IntentResolutionInput): Promise<Intent[]> {
    const body = message.body;
    if (!decodeMealPayload(body) && !decodeReadyPayload(body) && !parseTypedChoice(body)) return [];
    return [{ name: INTENTS.MEAL_CHOICE, source: "KEYWORD", confidence: 0.9, metadata: { resolver: "meal-choice" } }];
  },
};

/**
 * A button or list reply the user tapped — the highest-confidence signal there
 * is, since the payload was minted by a message we sent to this number.
 */
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
        metadata: { resolver: "interactive", commandCenter: Boolean(decodePayload(message.body)) },
      },
    ];
  },
};

/**
 * A bare six-digit code from a phone we recognise as somebody's guardian
 * contact. Ranked above the command vocabulary so a code is never mistaken for
 * anything else, and resolved only for guardians so a stray six-digit message
 * from a resident falls through to the normal path.
 */
export const guardianVerificationIntentResolver: IntentResolver = {
  name: "guardian-verification",
  async resolve({ message, identity }: IntentResolutionInput): Promise<Intent[]> {
    if (message.messageType !== "text") return [];
    if (!looksLikeOtp(message.body)) return [];
    if (identity.guardianResidents.length === 0) return [];
    return [
      {
        name: INTENTS.GUARDIAN_VERIFICATION,
        source: "KEYWORD",
        confidence: 0.95,
        metadata: { resolver: "guardian-verification" },
      },
    ];
  },
};

/**
 * A verified owner's messages go to the owner assistant first — it owns a much
 * richer command surface (menus, invites, briefings) than the resident
 * vocabulary. It may decline, in which case the router falls through to the
 * command center.
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

/**
 * The resident/guardian vocabulary. Tolerates retired words (`BAL`, `DUES`,
 * `STATUS`, `SWITCH`) so nobody who learned the old surface hits a wall, and
 * refuses to guess when two commands appear and neither leads — guessing wrong
 * on a money command is worse than asking.
 */
export const commandCenterIntentResolver: IntentResolver = {
  name: "command-center",
  async resolve({ message }: IntentResolutionInput): Promise<Intent[]> {
    const command = resolveCommand(message.body);
    if (!command) return [];
    return [
      {
        name: INTENTS.COMMAND_CENTER,
        source: "KEYWORD",
        confidence: 0.7,
        slots: { command },
        metadata: { resolver: "command-center" },
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

/**
 * The default chain: tapped buttons, then a guardian's verification code, then
 * owner paths, then the resident/guardian vocabulary.
 */
export const defaultIntentResolver = createCompositeIntentResolver([
  mealChoiceIntentResolver,
  interactiveIntentResolver,
  guardianVerificationIntentResolver,
  linkIntentResolver,
  ownerAssistantIntentResolver,
  commandCenterIntentResolver,
]);
