import { describe, expect, it } from 'vitest';
import { createInitialState } from './initialState';
import { createMovementCoordinator } from '../simulation/movement';
import { SAVE_VERSION } from './saveVersion';
import { getFixtureRect, listFixtures } from '../data/fixtures';

function rectanglesOverlap(first, second) {
  return first.x < second.x + second.w
    && second.x < first.x + first.w
    && first.y < second.y + second.h
    && second.y < first.y + first.h;
}

describe('createInitialState', () => {
  it('uses ordinary four-seat tables without adding starter furniture', () => {
    const state = createInitialState();
    expect(state.tables.map(table => table.seats)).toEqual([4, 4, 4, 4]);
    expect(state.chairs).toHaveLength(12);
    expect(state.tables.map(({ x, y }) => [x, y])).toEqual([[200, 200], [360, 200], [200, 360], [360, 360]]);
  });

  it('starts the balanced economy with $600 and a $12 toast', () => {
    const state = createInitialState();

    expect(state.restaurant.funds).toBe(600);
    expect(state.dishes[0].price).toBe(12);
    expect(state.restaurant).toMatchObject({ openHour: 0, closeHour: 0 });
  });

  it('starts the current save version with an empty derived coordinator and wash station state', () => {
    const state = createInitialState();

    expect(state.version).toBe(SAVE_VERSION);
    expect(state.movementCoordinator).toEqual(createMovementCoordinator());
    expect(createInitialState().movementCoordinator).not.toBe(state.movementCoordinator);
    expect(state.floorDirt).toEqual([]);
    expect(state.washStations).toEqual([
      expect.objectContaining({ id: 'wash1', type: 'manual', w: 40, h: 40 }),
    ]);
    expect(state).not.toHaveProperty('staffSlots');
    expect(state.milestones.filter(milestone => ['m2', 'm6', 'm12'].includes(milestone.id)))
      .toEqual([
        expect.objectContaining({ id: 'm2', reward: { type: 'none' } }),
        expect.objectContaining({ id: 'm6', reward: { type: 'none' } }),
        expect.objectContaining({ id: 'm12', reward: { type: 'none' } }),
      ]);
    expect(state.staff.map(staff => staff.role)).toContain('janitor');
    expect(state.staff).toHaveLength(5);
    expect(state.unlockedDrinkIds).toEqual(['water']);
    expect(state.serviceItems).toEqual([]);
    expect(state.queueAdmissionGate).toBeNull();
    expect(state.staff.every(staff => Array.isArray(staff.carryingServiceItemIds)
      && staff.carryingServiceItemIds.length === 0)).toBe(true);
  });

  it('starts with empty staff amenities and independent complete duty defaults', () => {
    const state = createInitialState();
    const anotherState = createInitialState();

    expect(state.staffAmenities).toEqual([]);
    expect(state.staff.every(staff => staff.effectiveDuty === 'work'
      && staff.dutyPhase === 'available'
      && staff.amenityUse === null
      && staff.ptoSession === null
      && staff.wellRestedUntil === 0
      && staff.amenityWaitingSince === null
      && staff.lastRestActivityType === null
      && staff.schedule.length === 48
      && staff.schedule.every(mode => mode === 'work'))).toBe(true);
    expect(state.staff[0].schedule).not.toBe(state.staff[1].schedule);
    expect(state.staff[0].schedule).not.toBe(anotherState.staff[0].schedule);
  });

  it('gives starter staff distinct names', () => {
    const names = createInitialState().staff.map(staff => staff.name);

    expect(names).toEqual(['Marco', 'Sofia', 'Luca', 'Elena', 'Mia']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('assigns genders to starter staff', () => {
    expect(createInitialState().staff.map(staff => [staff.name, staff.gender])).toEqual([
      ['Marco', 'male'],
      ['Sofia', 'female'],
      ['Luca', 'male'],
      ['Elena', 'female'],
      ['Mia', 'female'],
    ]);
  });

  it('faces every starter chair towards its table', () => {
    const rotations = Object.fromEntries(
      createInitialState().chairs.map(chair => [chair.id, chair.rotation]),
    );

    expect(rotations).toEqual({
      ch1: 2, ch2: 0,
      ch3: 2, ch4: 0,
      ch5: 2, ch6: 0, ch7: 1, ch8: 3,
      ch9: 2, ch10: 0, ch11: 1, ch12: 3,
    });
  });

  it('starts with separate entrance and exit doors', () => {
    expect(createInitialState().doors.map(door => door.role).sort())
      .toEqual(['entrance', 'exit']);
    expect(createInitialState().doors).toEqual([
      { id: 'door1', y: 340, role: 'entrance' },
      { id: 'door2', y: 440, role: 'exit' },
    ]);
  });

  it('starts with one cook and three generic waiters', () => {
    const state = createInitialState();

    expect(state.version).toBe(SAVE_VERSION);
    expect(state.staff.map(staff => staff.role)).toEqual(['cook', 'waiter', 'waiter', 'waiter', 'janitor']);
    expect(state.cashierStations).toHaveLength(1);
    expect(state.cashierStations[0]).toMatchObject({ id: 'cashier1', x: 800, y: 120, w: 40, h: 40 });
    expect(state.staff.find(staff => staff.id === state.cashierStations[0].assignedStaffId))
      .toMatchObject({ role: 'waiter' });
    expect(state.staff.filter(staff => staff.role === 'host' || staff.role === 'cashier_waiter'))
      .toHaveLength(0);
  });

  it('keeps the starter empty kitchen station clear of the service counter and sink', () => {
    const state = createInitialState();
    const fixtures = listFixtures(state)
      .filter(fixture => ['k2', 'st1', 'wash1'].includes(fixture.id))
      .map(fixture => ({ ...fixture, rect: getFixtureRect(state, fixture) }));
    const k2 = state.kitchenStations.find(station => station.id === 'k2');
    const serviceTable = state.serviceTables.find(table => table.id === 'st1');
    const washStation = state.washStations.find(station => station.id === 'wash1');

    expect(k2).toMatchObject({ x: 360, y: 120 });
    expect(serviceTable).toMatchObject({ x: 140, y: 120 });
    expect(washStation).toMatchObject({ x: 300, y: 120 });
    expect(fixtures).toHaveLength(3);
    expect(fixtures.every(fixture => fixture.rect)).toBe(true);

    for (let firstIndex = 0; firstIndex < fixtures.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < fixtures.length; secondIndex += 1) {
        expect(rectanglesOverlap(fixtures[firstIndex].rect, fixtures[secondIndex].rect)).toBe(false);
      }
    }
  });
});
