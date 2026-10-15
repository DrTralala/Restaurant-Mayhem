import { describe, expect, it } from 'vitest';
import { getPatienceMax, getQueuePatience, getQueuePatienceMax } from './queuePatience';

describe('getQueuePatience', () => {
  it('returns a finite queuePatience, including zero and negatives', () => {
    expect(getQueuePatience({ queuePatience: 0, patience: 900 })).toBe(0);
    expect(getQueuePatience({ queuePatience: -5, patience: 900 })).toBe(-5);
    expect(getQueuePatience({ queuePatience: 42, patience: 900 })).toBe(42);
  });

  it('falls back to patience when queuePatience is undefined, NaN or infinite', () => {
    expect(getQueuePatience({ queuePatience: NaN, patience: 30 })).toBe(30);
    expect(getQueuePatience({ queuePatience: undefined, patience: 30 })).toBe(30);
    expect(getQueuePatience({ queuePatience: Infinity, patience: 30 })).toBe(30);
    expect(getQueuePatience({ queuePatience: -Infinity, patience: 30 })).toBe(30);
  });

  it('returns patience without coercing it, preserving the simulation coercion boundary', () => {
    expect(getQueuePatience({ patience: '30' })).toBe('30');
  });

  it('returns undefined when no field can be used', () => {
    expect(getQueuePatience({})).toBeUndefined();
  });
});

describe('getPatienceMax', () => {
  it('prioritises a finite positive patienceMax', () => {
    expect(getPatienceMax({ patienceMax: 200, archetype: 'regular', partySize: 2, patience: 50 })).toBe(200);
  });

  it('falls back past zero, negative, NaN and infinite patienceMax values', () => {
    expect(getPatienceMax({ patienceMax: 0, archetype: 'unknown', patience: 30 })).toBe(30);
    expect(getPatienceMax({ patienceMax: -10, archetype: 'unknown', patience: 30 })).toBe(30);
    expect(getPatienceMax({ patienceMax: NaN, archetype: 'unknown', patience: 30 })).toBe(30);
    expect(getPatienceMax({ patienceMax: Infinity, archetype: 'unknown', patience: 30 })).toBe(30);
  });

  it('falls back to archetype patience when patienceMax is unusable', () => {
    expect(getPatienceMax({ archetype: 'regular', partySize: 2 })).toBe(1125);
    expect(getPatienceMax({ patienceMax: 0, archetype: 'foodie', partySize: 1 })).toBe(1200);
  });

  it('falls back to patience for an unknown archetype', () => {
    expect(getPatienceMax({ archetype: 'unknown', patience: '30' })).toBe(30);
  });

  it('clamps the final fallback to zero when patience is missing, negative, NaN or non-numeric', () => {
    expect(getPatienceMax({ archetype: 'unknown', patience: -3 })).toBe(0);
    expect(getPatienceMax({ archetype: 'unknown', patience: NaN })).toBe(0);
    expect(getPatienceMax({ archetype: 'unknown' })).toBe(0);
    expect(getPatienceMax({ archetype: 'unknown', patience: 'abc' })).toBe(0);
  });
});

describe('getQueuePatienceMax', () => {
  it('prioritises a finite positive queuePatienceMax', () => {
    expect(getQueuePatienceMax({ queuePatienceMax: 100, patienceMax: 200 })).toBe(100);
  });

  it('falls back to getPatienceMax when queuePatienceMax is zero, negative, NaN or infinite', () => {
    expect(getQueuePatienceMax({ queuePatienceMax: 0, patienceMax: 200 })).toBe(200);
    expect(getQueuePatienceMax({ queuePatienceMax: -5, patienceMax: 200 })).toBe(200);
    expect(getQueuePatienceMax({ queuePatienceMax: NaN, patienceMax: 200 })).toBe(200);
    expect(getQueuePatienceMax({ queuePatienceMax: Infinity, patienceMax: 200 })).toBe(200);
  });

  it('applies the shared fallback chain', () => {
    expect(getQueuePatienceMax({ archetype: 'regular', partySize: 2 })).toBe(1125);
    expect(getQueuePatienceMax({ archetype: 'unknown', patience: '30' })).toBe(30);
    expect(getQueuePatienceMax({ archetype: 'unknown' })).toBe(0);
  });
});
