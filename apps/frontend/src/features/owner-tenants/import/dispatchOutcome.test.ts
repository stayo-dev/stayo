import { describe, expect, it } from 'vitest';
import {
  anyDispatched,
  describeSendState,
  invitationsWaiting,
  mergeSendResult,
  shouldSendMore,
  type SendResult,
} from './dispatchOutcome';
import type { DispatchChunk } from './api';

const chunk = (over: Partial<DispatchChunk> = {}): DispatchChunk => ({
  sent: 0,
  failed: 0,
  remaining: 0,
  errors: [],
  undelivered: [],
  ...over,
});

const miss = (id: string) => ({
  invitation_id: id,
  name: `Tenant ${id}`,
  phone: '+918008046952',
  reason: 'boom',
  activation_link: `https://yourstayo.com/activate/${id}`,
});

describe('what the Send screen says', () => {
  /**
   * The owner's case. "Every invitation has been sent" and no WhatsApp
   * arrived — because an empty queue only ever meant "attempted".
   */
  it('never says delivered when the message did not arrive', () => {
    const state = describeSendState({ waiting: 0, result: mergeSendResult(null, chunk({ undelivered: [miss('a')] })) });

    expect(state.title).not.toMatch(/delivered|sent/i);
    expect(state.title).toBe('1 tenant didn’t get the invitation');
    expect(state.detail).toMatch(/share their link yourself/i);
  });

  it('says delivered when it was', () => {
    const state = describeSendState({ waiting: 0, result: mergeSendResult(null, chunk({ sent: 3 })) });

    expect(state.title).toBe('Every invitation has been delivered');
  });

  it('gives both numbers for a mixed result', () => {
    const state = describeSendState({
      waiting: 0,
      result: mergeSendResult(null, chunk({ sent: 12, undelivered: [miss('a'), miss('b')] })),
    });

    expect(state.title).toBe('12 delivered · 2 tenants didn’t get it');
  });

  it('asks to send while invitations wait', () => {
    expect(describeSendState({ waiting: 4, result: null }).title).toBe('4 invitations are ready to send');
  });
});

describe('sending everything', () => {
  /** A WhatsApp outage must not strand everyone after the first slice. */
  it('keeps going when a whole slice failed to deliver', () => {
    expect(shouldSendMore(chunk({ remaining: 30, undelivered: [miss('a')] }), { attempts: 1 })).toBe(true);
  });

  it('stops when the queue is empty', () => {
    expect(shouldSendMore(chunk({ sent: 10, remaining: 0 }), { attempts: 1 })).toBe(false);
  });

  it('stops when a slice moved nothing, rather than spinning', () => {
    expect(shouldSendMore(chunk({ remaining: 5 }), { attempts: 1 })).toBe(false);
  });

  it('sends one wave only when asked for a wave', () => {
    expect(shouldSendMore(chunk({ sent: 10, remaining: 20 }), { limit: 10, attempts: 1 })).toBe(false);
  });

  it('gives up after enough attempts', () => {
    expect(shouldSendMore(chunk({ sent: 10, remaining: 20 }), { attempts: 50 })).toBe(false);
  });
});

describe('the running tally', () => {
  it('adds delivered counts across slices', () => {
    const result = mergeSendResult(mergeSendResult(null, chunk({ sent: 10 })), chunk({ sent: 4 }));
    expect(result.sent).toBe(14);
  });

  it('lists each undelivered tenant once', () => {
    const first = mergeSendResult(null, chunk({ undelivered: [miss('a')] }));
    const again = mergeSendResult(first, chunk({ undelivered: [miss('a'), miss('b')] }));

    expect(again.undelivered.map((u) => u.invitation_id)).toEqual(['a', 'b']);
  });
});

describe('keeping the Send step on screen', () => {
  const none: SendResult = { sent: 0, failed: 0, remaining: 0, undelivered: [] };

  /** Otherwise an all-undelivered result sent the owner away from the only list of who to chase. */
  it('stays when nothing was delivered but something was attempted', () => {
    expect(anyDispatched({ ...none, undelivered: [miss('a')] })).toBe(true);
  });

  it('is not shown before anything was sent', () => {
    expect(anyDispatched(null)).toBe(false);
  });

  it('counts waiting from the server once it has answered', () => {
    expect(invitationsWaiting(5, null)).toBe(5);
    expect(invitationsWaiting(5, { ...none, remaining: 2 })).toBe(2);
  });
});
