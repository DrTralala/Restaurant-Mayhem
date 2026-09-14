import { describe, expect, it } from 'vitest';
import { selectSinkTransfer } from './sinkTransfers';

function stateFor(overrides = {}) {
  return {
    restaurant: { gameTime: 100 },
    staff: [{ id: 'j1', role: 'janitor', skill: 1, morale: 100, x: 200, y: 200, task: null }],
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

    expect(selectSinkTransfer(state, 'j1', 100)).toMatchObject({
      serviceItemId: 'a-dish', washStationId: 'machine', sourceWashStationId: 'sink',
    });
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

    expect(selectSinkTransfer(state, 'j1', 100)).toBeNull();
  });
});
