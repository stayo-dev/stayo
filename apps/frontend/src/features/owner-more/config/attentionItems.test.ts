import { describe, expect, it } from 'vitest';
import { attentionItems, MAX_ATTENTION_ROWS, type AttentionSource } from './attentionItems';

/**
 * These warnings used to sit on the owner's Profile, where they named gaps in
 * a *hostel* and linked to hostel screens carrying no hostel id — so a
 * two-hostel owner was told "GST number not added" with no way to tell which
 * hostel was meant, and the link resolved to whichever hostel happened to be
 * first. They now render on a hostel's own Settings tab, which knows exactly
 * which hostel it is.
 */
const hostel = (over: Partial<NonNullable<AttentionSource['hostel']>> = {}) => ({
  name: 'Sri Adithya Boys Hostel',
  phone: '+919000000000',
  address: '12 Main Road',
  gst_number: '29ABCDE1234F1Z5',
  ...over,
});

describe('attentionItems', () => {
  it('finds nothing to flag on a fully configured hostel', () => {
    expect(attentionItems({ hostelId: 'h1', hostel: hostel() })).toEqual([]);
  });

  it('flags an incomplete identity', () => {
    const items = attentionItems({ hostelId: 'h1', hostel: hostel({ address: null }) });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Hostel identity incomplete');
  });

  it('flags a missing GST number', () => {
    const items = attentionItems({ hostelId: 'h1', hostel: hostel({ gst_number: null }) });

    expect(items.map((i) => i.title)).toContain('GST number not added');
  });

  it('flags a late fee that is switched on but has no amount', () => {
    const items = attentionItems({
      hostelId: 'h1',
      hostel: hostel(),
      billing: { late_fee: { enabled: true, rules: [{ amount: 0 }] } },
    });

    expect(items.map((i) => i.title)).toContain('Late fee amount not set');
  });

  it('never flags a setting that is deliberately off', () => {
    // A switch an owner turned off on purpose is not a gap. Flagging it nags
    // them about their own decision.
    const items = attentionItems({
      hostelId: 'h1',
      hostel: hostel(),
      billing: { late_fee: { enabled: false, rules: [] } },
    });

    expect(items).toEqual([]);
  });

  it('carries the hostel id on every link it produces', () => {
    // The whole reason these moved. A warning that cannot say which hostel it
    // means, and links to a screen that then guesses, is worse than silence.
    const items = attentionItems({ hostelId: 'h9', hostel: hostel({ address: null, gst_number: null }) });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.route).toContain('hostelId=h9');
    }
  });

  it('caps the list rather than becoming a wall', () => {
    const items = attentionItems({
      hostelId: 'h1',
      hostel: hostel({ address: null, gst_number: null }),
      billing: { late_fee: { enabled: true, rules: [{ amount: 0 }] } },
    });

    expect(items).toHaveLength(MAX_ATTENTION_ROWS);
  });

  it('says nothing at all until the hostel has loaded', () => {
    expect(attentionItems({ hostelId: 'h1' })).toEqual([]);
    expect(attentionItems({ hostelId: null, hostel: hostel({ gst_number: null }) })).toEqual([]);
  });
});
