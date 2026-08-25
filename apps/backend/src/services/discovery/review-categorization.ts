import { REVIEW_CATEGORIES, type ReviewCategoryKey } from "./review-summary";

/**
 * Automatic topic + sentiment detection on a review's free-text comment.
 *
 * **Deterministic and heuristic, not a model call.** A keyword/phrase lexicon
 * per category, scanned sentence by sentence, scored against a small
 * positive/negative word list. This is intentionally the same shape as
 * `review-summary.ts`'s calculations: a pure function with no I/O, testable
 * directly, upgradeable to something smarter later without touching any
 * caller.
 *
 * **This module answers "what does the comment talk about", never "should it
 * be published".** Its output feeds `hostel_review_topics` for admin insight
 * only — `reviews-service.ts`'s moderation path (`moderate()`) never reads
 * it, and a negative sentiment here must never auto-reject a review. See
 * ADR-115.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type ReviewSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface DetectedTopic {
  category: ReviewCategoryKey;
  sentiment: ReviewSentiment;
  confidence: number;
}

/** One or more phrases whose presence marks a sentence as being about this category. */
const CATEGORY_KEYWORDS: Record<ReviewCategoryKey, RegExp> = {
  cleanliness: /\b(clean|cleanliness|dirty|dust|hygien\w*|spotless|filthy|stain\w*)\b/i,
  maintenance: /\b(maintenance|repair\w*|broken|leak\w*|fix\w*|plumb\w*|electric\w*|maintain\w*)\b/i,
  food: /\b(food|mess|meal\w*|breakfast|lunch|dinner|kitchen|menu|cook\w*|taste\w*)\b/i,
  room_comfort: /\b(room|bed|mattress|comfort\w*|spac\w*|furnitur\w*|cupboard|wardrobe)\b/i,
  amenities: /\b(amenit\w*|gym|laundry|parking|lounge|facilit\w*|common\s?area)\b/i,
  staff: /\b(staff|warden|management|manager|owner|caretaker|support|response\w*|helpful)\b/i,
  safety: /\b(safe\w*|security|secure\w*|cctv|guard|unsafe|theft)\b/i,
  wifi: /\b(wi-?fi|internet|network|connectivity|bandwidth)\b/i,
};

const POSITIVE_WORDS =
  /\b(good|great|excellent|amazing|awesome|clean|helpful|fast|quick|comfortable|nice|best|love\w*|superb|wonderful|smooth|responsive|spacious|friendly)\b/gi;

const NEGATIVE_WORDS =
  /\b(bad|slow|dirty|rude|broken|poor|terrible|never|worst|awful|horrible|unsafe|filthy|late|delay\w*|unresponsive|noisy|cramped|leak\w*)\b/gi;

/** Splits a comment into rough sentences/clauses for per-topic sentiment scoring. */
function splitClauses(body: string): string[] {
  return body
    .split(/(?<=[.!?\n])\s+|,\s*(?=but|although|however|while)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function scoreSentiment(clause: string): { sentiment: ReviewSentiment; hits: number } {
  const positiveHits = clause.match(POSITIVE_WORDS)?.length ?? 0;
  const negativeHits = clause.match(NEGATIVE_WORDS)?.length ?? 0;
  if (positiveHits === 0 && negativeHits === 0) return { sentiment: "NEUTRAL", hits: 0 };
  if (positiveHits === negativeHits) return { sentiment: "NEUTRAL", hits: positiveHits + negativeHits };
  return {
    sentiment: positiveHits > negativeHits ? "POSITIVE" : "NEGATIVE",
    hits: Math.max(positiveHits, negativeHits),
  };
}

/**
 * Detects which of the eight review categories a comment discusses, and the
 * sentiment of what it says about each — a comment can name several. A
 * category mentioned in more than one clause takes the strongest-confidence
 * reading, not an average, since one clear sentence about slow Wi-Fi says
 * more than two vague ones.
 */
export function detectTopics(body: string | null | undefined): DetectedTopic[] {
  if (!body || !body.trim()) return [];

  const found = new Map<ReviewCategoryKey, DetectedTopic>();
  for (const clause of splitClauses(body)) {
    const { sentiment, hits } = scoreSentiment(clause);
    for (const category of REVIEW_CATEGORIES) {
      if (!CATEGORY_KEYWORDS[category.key].test(clause)) continue;
      // Confidence scales with how many sentiment-bearing words backed the
      // reading; a bare topic mention with no sentiment words is a weak but
      // real signal, not a zero.
      const confidence = Math.min(1, 0.4 + hits * 0.2);
      const existing = found.get(category.key);
      if (!existing || confidence > existing.confidence) {
        found.set(category.key, { category: category.key, sentiment, confidence });
      }
    }
  }
  return Array.from(found.values());
}
