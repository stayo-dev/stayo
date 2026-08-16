import { describe, it, expect } from 'vitest';
import { parseDetailParam, serializeDetail } from './drawerParam';

const UUID = '3f2fbde6-3b8f-48cb-969d-b32ea4fda42d';

describe('parseDetailParam', () => {
  it('parses a valid kind and id', () => {
    expect(parseDetailParam(`kyc:${UUID}`)).toEqual({ kind: 'kyc', id: UUID });
  });

  it('returns null for a missing param', () => {
    expect(parseDetailParam(null)).toBeNull();
    expect(parseDetailParam('')).toBeNull();
  });

  it('rejects an unknown kind rather than opening a blank drawer', () => {
    expect(parseDetailParam(`invoice:${UUID}`)).toBeNull();
  });

  it('rejects a malformed value', () => {
    expect(parseDetailParam('kyc')).toBeNull();
    expect(parseDetailParam('kyc:')).toBeNull();
    expect(parseDetailParam(`:${UUID}`)).toBeNull();
  });

  it('rejects extra segments rather than silently truncating them', () => {
    expect(parseDetailParam(`owner:${UUID}:extra`)).toBeNull();
  });
});

describe('serializeDetail', () => {
  it('round-trips through parse', () => {
    const target = { kind: 'listing' as const, id: UUID };
    expect(parseDetailParam(serializeDetail(target))).toEqual(target);
  });
});
