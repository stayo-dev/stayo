import { describe, it, expect } from 'vitest';
import {
  LEAD_QUESTIONS,
  EMPTY_ANSWERS,
  validateAnswer,
  canAdvance,
  isLastQuestion,
  conversationProgress,
  buildLeadPayload,
  type LeadAnswers,
} from './leadConversation';

const answers = (over: Partial<LeadAnswers> = {}): LeadAnswers => ({ ...EMPTY_ANSWERS, ...over });
const indexOf = (key: string) => LEAD_QUESTIONS.findIndex((q) => q.key === key);

describe('question set', () => {
  // Deliberately three. An earlier draft asked seven, which is a wall — every
  // extra screen is another place to give up, and only these three are things
  // an admin cannot act without.
  it('asks exactly three questions', () => {
    expect(LEAD_QUESTIONS).toHaveLength(3);
    expect(LEAD_QUESTIONS.map((q) => q.key).sort()).toEqual(['hostel_name', 'name', 'phone']);
  });

  it('opens with the hostel, the easiest thing to answer', () => {
    expect(LEAD_QUESTIONS[0].key).toBe('hostel_name');
  });

  it('asks for the phone number last, so an early exit costs the visitor nothing', () => {
    expect(indexOf('phone')).toBe(LEAD_QUESTIONS.length - 1);
  });

  it('never asks for an email — Google comes after the lead is saved', () => {
    expect(LEAD_QUESTIONS.some((q) => /email/i.test(q.key) || /email/i.test(q.prompt))).toBe(false);
  });
});

describe('validateAnswer', () => {
  it('blocks every empty answer, since all three are required', () => {
    LEAD_QUESTIONS.forEach((_q, i) => {
      expect(validateAnswer(i, answers())).not.toBeNull();
    });
  });

  it('rejects a one-character name or hostel', () => {
    expect(validateAnswer(indexOf('hostel_name'), answers({ hostel_name: 'A' }))).not.toBeNull();
    expect(validateAnswer(indexOf('name'), answers({ name: 'B' }))).not.toBeNull();
  });

  it('accepts a normal name and hostel', () => {
    expect(validateAnswer(indexOf('hostel_name'), answers({ hostel_name: 'Green Nest' }))).toBeNull();
    expect(validateAnswer(indexOf('name'), answers({ name: 'Shiva' }))).toBeNull();
  });

  // Being strict here rejects legitimate formats for no benefit — the OTP is
  // the real check.
  it('accepts real-world phone formats', () => {
    for (const phone of ['+91 90000 00000', '9000000000', '09000000000', '+919000000000']) {
      expect(validateAnswer(indexOf('phone'), answers({ phone }))).toBeNull();
    }
  });

  it('rejects a phone number that cannot be real', () => {
    expect(validateAnswer(indexOf('phone'), answers({ phone: '12345' }))).not.toBeNull();
    expect(validateAnswer(indexOf('phone'), answers({ phone: '1234567890123456789' }))).not.toBeNull();
  });

  it('canAdvance mirrors validateAnswer', () => {
    expect(canAdvance(indexOf('hostel_name'), answers())).toBe(false);
    expect(canAdvance(indexOf('hostel_name'), answers({ hostel_name: 'Green Nest' }))).toBe(true);
  });
});

describe('progress', () => {
  it('starts empty and fills as questions are answered', () => {
    expect(conversationProgress(0)).toBe(0);
    expect(conversationProgress(LEAD_QUESTIONS.length)).toBe(1);
    expect(conversationProgress(1)).toBeGreaterThan(0);
    expect(conversationProgress(1)).toBeLessThan(1);
  });

  it('identifies the final question', () => {
    expect(isLastQuestion(LEAD_QUESTIONS.length - 1)).toBe(true);
    expect(isLastQuestion(0)).toBe(false);
  });
});

describe('buildLeadPayload', () => {
  const full = answers({
    hostel_name: '  Green Nest  ',
    name: '  Shiva ',
    phone: ' +91 90000 00000 ',
  });

  it('trims and maps every answer onto the API shape', () => {
    expect(buildLeadPayload(full)).toEqual({
      name: 'Shiva',
      hostel_name: 'Green Nest',
      phone: '+91 90000 00000',
      google_email: undefined,
    });
  });

  // Regression: sending fields the Prisma client does not know about made
  // POST /leads/self-serve return 500. The payload must carry only what the
  // backend validator declares.
  it('sends only the four fields the endpoint accepts', () => {
    expect(Object.keys(buildLeadPayload(full)).sort()).toEqual([
      'google_email',
      'hostel_name',
      'name',
      'phone',
    ]);
  });

  it('carries a Google email through when one was captured', () => {
    expect(buildLeadPayload(full, 'a@b.com').google_email).toBe('a@b.com');
  });
});
