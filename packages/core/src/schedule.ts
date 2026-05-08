import { AgentError } from './agent';

/**
 * A wall-clock time of day in local time.
 */
export interface TimeOfDay {
  hours: number;
  minutes: number;
}

/**
 * Interval specification accepted by `agent.every()`.
 *
 * Either a positive number of milliseconds, or a string of the form
 * `<number><unit>` where unit is `ms`, `s`, `m`, or `h` (e.g. `"500ms"`,
 * `"2h"`).
 */
export type IntervalSpec = number | string;

/**
 * Options for `agent.at()`.
 */
export interface AtOptions {
  /**
   * If true, fire only on the next occurrence and then auto-remove.
   * @default false
   */
  once?: boolean;
  /**
   * Evaluation priority forwarded to the underlying trigger.
   */
  priority?: number;
  /**
   * Maximum number of times the trigger may fire before being auto-removed.
   */
  maxFires?: number;
}

/**
 * Options for `agent.every()`.
 */
export interface EveryOptions {
  /**
   * If true, fire on the next loop cycle in addition to the regular interval.
   * @default false
   */
  immediate?: boolean;
  /**
   * Evaluation priority forwarded to the underlying trigger.
   */
  priority?: number;
  /**
   * Maximum number of times the trigger may fire before being auto-removed.
   */
  maxFires?: number;
}

const TIME_24H_RE = /^([0-9]{1,2}):([0-9]{2})$/;
const TIME_12H_RE = /^([0-9]{1,2}):([0-9]{2})\s*([aApP])[mM]$/;

/**
 * Parse a wall-clock time-of-day string.
 *
 * Accepts `"HH:MM"` 24-hour notation (e.g. `"21:30"`) and `"H:MM(am|pm)"`
 * 12-hour notation (e.g. `"9:30pm"`, `"9:30 AM"`). 12:00am is midnight (0)
 * and 12:00pm is noon (12).
 *
 * @throws {AgentError} with code `INVALID_TIME` on malformed input.
 */
export function parseTimeOfDay(input: string): TimeOfDay {
  if (typeof input !== 'string' || input.length === 0) {
    throw new AgentError('Time must be a non-empty string', 'INVALID_TIME', { input });
  }
  const trimmed = input.trim();

  const m12 = TIME_12H_RE.exec(trimmed);
  if (m12) {
    const rawHour = Number(m12[1]);
    const minutes = Number(m12[2]);
    const isPm = (m12[3] as string).toLowerCase() === 'p';
    if (rawHour < 1 || rawHour > 12 || minutes < 0 || minutes > 59) {
      throw new AgentError(`Invalid 12-hour time "${input}"`, 'INVALID_TIME', { input });
    }
    const hours = rawHour === 12 ? (isPm ? 12 : 0) : isPm ? rawHour + 12 : rawHour;
    return { hours, minutes };
  }

  const m24 = TIME_24H_RE.exec(trimmed);
  if (m24) {
    const hours = Number(m24[1]);
    const minutes = Number(m24[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new AgentError(`Invalid 24-hour time "${input}"`, 'INVALID_TIME', { input });
    }
    return { hours, minutes };
  }

  throw new AgentError(`Could not parse time "${input}"`, 'INVALID_TIME', { input });
}

const INTERVAL_RE = /^(-?\d+(?:\.\d+)?)(ms|s|m|h)$/;

function unitToMs(unit: string): number {
  switch (unit) {
    case 'ms':
      return 1;
    case 's':
      return 1000;
    case 'm':
      return 60_000;
    case 'h':
      return 3_600_000;
    default:
      return Number.NaN;
  }
}

/**
 * Parse an interval value into milliseconds.
 *
 * Accepts a positive number (ms) or `"<number><unit>"` strings where unit is
 * `ms`, `s`, `m`, or `h`.
 *
 * @throws {AgentError} with code `INVALID_INTERVAL` on bad input or
 * non-positive values.
 */
export function parseInterval(input: IntervalSpec): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      throw new AgentError('Interval must be a positive finite number', 'INVALID_INTERVAL', {
        input,
      });
    }
    return input;
  }
  if (typeof input !== 'string' || input.length === 0) {
    throw new AgentError('Interval must be a non-empty string or number', 'INVALID_INTERVAL', {
      input,
    });
  }
  const match = INTERVAL_RE.exec(input.trim());
  if (!match) {
    throw new AgentError(`Could not parse interval "${input}"`, 'INVALID_INTERVAL', { input });
  }
  const value = Number(match[1]);
  const ms = value * unitToMs(match[2] as string);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new AgentError('Interval must be a positive duration', 'INVALID_INTERVAL', { input });
  }
  return ms;
}

/**
 * Compute the next `Date` in local time matching the given time-of-day.
 *
 * Returns the same calendar day if the target time is strictly later than
 * `from`; otherwise advances by one calendar day via `setDate(getDate() + 1)`
 * (DST-safe; uses local-time semantics).
 */
export function nextOccurrence(target: TimeOfDay, from: Date = new Date()): Date {
  const next = new Date(from);
  next.setHours(target.hours, target.minutes, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Milliseconds remaining until `target` from `from`, clamped to 0.
 */
export function msUntil(target: Date, from: Date = new Date()): number {
  return Math.max(0, target.getTime() - from.getTime());
}
