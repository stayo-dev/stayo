import { describe, expect, it } from 'vitest';
import { planRoomMove } from './roomMovePlan';

/**
 * Moving a tenant to another room is two different backend operations, and
 * which one applies is decided by the destination, not by the owner.
 *
 * `POST /api/allocations/shift` moves a bed inside one hostel.
 * `POST /api/tenants/transfer` moves the tenant between hostels — it closes the
 * old allocation, opens a new one, rewrites `tenants.hostel_id` and writes a
 * `tenant_transfer_logs` audit row. It explicitly **refuses** a same-hostel
 * move ("Use room shift instead of hostel transfer"), and a shift cannot cross
 * hostels, so sending either one the other's job is a guaranteed error.
 */

describe('planRoomMove', () => {
  it('shifts within the same hostel', () => {
    const plan = planRoomMove({ currentHostelId: 'h1', targetHostelId: 'h1' });
    expect(plan.kind).toBe('shift');
    expect(plan.crossHostel).toBe(false);
  });

  it('transfers when the target is a different hostel', () => {
    const plan = planRoomMove({ currentHostelId: 'h1', targetHostelId: 'h2' });
    expect(plan.kind).toBe('transfer');
    expect(plan.crossHostel).toBe(true);
  });

  it('warns what a hostel change does, because it is not just a bed move', () => {
    // The owner is rewriting which property the tenant belongs to. Past
    // charges stay with the old hostel forever; only future ones follow.
    const plan = planRoomMove({
      currentHostelId: 'h1',
      targetHostelId: 'h2',
      targetHostelName: 'Sri Krishna Girls Hostel',
    });
    expect(plan.consequence).toContain('Sri Krishna Girls Hostel');
    expect(plan.consequence).toMatch(/past charges|history/i);
  });

  it('says nothing extra for an ordinary room shift', () => {
    const plan = planRoomMove({ currentHostelId: 'h1', targetHostelId: 'h1' });
    expect(plan.consequence).toBeNull();
  });

  it('names the destination on the confirm button', () => {
    const plan = planRoomMove({
      currentHostelId: 'h1',
      targetHostelId: 'h1',
      targetRoomNo: '203',
    });
    expect(plan.confirmLabel).toBe('Move to Room 203');
  });

  it('says which hostel the confirm button is moving them to', () => {
    const plan = planRoomMove({
      currentHostelId: 'h1',
      targetHostelId: 'h2',
      targetRoomNo: '105',
      targetHostelName: 'Sri Krishna Girls Hostel',
    });
    expect(plan.confirmLabel).toBe('Move to Room 105 · Sri Krishna Girls Hostel');
  });

  it('asks for a room when none is chosen yet', () => {
    const plan = planRoomMove({ currentHostelId: 'h1', targetHostelId: 'h1' });
    expect(plan.confirmLabel).toBe('Pick a room');
  });

  it('treats an unknown current hostel as a transfer rather than assuming a shift', () => {
    // A shift sent across hostels fails; a transfer sent within one fails too.
    // With the current hostel unknown, the destructive-but-correct assumption
    // is that this is a transfer — it is the operation that can span both.
    const plan = planRoomMove({ currentHostelId: '', targetHostelId: 'h2' });
    expect(plan.kind).toBe('transfer');
  });

  it('cannot plan a move with no destination hostel', () => {
    const plan = planRoomMove({ currentHostelId: 'h1', targetHostelId: '' });
    expect(plan.kind).toBeNull();
    expect(plan.confirmLabel).toBe('Pick a room');
  });
});
