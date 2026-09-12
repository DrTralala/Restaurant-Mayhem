import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../state/initialState';
import { advanceCharacterMovementBatch, getCharacterMovementStatus } from '../movement';

describe('production navigation boundary', () => {
  it('creates the replacement coordinator for a new game and uses it in the public movement batch', () => {
    const state = createInitialState();
    expect(state.movementCoordinator.version).toBe(1);
    const worker = { id: 'test-worker', x: 400, y: 400, navigationGoal: { x: 460, y: 400 } };
    const result = advanceCharacterMovementBatch({ ...state, staff: [worker], customers: [], queueSlots: [] },
      [{ character: worker, speed: 60 }], 1 / 30);
    expect(result.coordinator.version).toBe(1);
    expect(result.moved.get(worker.id).x).toBeGreaterThan(400);
  });

  it('exposes moving and traffic-waiting states without making existing task consumers infer arrival', () => {
    const worker = { id: 'worker', x: 400, y: 400, navigationGoal: { x: 460, y: 400 } };
    const state = { staff: [worker], movementCoordinator: { version: 1,
      requests: new Map([['worker', { goal: worker.navigationGoal }]]), statuses: new Map() } };
    state.movementCoordinator.statuses.set('worker', { plan: 'moving', motion: 'traversing', reason: null });
    expect(getCharacterMovementStatus(state, 'worker')).toMatchObject({ plan: 'scheduled', motion: 'traversing' });
    state.movementCoordinator.statuses.set('worker', { plan: 'waiting', motion: 'holding', reason: 'traffic' });
    expect(getCharacterMovementStatus(state, 'worker')).toMatchObject({ plan: 'planning', motion: 'holding', reason: 'traffic' });
    expect(getCharacterMovementStatus(state, 'missing').plan).not.toBe('arrived');
  });
});
