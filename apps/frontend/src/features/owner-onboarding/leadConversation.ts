/**
 * The short capture conversation shown before we ask for anything sensitive.
 *
 * Three questions, deliberately: hostel name, owner name, phone. An earlier
 * draft also asked city, bed count, biggest pain point and current tooling —
 * useful to sales, but seven screens is a wall, and every extra screen is
 * another place to give up. The only fields kept are the ones an admin cannot
 * act without.
 *
 * Order still matters: the hostel comes first because it is the easiest,
 * most flattering thing to answer, and the phone number comes last so an
 * early exit costs the visitor nothing. Google is offered only *after* the
 * lead row exists, so abandoning it still leaves us a lead.
 *
 * Pure by design: `apps/frontend` tests run in a node environment with no
 * jsdom, so all the step/validation logic lives here and the modal is a thin
 * renderer over it.
 */

export type LeadAnswers = {
  hostel_name: string;
  name: string;
  phone: string;
};

export const EMPTY_ANSWERS: LeadAnswers = {
  hostel_name: '',
  name: '',
  phone: '',
};

export type LeadQuestionKey = keyof LeadAnswers;

export type LeadQuestion = {
  key: LeadQuestionKey;
  /** Conversational prompt, second person. */
  prompt: string;
  /** Optional supporting line. */
  hint?: string;
  kind: 'text' | 'phone';
  placeholder?: string;
};

export const LEAD_QUESTIONS: LeadQuestion[] = [
  {
    key: 'hostel_name',
    prompt: "What's your hostel called?",
    kind: 'text',
    placeholder: 'e.g. Green Nest Hostel',
  },
  {
    key: 'name',
    prompt: 'And your name?',
    kind: 'text',
    placeholder: 'Your name',
  },
  {
    key: 'phone',
    prompt: "What's the best number to reach you on?",
    hint: "We'll send a quick code to confirm it's you.",
    kind: 'phone',
    placeholder: '+91 90000 00000',
  },
];

export const LEAD_QUESTION_COUNT = LEAD_QUESTIONS.length;

/** Validation error for the answer at `index`, or null if it may proceed. */
export function validateAnswer(index: number, answers: LeadAnswers): string | null {
  const question = LEAD_QUESTIONS[index];
  if (!question) return null;

  const value = String(answers[question.key] ?? '').trim();

  // All three are required — there is nothing left to make optional.
  if (!value) return 'This one we do need.';

  if (question.kind === 'text' && value.length < 2) {
    return 'That looks a little short.';
  }

  if (question.kind === 'phone') {
    // Deliberately loose: the OTP is the real check, and being strict here
    // rejects legitimate formats (spaces, +91, leading 0) for no benefit.
    const digits = value.replace(/\D/g, '');
    if (digits.length < 10) return 'That number looks too short.';
    if (digits.length > 15) return 'That number looks too long.';
  }

  return null;
}

export function canAdvance(index: number, answers: LeadAnswers): boolean {
  return validateAnswer(index, answers) === null;
}

/** True when this is the last question before we submit. */
export function isLastQuestion(index: number): boolean {
  return index === LEAD_QUESTIONS.length - 1;
}

/** 0..1, for the progress indicator. Counts questions answered, not steps seen. */
export function conversationProgress(index: number): number {
  if (LEAD_QUESTION_COUNT === 0) return 1;
  return Math.min(1, Math.max(0, index / LEAD_QUESTION_COUNT));
}

/** Maps answers onto the `POST /leads/self-serve` payload. */
export function buildLeadPayload(answers: LeadAnswers, googleEmail?: string) {
  return {
    name: String(answers.name ?? '').trim(),
    hostel_name: String(answers.hostel_name ?? '').trim(),
    phone: String(answers.phone ?? '').trim(),
    google_email: googleEmail || undefined,
  };
}
