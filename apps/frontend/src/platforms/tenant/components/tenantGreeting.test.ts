import { describe, expect, it } from 'vitest';
import { greetingFor, greetingWithName } from './tenantGreeting';

const at = (hour: number) => new Date(2026, 7, 19, hour, 0, 0);

describe('greetingFor', () => {
  it('reads the time of day the way a person would', () => {
    expect(greetingFor(at(2))).toBe('Still up');
    expect(greetingFor(at(8))).toBe('Good morning');
    expect(greetingFor(at(14))).toBe('Good afternoon');
    expect(greetingFor(at(19))).toBe('Good evening');
    expect(greetingFor(at(22))).toBe('Good night');
  });

  it('switches on the boundary, not around it', () => {
    expect(greetingFor(at(11))).toBe('Good morning');
    expect(greetingFor(at(12))).toBe('Good afternoon');
    expect(greetingFor(at(16))).toBe('Good afternoon');
    expect(greetingFor(at(17))).toBe('Good evening');
  });
});

describe('greetingWithName', () => {
  it('uses the first name only', () => {
    expect(greetingWithName('Valurothu Sharan', at(8))).toBe('Good morning, Valurothu');
  });

  it('never greets an empty name', () => {
    expect(greetingWithName(null, at(8))).toBe('Good morning');
    expect(greetingWithName('   ', at(8))).toBe('Good morning');
  });
});
