import { describe, expect, it } from 'vitest';
import { getCharacterMovementStatus } from './status';

function stateFor(actor, requestGoal = actor.navigationGoal, status = null) {
  return {
    staff: [actor],
    customers: [],
    movementCoordinator: {
      requests: new Map(requestGoal ? [['a', { id: 'a', goal: requestGoal }]] : []),
      statuses: new Map(status ? [['a', status]] : []),
    },
  };
}

describe('character movement status', () => {
  it('returns a matching stored status', () => {
    const goal = { x: 40, y: 20 };
    expect(getCharacterMovementStatus(
      stateFor({ id: 'a', x: 0, y: 20, navigationGoal: goal }, goal, {
        plan: 'scheduled', motion: 'traversing',
      }), 'a',
    )).toEqual({ plan: 'scheduled', motion: 'traversing' });
  });

  it('derives arrived holding when no finite goal exists', () => {
    expect(getCharacterMovementStatus(stateFor({ id: 'a', x: 0, y: 20 }), 'a'))
      .toEqual({ plan: 'arrived', motion: 'holding' });
  });

  it('derives planning holding for a fresh or hydrated unarrived goal', () => {
    expect(getCharacterMovementStatus(stateFor({
      id: 'a', x: 0, y: 20, navigationGoal: { x: 40, y: 20 },
    }, null), 'a')).toEqual({ plan: 'planning', motion: 'holding' });
  });

  it('derives arrived holding within the two-pixel arrival tolerance', () => {
    expect(getCharacterMovementStatus(stateFor({
      id: 'a', x: 38, y: 20, navigationGoal: { x: 40, y: 20 },
    }, null), 'a')).toEqual({ plan: 'arrived', motion: 'holding' });
  });

  it('does not inherit arrived from a replaced goal', () => {
    expect(getCharacterMovementStatus(stateFor(
      { id: 'a', x: 40, y: 20, navigationGoal: { x: 80, y: 20 } },
      { x: 40, y: 20 },
      { plan: 'arrived', motion: 'holding' },
    ), 'a')).toEqual({ plan: 'planning', motion: 'holding' });
  });
});
