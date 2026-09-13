import { describe, expect, it } from 'vitest';
import {
  advanceStaffTaskProgress,
  getStaffPerformanceMultiplier,
  getStaffTaskProgress,
  getStaffTaskRate,
} from './staffPerformance';

describe('staff performance', () => {
  it.each([
    [0, 0.5],
    [50, 1],
    [100, 1.5],
    [-20, 0.5],
    [140, 1.5],
    [NaN, 1],
    [Infinity, 1],
    [null, 1],
  ])('maps morale %s to a bounded work multiplier', (morale, expected) => {
    expect(getStaffPerformanceMultiplier({ morale })).toBe(expected);
  });

  it('advances accumulated work once and applies a morale change only to future time', () => {
    const first = advanceStaffTaskProgress(
      { startedAt: 0, accumulatedWork: 0, lastProgressAt: 0 },
      30,
      1.5,
    );
    const second = advanceStaffTaskProgress(first.task, 40, 0.5);
    const repeated = advanceStaffTaskProgress(second.task, 40, 1.5);

    expect(first.task).toMatchObject({ accumulatedWork: 45, lastProgressAt: 30 });
    expect(second.task).toMatchObject({ accumulatedWork: 50, lastProgressAt: 40 });
    expect(repeated.task).toEqual(second.task);
  });

  it('hydrates an old timestamp as legacy work before applying the new rate', () => {
    const result = advanceStaffTaskProgress({ startedAt: 10 }, 30, 0.5);

    expect(result.task).toMatchObject({ accumulatedWork: 20, lastProgressAt: 30 });
  });

  it('uses morale and cooking modifiers in one task rate', () => {
    const state = {
      dishes: [{ id: 'dish', prepTime: 120 }],
      kitchenStations: [{ id: 'station', equipmentId: 'oven' }],
      equipment: [{ id: 'oven', owned: true, speedMultiplier: 2 }],
      upgrades: [{ level: 1, effects: { type: 'globalSpeed', value: 0.25 } }],
    };
    const worker = {
      id: 'cook', role: 'cook', morale: 0,
      task: { type: 'prepare_dish', serviceItemId: 'item', stationId: 'station' },
    };

    expect(getStaffTaskRate(state, worker)).toBe(1.25);
  });

  it('reports the same accumulated-work progress used by simulation', () => {
    const state = {
      restaurant: { gameTime: 40 },
      staff: [],
    };
    const worker = {
      id: 'waiter', role: 'waiter', morale: 100,
      task: { type: 'take_order', startedAt: 0, accumulatedWork: 30, lastProgressAt: 30 },
    };

    expect(getStaffTaskProgress(state, worker)).toMatchObject({
      accumulatedWork: 45,
      duration: 60,
      remaining: 0.25,
    });
  });

  it('uses task progress when an item record has not yet been migrated', () => {
    const state = {
      restaurant: { gameTime: 40 },
      serviceItems: [{ id: 'drink', kind: 'drink', preparationStartedAt: 0 }],
    };
    const worker = {
      id: 'cook', role: 'cook', morale: 100,
      task: {
        type: 'prepare_drink', serviceItemId: 'drink',
        accumulatedWork: 30, lastProgressAt: 30,
      },
    };

    expect(getStaffTaskProgress(state, worker)).toMatchObject({
      accumulatedWork: 45,
      lastProgressAt: 40,
    });
  });
});
