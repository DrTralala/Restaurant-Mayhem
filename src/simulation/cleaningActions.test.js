import { describe, expect, it } from 'vitest';
import { resolveCleaningStart } from './cleaningActions';

function stateFor(task, worker = {}) {
  return {
    restaurant: { gameTime: 100 },
    staff: [{ id: 'j1', role: 'janitor', skill: 1, x: 200, y: 180, ...worker, task }],
    tables: [{ id: 't1', status: 'dirty', x: 200, y: 200 }],
    floorDirt: [{ id: 'd1', x: 200, y: 200 }],
    serviceItems: [{ id: 'dish-1', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink' }],
    washStations: [{ id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 }],
  };
}

describe('cleaning actions', () => {
  it.each([
    [1, 0.099, false],
    [1, 0.1, false],
    [10, 0.099, true],
    [10, 0.1, false],
  ])('resolves the instant decision once for skill %s at roll %s', (skill, roll, complete) => {
    const state = stateFor({ type: 'clean_floor', dirtId: 'd1' }, { skill });
    const started = resolveCleaningStart(state, 'j1', 'd1', 100, () => roll);
    const action = started.floorDirt[0].cleaningAction;

    expect(action).toMatchObject({
      id: 'd1', eligibleAt: 100, startedAt: 100,
      accumulatedWork: 0, lastProgressAt: 100,
      instantResolved: true, instantComplete: complete, staffId: 'j1',
    });
    expect(resolveCleaningStart(started, 'j1', 'd1', 101, () => 0.099))
      .toEqual(started);
  });

  it('uses the same target-owned action contract for manual dish washing', () => {
    const state = stateFor({ type: 'wash_item', serviceItemId: 'dish-1', washStationId: 'sink' });
    const started = resolveCleaningStart(state, 'j1', 'dish-1', 100, () => 0.5);

    expect(started.serviceItems[0].cleaningAction).toMatchObject({
      id: 'dish-1', startedAt: 100, lastProgressAt: 100,
      instantResolved: true, instantComplete: false, staffId: 'j1',
    });
  });

  it('does not start a target before arrival', () => {
    const state = stateFor(
      { type: 'clean_floor', dirtId: 'd1' },
      { navigationGoal: { x: 400, y: 400 } },
    );

    expect(resolveCleaningStart(state, 'j1', 'd1', 100, () => 0)).toBe(state);
  });
});
