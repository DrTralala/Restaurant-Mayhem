import { describe, expect, it } from 'vitest';
import {
  clearNavigationGoal,
  isAtNavigationGoal,
  sameNavigationGoal,
  setNavigationGoal,
} from './navigationGoal';

describe('navigation goal helpers', () => {
  it('retains object identity when an exact goal is unchanged', () => {
    const actor = { id: 'a', x: 0, y: 0, navigationGoal: { x: 20, y: 40 } };

    expect(setNavigationGoal(actor, { x: 20, y: 40 })).toBe(actor);
  });

  it('copies a changed finite goal without mutating the actor or goal', () => {
    const actor = { id: 'a', x: 0, y: 0 };
    const goal = { x: 20, y: 40 };

    const changed = setNavigationGoal(actor, goal);

    expect(changed).not.toBe(actor);
    expect(changed.navigationGoal).toEqual(goal);
    expect(changed.navigationGoal).not.toBe(goal);
    expect(actor).toEqual({ id: 'a', x: 0, y: 0 });
  });

  it('clears only destination intent', () => {
    const actor = { id: 'a', task: { type: 'clean_floor' }, navigationGoal: { x: 20, y: 40 } };

    expect(clearNavigationGoal(actor)).toEqual({ id: 'a', task: { type: 'clean_floor' } });
    expect(actor.navigationGoal).toEqual({ x: 20, y: 40 });
  });

  it('retains identity when clearing an absent goal', () => {
    const actor = { id: 'a' };

    expect(clearNavigationGoal(actor)).toBe(actor);
  });

  it('rejects non-finite goals by clearing the existing destination', () => {
    const actor = { id: 'a', navigationGoal: { x: 20, y: 40 } };

    expect(setNavigationGoal(actor, { x: Number.NaN, y: 40 })).toEqual({ id: 'a' });
    expect(setNavigationGoal(actor, { x: 20, y: Infinity })).toEqual({ id: 'a' });
  });

  it('uses exact coordinate equality for goal identity', () => {
    expect(sameNavigationGoal({ x: 20, y: 40 }, { x: 20, y: 40 })).toBe(true);
    expect(sameNavigationGoal({ x: 20, y: 40 }, { x: 20.0000001, y: 40 })).toBe(false);
    expect(sameNavigationGoal({ x: Number.NaN, y: 40 }, { x: 20, y: 40 })).toBe(false);
  });

  it('uses the existing two-pixel tolerance only for arrival', () => {
    const actor = { x: 18, y: 20, navigationGoal: { x: 20, y: 20 } };

    expect(isAtNavigationGoal(actor)).toBe(true);
    expect(isAtNavigationGoal({ ...actor, x: 17.99 })).toBe(false);
    expect(isAtNavigationGoal({ ...actor, x: 18.1 }, 2.1)).toBe(true);
  });
});
