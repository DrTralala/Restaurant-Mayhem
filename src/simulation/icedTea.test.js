import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { hydrateState, loadState, saveState } from '../state/persistence';
import { findPreparationTarget } from './preparationPosition';
import { resolveStaffAfterMovement, updateStaff } from './staff';
import { advanceStaffTaskProgress, getStaffTaskDuration, getStaffTaskProgress } from './staffPerformance';

function isolatedRunState(overrides = {}) {
  const initial = createInitialState();
  return {
    ...initial,
    restaurant: { ...initial.restaurant, gameTime: 0, openHour: 10, closeHour: 22 },
    tables: [],
    chairs: [],
    doors: [],
    cashierStations: [],
    kitchenStations: [],
    washStations: [],
    serviceTables: [],
    customers: [],
    queue: [],
    queueSlots: [],
    queueDepartures: [],
    serviceItems: [],
    cookingBatches: [],
    floorDirt: [],
    staffAmenities: [],
    staff: [],
    ...overrides,
  };
}

function preparingDrink({
  drinkId = 'iced-tea',
  gameTime = 0,
  morale = 50,
  preparationStartedAt = 0,
  accumulatedWork = 0,
  lastProgressAt = 0,
  hasLedger = true,
} = {}) {
  const base = isolatedRunState({
    kitchenStations: [{ id: 'dispenser', equipmentId: null, x: 100, y: 100 }],
    serviceTables: [{ id: 'st1', x: 300, y: 120 }],
    customers: [{ id: 'c1', state: 'waiting_for_items', tableId: 't1', drinkId }],
    serviceItems: [{
      id: 'drink', kind: 'drink', menuItemId: drinkId, customerId: 'c1', tableId: 't1',
      state: 'preparing', stationId: 'dispenser', serviceTableId: 'st1', serviceSlotIndex: 0,
      assignedStaffId: 'cook', preparationStartedAt,
      ...(hasLedger ? { accumulatedWork, lastProgressAt } : {}),
    }],
    staff: [{
      id: 'cook', role: 'cook', morale, x: 90, y: 110,
      task: {
        type: 'prepare_drink', serviceItemId: 'drink', stationId: 'dispenser',
        serviceTableId: 'st1', serviceSlotIndex: 0,
      },
    }],
  });
  return { ...base, restaurant: { ...base.restaurant, gameTime } };
}

function persistedIcedTeaState() {
  const fresh = createInitialState();
  const cook = fresh.staff.find(worker => worker.role === 'cook');
  const dispenser = fresh.kitchenStations.find(station => station.equipmentId == null);
  return {
    ...fresh,
    restaurant: { ...fresh.restaurant, gameTime: 100 },
    unlockedDrinkIds: ['water', 'iced-tea'],
    customers: [{
      id: 'iced-guest', state: 'waiting_for_items', tableId: 't1', dishId: null,
      drinkId: 'iced-tea', orderedServiceItemIds: ['iced-drink'], x: 190, y: 210,
    }],
    serviceItems: [{
      id: 'iced-drink', kind: 'drink', menuItemId: 'iced-tea', customerId: 'iced-guest',
      tableId: 't1', state: 'preparing', stationId: dispenser.id, serviceTableId: 'st1',
      serviceSlotIndex: 0, assignedStaffId: cook.id, preparationStartedAt: 55,
      accumulatedWork: 45, lastProgressAt: 100,
    }],
    staff: fresh.staff.map(worker => worker.id === cook.id
      ? {
        ...worker,
        morale: 50,
        task: {
          type: 'prepare_drink', serviceItemId: 'iced-drink', stationId: dispenser.id,
          serviceTableId: 'st1', serviceSlotIndex: 0,
        },
      }
      : worker),
  };
}

describe('Iced Tea shared preparation duration', () => {
  it('exposes 90 work for Iced Tea while the original five keep 120', () => {
    for (const drinkId of ['water', 'tea', 'soda', 'coffee', 'juice']) {
      const state = preparingDrink({ drinkId });
      expect(getStaffTaskDuration(state, state.staff[0])).toBe(120);
    }
    const icedTea = preparingDrink({ drinkId: 'iced-tea' });
    expect(getStaffTaskDuration(icedTea, icedTea.staff[0])).toBe(90);
  });

  it('falls back to 120 work for an unknown or missing drink item', () => {
    const unknown = preparingDrink({ drinkId: 'boba' });
    expect(getStaffTaskDuration(unknown, unknown.staff[0])).toBe(120);

    const missing = preparingDrink({ drinkId: 'iced-tea' });
    missing.serviceItems = [];
    expect(getStaffTaskDuration(missing, missing.staff[0])).toBe(120);
  });

  it.each([
    ['iced-tea', 89, 90],
    ['tea', 119, 120],
    ['water', 119, 120],
  ])('%s stays preparing at %s work and completes at %s', (drinkId, before, at) => {
    const waiting = resolveStaffAfterMovement(preparingDrink({ drinkId, gameTime: before }), 0);
    expect(waiting.serviceItems[0]).toMatchObject({ state: 'preparing', accumulatedWork: before });

    const completed = resolveStaffAfterMovement(preparingDrink({ drinkId, gameTime: at }), 0);
    expect(completed.serviceItems[0]).toMatchObject({ state: 'carried', assignedStaffId: 'cook' });
  });

  it('reports 0.5 progress at 45 of 90 and agrees with the real 90-work completion', () => {
    const state = preparingDrink({ drinkId: 'iced-tea', gameTime: 45 });
    expect(getStaffTaskProgress(state, state.staff[0])).toMatchObject({
      duration: 90, accumulatedWork: 45, progress: 0.5, remaining: 0.5, complete: false,
    });

    const completed = resolveStaffAfterMovement(
      preparingDrink({ drinkId: 'iced-tea', gameTime: 90 }), 0);
    expect(completed.serviceItems[0]).toMatchObject({ state: 'carried', assignedStaffId: 'cook' });
  });

  it('completes Iced Tea after 60 newly accrued seconds at morale 100', () => {
    const at59 = resolveStaffAfterMovement(
      preparingDrink({ drinkId: 'iced-tea', gameTime: 59, morale: 100 }), 0);
    expect(at59.serviceItems[0]).toMatchObject({ state: 'preparing', accumulatedWork: 88.5 });

    const at60 = resolveStaffAfterMovement(
      preparingDrink({ drinkId: 'iced-tea', gameTime: 60, morale: 100 }), 0);
    expect(at60.serviceItems[0].state).toBe('carried');
  });

  it('adopts a legacy preparation timestamp as work for Iced Tea once', () => {
    const state = preparingDrink({
      drinkId: 'iced-tea', gameTime: 30, preparationStartedAt: 10, hasLedger: false,
    });
    expect(getStaffTaskProgress(state, state.staff[0])).toMatchObject({
      duration: 90, accumulatedWork: 20,
    });
    expect(advanceStaffTaskProgress({ startedAt: 10 }, 30, 0.5)).toMatchObject({
      accumulatedWork: 20,
    });
  });

  it('preserves interrupted work without advancing while unassigned and resumes to the same boundary', () => {
    const state = preparingDrink({
      drinkId: 'iced-tea', gameTime: 45,
      accumulatedWork: 45, lastProgressAt: 45, preparationStartedAt: 0,
    });

    const interrupted = updateStaff({ ...state, kitchenStations: [] }, 0);
    expect(interrupted.serviceItems[0]).toMatchObject({
      state: 'ordered', stationId: null, serviceTableId: null, serviceSlotIndex: null,
      assignedStaffId: null, accumulatedWork: 45, lastProgressAt: 45,
    });

    const unassigned = updateStaff({
      ...interrupted, restaurant: { ...interrupted.restaurant, gameTime: 100 },
    }, 0);
    expect(unassigned.serviceItems[0]).toMatchObject({
      state: 'ordered', accumulatedWork: 45, lastProgressAt: 100,
    });

    const reassigned = updateStaff({
      ...unassigned,
      kitchenStations: [{ id: 'dispenser', equipmentId: null, x: 100, y: 100 }],
    }, 0);
    expect(reassigned.staff[0].task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'drink',
    });

    const resumed = resolveStaffAfterMovement(reassigned, 0);
    expect(resumed.serviceItems[0]).toMatchObject({
      state: 'preparing', accumulatedWork: 45, lastProgressAt: 100,
    });

    const at144 = resolveStaffAfterMovement({
      ...resumed, restaurant: { ...resumed.restaurant, gameTime: 144 },
    }, 0);
    expect(at144.serviceItems[0]).toMatchObject({ state: 'preparing', accumulatedWork: 89 });

    const at145 = resolveStaffAfterMovement({
      ...resumed, restaurant: { ...resumed.restaurant, gameTime: 145 },
    }, 0);
    expect(at145.serviceItems[0].state).toBe('carried');
  });

  it('round-trips active Iced Tea work through a synthetic save and finishes at the same boundary', () => {
    const saved = persistedIcedTeaState();
    expect(saveState(saved)).toBe(true);

    const restored = hydrateState(loadState(), createInitialState());
    expect(restored.unlockedDrinkIds).toEqual(['water', 'iced-tea']);

    const cook = restored.staff.find(worker => worker.role === 'cook');
    const item = restored.serviceItems.find(candidate => candidate.id === 'iced-drink');
    expect(cook.task).toMatchObject({
      type: 'prepare_drink', serviceItemId: 'iced-drink',
    });
    expect(item).toMatchObject({
      state: 'preparing', accumulatedWork: 45, lastProgressAt: 100,
    });
    expect(getStaffTaskDuration(restored, cook)).toBe(90);

    const station = restored.kitchenStations.find(candidate => candidate.id === item.stationId);
    const target = findPreparationTarget({ ...restored, staff: [cook] }, station, cook);
    expect(target).not.toBeNull();
    const { navigationGoal: _navigationGoal, ...arrivedCook } = cook;
    const placed = {
      ...restored,
      staff: restored.staff.map(worker => worker.id === cook.id
        ? { ...arrivedCook, x: target.goal.x, y: target.goal.y }
        : worker),
    };

    const at144 = resolveStaffAfterMovement({
      ...placed, restaurant: { ...placed.restaurant, gameTime: 144 },
    }, 0);
    expect(at144.serviceItems.find(candidate => candidate.id === item.id))
      .toMatchObject({ state: 'preparing', accumulatedWork: 89 });

    const at145 = resolveStaffAfterMovement({
      ...placed, restaurant: { ...placed.restaurant, gameTime: 145 },
    }, 0);
    expect(at145.serviceItems.find(candidate => candidate.id === item.id).state).toBe('carried');
  });
});
