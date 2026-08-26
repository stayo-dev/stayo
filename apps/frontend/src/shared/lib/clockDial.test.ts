import { describe, expect, it } from 'vitest';
import {
  angleForValue,
  faceLabel,
  parseClockValue,
  pointOnDial,
  readout,
  toClockValue,
  toStoredValue,
  valueFromPoint,
  formatTime,
} from './clockDial';

const CX = 100;
const CY = 100;

describe('the face', () => {
  it('puts twelve at the top and sweeps clockwise', () => {
    expect(angleForValue(0, 'hour')).toBe(-90);
    expect(angleForValue(3, 'hour')).toBe(0);
    expect(angleForValue(6, 'hour')).toBe(90);
    expect(angleForValue(9, 'hour')).toBe(180);
  });

  it('places a point where the hand should end', () => {
    const top = pointOnDial(angleForValue(0, 'hour'), 80, CX, CY);
    expect(Math.round(top.x)).toBe(100);
    expect(Math.round(top.y)).toBe(20);

    const three = pointOnDial(angleForValue(3, 'hour'), 80, CX, CY);
    expect(Math.round(three.x)).toBe(180);
    expect(Math.round(three.y)).toBe(100);
  });

  it('renders midnight as 12, not 0', () => {
    expect(faceLabel(0)).toBe(12);
    expect(faceLabel(7)).toBe(7);
  });
});

describe('pointing at the dial', () => {
  it('reads the hour under the finger', () => {
    expect(valueFromPoint(CX, CY - 80, CX, CY, 'hour')).toBe(0); // top → 12
    expect(valueFromPoint(CX + 80, CY, CX, CY, 'hour')).toBe(3);
    expect(valueFromPoint(CX, CY + 80, CX, CY, 'hour')).toBe(6);
    expect(valueFromPoint(CX - 80, CY, CX, CY, 'hour')).toBe(9);
  });

  // Demanding the finger stay on a thin ring makes a dial feel broken.
  it('ignores how far from the centre the finger is', () => {
    expect(valueFromPoint(CX + 20, CY, CX, CY, 'hour')).toBe(3);
    expect(valueFromPoint(CX + 200, CY, CX, CY, 'hour')).toBe(3);
  });

  // Nobody opens a mess at 7:23, and a dial fine enough to say so is too fiddly.
  it('snaps minutes to five', () => {
    expect(valueFromPoint(CX, CY - 80, CX, CY, 'minute')).toBe(0);
    expect(valueFromPoint(CX + 80, CY, CX, CY, 'minute')).toBe(15);
    expect(valueFromPoint(CX, CY + 80, CX, CY, 'minute')).toBe(30);
    expect(valueFromPoint(CX - 80, CY, CX, CY, 'minute')).toBe(45);
  });

  it('wraps at the top rather than going negative', () => {
    // A hair anticlockwise of twelve is still twelve — 14° from the top is not
    // eleven o'clock, and rounding it there would make the dial feel jumpy.
    expect(valueFromPoint(CX - 20, CY - 80, CX, CY, 'hour')).toBe(0);
    // A full hour anticlockwise is eleven, and must not come back as -1.
    const eleven = pointOnDial(angleForValue(11, 'hour'), 80, CX, CY);
    expect(valueFromPoint(eleven.x, eleven.y, CX, CY, 'hour')).toBe(11);
  });
});

describe('reading and writing the stored value', () => {
  it('parses a 24-hour value onto the face', () => {
    expect(parseClockValue('07:00')).toEqual({ hour: 7, minute: 0, meridiem: 'AM' });
    expect(parseClockValue('19:30')).toEqual({ hour: 7, minute: 30, meridiem: 'PM' });
    expect(parseClockValue('00:15')).toEqual({ hour: 0, minute: 15, meridiem: 'AM' });
    expect(parseClockValue('12:00')).toEqual({ hour: 0, minute: 0, meridiem: 'PM' });
  });

  it('falls back to a sensible hour rather than crashing on rubbish', () => {
    expect(parseClockValue(null)).toEqual({ hour: 9, minute: 0, meridiem: 'AM' });
    expect(parseClockValue('half seven')).toEqual({ hour: 9, minute: 0, meridiem: 'AM' });
  });

  it('round-trips through the face without drift', () => {
    for (const value of ['00:00', '07:30', '12:00', '12:45', '19:05', '23:55']) {
      expect(toStoredValue(parseClockValue(value))).toBe(value);
    }
  });

  it('handles the two that catch everyone: noon and midnight', () => {
    expect(toStoredValue({ hour: 0, minute: 0, meridiem: 'PM' })).toBe('12:00');
    expect(toStoredValue({ hour: 0, minute: 0, meridiem: 'AM' })).toBe('00:00');
  });

  it('pads, so 9:05 never reads as 9:5', () => {
    expect(toClockValue(9, 5)).toBe('09:05');
    expect(readout({ hour: 9, minute: 5, meridiem: 'AM' })).toBe('9:05');
  });
});

describe('one time on its own', () => {
  // formatSlot drops the meridiem from the start of a range when both ends
  // share it, so reusing it for a single button produced "7" with no AM —
  // exactly the ambiguity a clock exists to remove.
  it('always says AM or PM', () => {
    expect(formatTime('07:00')).toBe('7 AM');
    expect(formatTime('19:00')).toBe('7 PM');
    expect(formatTime('20:30')).toBe('8:30 PM');
  });

  it('handles noon and midnight', () => {
    expect(formatTime('12:00')).toBe('12 PM');
    expect(formatTime('00:00')).toBe('12 AM');
  });

  it('says nothing for an unset time', () => {
    expect(formatTime('')).toBe('');
    expect(formatTime(null)).toBe('');
  });
});
