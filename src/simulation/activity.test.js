import { describe, expect, it } from 'vitest';
import { ACTIVITY_DURATIONS, getRemainingFraction } from './activity';

describe('activity timing', () => {
  it('exports canonical durations', () => {
    expect(ACTIVITY_DURATIONS).toMatchObject({
      takeOrder: 60, prepareDrink: 120, consumeDrink: 180,
      consumeFood: 480, consumeBoth: 600, takePayment: 60,
      wipeFloor: 120, manualWash: 300, automaticWash: 600,
    });
  });

  it('calculates defensive remaining fractions', () => {
    expect(getRemainingFraction(130, 100, 60)).toBe(0.5);
    expect(getRemainingFraction(200, 100, 60)).toBe(0);
    expect(getRemainingFraction(100, null, 60)).toBeNull();
    expect(getRemainingFraction(100, 100, 0)).toBeNull();
  });
});
