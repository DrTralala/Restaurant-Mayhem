import { describe, expect, it } from 'vitest';
import { ACTIVITY_DURATIONS } from './activity';
import { selectSinkTransfer } from './sinkTransfers';

function stateFor(overrides = {}) {
  return {
    restaurant: { gameTime: 100 },
    staff: [{ id: 'w1', role: 'waiter', skill: 1, morale: 100, x: 200, y: 200, task: null }],
    washStations: [
      { id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 },
      { id: 'machine', type: 'automatic', level: 10, x: 240, y: 200, w: 40, h: 40 },
    ],
    serviceItems: [],
    ...overrides,
  };
}

describe('manual sink transfer selection', () => {
  it('selects the greatest beneficial stable queued dish transfer', () => {
    const state = stateFor({
      serviceItems: [
        { id: 'z-dish', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 1 },
        { id: 'a-dish', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 1 },
      ],
    });

    const transfer = selectSinkTransfer(state, 'w1', 100);
    expect(transfer).toMatchObject({
      serviceItemId: 'a-dish', washStationId: 'machine', sourceWashStationId: 'sink',
    });
    expect(transfer.manualCompletionAt).toBeCloseTo(
      100 + 1 + 2 * (ACTIVITY_DURATIONS.manualWash / 1.5),
    );
    expect(selectSinkTransfer({
      ...state,
      staff: [{ ...state.staff[0], id: 'j1', role: 'janitor' }],
    }, 'j1', 100)).toBeNull();
  });

  it('excludes started or claimed manual work and non-beneficial machines', () => {
    const state = stateFor({
      washStations: [
        { id: 'sink', type: 'manual', x: 200, y: 200, w: 40, h: 40 },
        { id: 'slow', type: 'automatic', level: 1, x: 240, y: 200, w: 40, h: 40 },
      ],
      serviceItems: [
        { id: 'started', kind: 'dish', state: 'washing', washStationId: 'sink', washStartedAt: 90 },
        { id: 'claimed', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', assignedStaffId: 'j1' },
        { id: 'unstarted', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 1 },
      ],
    });

    expect(selectSinkTransfer(state, 'w1', 100)).toBeNull();
  });

  it('rejects a nominally faster machine when a fast manual wash has no backlog', () => {
    const state = stateFor({
      serviceItems: [{
        id: 'dish', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 1,
      }],
    });

    expect(selectSinkTransfer({
      ...state,
      washStations: [
        ...state.washStations.slice(0, 1),
        { id: 'machine', type: 'automatic', level: 10, x: 240, y: 200, w: 40, h: 40 },
      ],
    }, 'w1', 100)).toBeNull();
  });

  it('keeps a beneficial transfer when active manual work has a real remainder', () => {
    const state = stateFor({
      serviceItems: [
        {
          id: 'active', kind: 'dish', state: 'washing', washStationId: 'sink',
          accumulatedWork: 50, lastProgressAt: 90,
        },
        { id: 'candidate', kind: 'dish', state: 'queued_for_wash', washStationId: 'sink', washQueuedAt: 1 },
      ],
    });
    const transfer = selectSinkTransfer(state, 'w1', 100);
    const manualRate = 1.5;
    const activeRemainder = (ACTIVITY_DURATIONS.manualWash - 50 - 10 * manualRate) / manualRate;
    const candidateTime = ACTIVITY_DURATIONS.manualWash / manualRate;

    expect(transfer).toMatchObject({
      serviceItemId: 'candidate', washStationId: 'machine', sourceWashStationId: 'sink',
    });
    expect(transfer.manualCompletionAt).toBeCloseTo(
      100 + 1 + activeRemainder + candidateTime,
    );
  });
});
