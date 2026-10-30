import { describe, expect, it } from 'vitest';
import { getInterruptedPreparationTiming } from './preparationInterruption';

describe('getInterruptedPreparationTiming', () => {
  it.each([[20, 100], [120, 120], [undefined, 100], [NaN, 100]])(
    'pauses positive work without moving last progress %s backwards', (lastProgressAt, expected) => {
      const item = Object.freeze({ accumulatedWork: 12, lastProgressAt, preparationStartedAt: 10, readyAt: 200, assignedStaffId: 'cook' });
      const patch = getInterruptedPreparationTiming(item, 100);
      expect(patch).toEqual({ lastProgressAt: expected });
      expect({ ...item, ...patch }).toEqual({ ...item, lastProgressAt: expected });
      expect(item.lastProgressAt).toBe(lastProgressAt);
    });

  it.each([undefined, NaN, Infinity, '100'])('does not invent a pause time for invalid now %s', now => {
    expect(getInterruptedPreparationTiming(Object.freeze({ accumulatedWork: 12, lastProgressAt: 20 }), now)).toEqual({});
  });

  it.each([undefined, 0, -1, NaN, Infinity, '12'])('clears timing without positive finite work (%s)', accumulatedWork => {
    const item = Object.freeze({ accumulatedWork, preparationStartedAt: 10, readyAt: 20, lastProgressAt: 15 });
    expect(getInterruptedPreparationTiming(item, 100)).toEqual({ preparationStartedAt: null, readyAt: null, lastProgressAt: null });
    expect(item.preparationStartedAt).toBe(10);
  });
});
