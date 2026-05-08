import { describe, it, expect } from 'vitest';
import { AgentError } from './agent';
import { parseTimeOfDay, parseInterval, nextOccurrence, msUntil } from './schedule';

describe('parseTimeOfDay', () => {
  it('parses 24-hour times', () => {
    expect(parseTimeOfDay('00:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeOfDay('09:05')).toEqual({ hours: 9, minutes: 5 });
    expect(parseTimeOfDay('21:30')).toEqual({ hours: 21, minutes: 30 });
    expect(parseTimeOfDay('23:59')).toEqual({ hours: 23, minutes: 59 });
  });

  it('parses 12-hour times with am/pm', () => {
    expect(parseTimeOfDay('9:30am')).toEqual({ hours: 9, minutes: 30 });
    expect(parseTimeOfDay('9:30AM')).toEqual({ hours: 9, minutes: 30 });
    expect(parseTimeOfDay('9:30 PM')).toEqual({ hours: 21, minutes: 30 });
    expect(parseTimeOfDay('1:05pm')).toEqual({ hours: 13, minutes: 5 });
  });

  it('handles 12am as midnight and 12pm as noon', () => {
    expect(parseTimeOfDay('12:00am')).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeOfDay('12:00pm')).toEqual({ hours: 12, minutes: 0 });
    expect(parseTimeOfDay('12:30am')).toEqual({ hours: 0, minutes: 30 });
    expect(parseTimeOfDay('12:30pm')).toEqual({ hours: 12, minutes: 30 });
  });

  it('throws AgentError on invalid input', () => {
    const cases = ['', '24:00', '9:60', '13:00pm', '0:00pm', 'abc', '9:30xm', '9-30', ':30'];
    for (const c of cases) {
      expect(() => parseTimeOfDay(c), `expected "${c}" to throw`).toThrow(AgentError);
    }
  });

  it('uses INVALID_TIME error code', () => {
    try {
      parseTimeOfDay('not-a-time');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError);
      expect((e as AgentError).code).toBe('INVALID_TIME');
    }
  });
});

describe('parseInterval', () => {
  it('accepts a positive number as milliseconds', () => {
    expect(parseInterval(1000)).toBe(1000);
    expect(parseInterval(1)).toBe(1);
  });

  it('parses string durations', () => {
    expect(parseInterval('500ms')).toBe(500);
    expect(parseInterval('45s')).toBe(45_000);
    expect(parseInterval('30m')).toBe(1_800_000);
    expect(parseInterval('2h')).toBe(7_200_000);
  });

  it('allows fractional values', () => {
    expect(parseInterval('1.5s')).toBe(1500);
  });

  it('throws AgentError on invalid input', () => {
    const cases: unknown[] = [0, -5, '', '-5s', '5', '5x', NaN, Infinity];
    for (const c of cases) {
      expect(() => parseInterval(c as never), `expected ${String(c)} to throw`).toThrow(AgentError);
    }
  });

  it('uses INVALID_INTERVAL error code', () => {
    try {
      parseInterval('nope');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentError);
      expect((e as AgentError).code).toBe('INVALID_INTERVAL');
    }
  });
});

describe('nextOccurrence', () => {
  it('returns same day when target is later than from', () => {
    const from = new Date(2025, 0, 15, 10, 0, 0, 0);
    const next = nextOccurrence({ hours: 21, minutes: 30 }, from);
    expect(next.getFullYear()).toBe(2025);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(21);
    expect(next.getMinutes()).toBe(30);
  });

  it('rolls to next day when target is earlier than from', () => {
    const from = new Date(2025, 0, 15, 22, 0, 0, 0);
    const next = nextOccurrence({ hours: 9, minutes: 0 }, from);
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it('rolls to next day when target equals from', () => {
    const from = new Date(2025, 0, 15, 9, 0, 0, 0);
    const next = nextOccurrence({ hours: 9, minutes: 0 }, from);
    expect(next.getDate()).toBe(16);
  });

  it('preserves wall-clock hour across a day boundary (DST-safe semantics)', () => {
    // Crossing midnight: ensures setDate(getDate()+1) is used rather than +24h
    const from = new Date(2025, 2, 9, 23, 30, 0, 0);
    const next = nextOccurrence({ hours: 21, minutes: 30 }, from);
    expect(next.getHours()).toBe(21);
    expect(next.getMinutes()).toBe(30);
  });
});

describe('msUntil', () => {
  it('returns the gap in ms', () => {
    const from = new Date(2025, 0, 15, 10, 0, 0, 0);
    const target = new Date(2025, 0, 15, 10, 0, 5, 0);
    expect(msUntil(target, from)).toBe(5000);
  });

  it('clamps negative gaps to 0', () => {
    const from = new Date(2025, 0, 15, 10, 0, 0, 0);
    const target = new Date(2025, 0, 15, 9, 0, 0, 0);
    expect(msUntil(target, from)).toBe(0);
  });
});
