import { describe, expect, it } from 'vitest';
import { depositPreview, describeDeposit, summarizeRents } from './depositPolicy';

const input = (overrides: Partial<Parameters<typeof depositPreview>[0]> = {}) => ({
  enabled: true,
  mode: 'MONTHS_OF_RENT' as const,
  flatAmount: 0,
  months: 2,
  rents: [8000],
  autoFillRoomRent: true,
  ...overrides,
});

describe('summarizeRents', () => {
  it('ignores zero and non-finite rents rather than dragging the minimum to 0', () => {
    // Rooms with no rent set would otherwise make every range read "₹0 – ₹x".
    expect(summarizeRents([0, 8000, Number.NaN, 9000])).toEqual({
      count: 2,
      min: 8000,
      max: 9000,
      uniform: false,
    });
  });

  it('reports a single rent as uniform so one exact figure can be shown', () => {
    expect(summarizeRents([8000, 8000])).toEqual({ count: 2, min: 8000, max: 8000, uniform: true });
  });

  it('reports no usable rents when the hostel has none', () => {
    expect(summarizeRents([])).toEqual({ count: 0, min: 0, max: 0, uniform: false });
  });
});

describe('depositPreview — months of rent', () => {
  it('does the arithmetic the owner asked to see: ₹8,000 rent for 2 months is ₹16,000', () => {
    const preview = depositPreview(input());

    expect(preview.headline).toBe('₹16,000');
    expect(preview.detail).toBe('2 months × ₹8,000 rent = ₹16,000');
    expect(preview.warning).toBeUndefined();
  });

  it('says "1 month" rather than "1 months"', () => {
    expect(depositPreview(input({ months: 1 })).detail).toContain('1 month ×');
  });

  it('shows a range when rooms charge different rents', () => {
    const preview = depositPreview(input({ months: 2, rents: [6000, 9000, 7500] }));

    expect(preview.headline).toBe('₹12,000 – ₹18,000');
    expect(preview.detail).toContain('₹6,000–₹9,000');
    expect(preview.detail).toContain('3 rooms');
  });

  it('does not invent an amount when no room has a rent yet', () => {
    const preview = depositPreview(input({ rents: [] }));

    expect(preview.headline).toBe('2 months of rent');
    expect(preview.detail).toContain('Add rooms with rents');
    expect(preview.headline).not.toContain('₹');
  });

  it('warns that months-of-rent resolves to ₹0 when rent is not auto-filled', () => {
    // resolveTenantInviteDefaults uses `rent = auto_fill_room_rent ? base_rent : 0`,
    // so this combination silently collects nothing.
    const preview = depositPreview(input({ autoFillRoomRent: false }));

    expect(preview.headline).toBe('No deposit');
    expect(preview.warning).toContain('₹0');
    expect(preview.warning).toContain('auto-fill');
  });

  it('warns about auto-fill even when the rooms do have rents', () => {
    const preview = depositPreview(input({ autoFillRoomRent: false, rents: [8000, 9000] }));

    expect(preview.warning).toBeDefined();
    expect(preview.headline).not.toContain('16,000');
  });
});

describe('depositPreview — fixed amount', () => {
  it('states the flat amount and that rent does not affect it', () => {
    const preview = depositPreview(input({ mode: 'FLAT', flatAmount: 10000, rents: [8000] }));

    expect(preview.headline).toBe('₹10,000 at move-in');
    expect(preview.detail).toContain('whatever their room rent');
    expect(preview.warning).toBeUndefined();
  });

  it('ignores room rents entirely in flat mode', () => {
    const preview = depositPreview(input({ mode: 'FLAT', flatAmount: 10000, rents: [6000, 9000] }));

    expect(preview.headline).toBe('₹10,000 at move-in');
  });

  it('warns when the flat amount is still ₹0', () => {
    const preview = depositPreview(input({ mode: 'FLAT', flatAmount: 0 }));

    expect(preview.headline).toBe('No deposit');
    expect(preview.warning).toContain('₹0');
  });
});

describe('depositPreview — switched off', () => {
  it('says plainly that nothing is collected, in either mode', () => {
    for (const mode of ['FLAT', 'MONTHS_OF_RENT'] as const) {
      const preview = depositPreview(input({ enabled: false, mode, flatAmount: 5000 }));

      expect(preview.headline).toBe('No deposit');
      expect(preview.detail).toContain('without paying a deposit');
      expect(preview.warning).toBeUndefined();
    }
  });
});

describe('describeDeposit', () => {
  it('describes months mode without pretending to know the amount', () => {
    // The Finance row is hostel-wide, so it cannot show rupees for months mode:
    // the amount differs per room.
    expect(
      describeDeposit({ enabled: true, mode: 'MONTHS_OF_RENT', flatAmount: 0, months: 2, refundable: true }),
    ).toBe('2 months of rent · Refundable at move-out');
  });

  it('describes flat mode with the amount', () => {
    expect(
      describeDeposit({ enabled: true, mode: 'FLAT', flatAmount: 10000, months: 2, refundable: false }),
    ).toBe('₹10,000 · Non-refundable');
  });

  it('says "Not required" when off', () => {
    expect(
      describeDeposit({ enabled: false, mode: 'FLAT', flatAmount: 10000, months: 2, refundable: true }),
    ).toBe('Not required');
  });
});
