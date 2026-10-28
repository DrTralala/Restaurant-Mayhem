import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { getRestaurantWorld } from './world';
import { prepareStaffHire } from './staffHiring';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function makeNoSafeHireState() {
  const state = createInitialState();
  const world = getRestaurantWorld(state.restaurant);
  const blockers = [];
  for (let y = Math.ceil(world.diningY / 20) * 20;
    y <= world.kitchenY + world.floorH; y += 20) {
    for (let x = Math.ceil(world.floorX / 20) * 20; x < world.doorX; x += 20) {
      blockers.push({ id: `blocked-hire-${x}-${y}`, x, y, state: 'idle' });
    }
  }
  return { ...state, customers: blockers };
}

describe('prepareStaffHire', () => {
  it('returns an invalid-candidate failure for an absent candidate or unknown role', () => {
    const state = createInitialState();

    expect(prepareStaffHire(state, null)).toEqual({ ok: false, reason: 'invalid-candidate' });
    expect(prepareStaffHire(state, { id: 'unknown-role', role: 'manager' }))
      .toEqual({ ok: false, reason: 'invalid-candidate' });
    expect(prepareStaffHire(state, { role: 'cook' }))
      .toEqual({ ok: false, reason: 'invalid-candidate' });
  });

  it('returns an unavailable-funds failure without changing the input state', () => {
    const state = createInitialState();
    state.restaurant.funds = 119;
    const beforeFunds = state.restaurant.funds;
    const beforeStaff = state.staff.map(worker => ({ ...worker }));

    expect(prepareStaffHire(state, { id: 'poor-hire', role: 'cook' }))
      .toEqual({ ok: false, reason: 'unavailable-funds' });
    expect(state.restaurant.funds).toBe(beforeFunds);
    expect(state.staff).toEqual(beforeStaff);
  });

  it.each([
    ['existing staff', state => { state.staff = [...state.staff, { id: 'occupied-id' }]; }],
    ['customer', state => { state.customers = [{ id: 'occupied-id' }]; }],
    ['queue member', state => { state.queue = [{ id: 'party-id', members: [{ id: 'occupied-id' }] }]; }],
    ['queue party fallback', state => { state.queue = [{ id: 'occupied-id' }]; }],
    ['queue departure', state => { state.queueDepartures = [{ id: 'occupied-id' }]; }],
  ])('rejects an identity already used by %s', (_label, addOccupant) => {
    const state = createInitialState();
    state.restaurant.funds = 500;
    addOccupant(state);

    expect(prepareStaffHire(state, { id: 'occupied-id', role: 'janitor' }))
      .toEqual({ ok: false, reason: 'duplicate-identity' });
  });

  it('returns no-safe-space when every candidate floor position is occupied', () => {
    const state = makeNoSafeHireState();
    state.restaurant.funds = 500;
    const beforeFunds = state.restaurant.funds;
    const beforeStaff = state.staff.map(worker => ({ ...worker }));

    expect(prepareStaffHire(state, { id: 'blocked-hire', role: 'waiter' }))
      .toEqual({ ok: false, reason: 'no-safe-space' });
    expect(state.restaurant.funds).toBe(beforeFunds);
    expect(state.staff).toEqual(beforeStaff);
  });

  it('uses canonical salary and safe allocated coordinates instead of candidate values', () => {
    const state = deepFreeze(createInitialState());
    const candidate = deepFreeze({
      id: 'candidate-with-forged-values',
      name: 'June',
      role: 'waiter',
      skill: 4,
      morale: 72,
      salary: 1,
      x: 99999,
      y: -99999,
    });

    const result = prepareStaffHire(state, candidate);

    expect(result.ok).toBe(true);
    expect(result.cost).toBe(150);
    expect(result.staff).toHaveLength(state.staff.length + 1);
    expect(result.staff.at(-1)).toMatchObject({ role: 'waiter', salary: 150 });
    expect(Number.isFinite(result.staff.at(-1).x)).toBe(true);
    expect(Number.isFinite(result.staff.at(-1).y)).toBe(true);
    expect(result.staff.at(-1)).not.toMatchObject({ x: 99999, y: -99999 });
  });

  it('resets duty, task and carried items on a successful hire without mutating inputs', () => {
    const state = deepFreeze(createInitialState());
    const candidate = deepFreeze({
      id: 'dirty-hire',
      name: 'June',
      role: 'janitor',
      skill: 1,
      morale: 80,
      salary: 0,
      schedule: Array.from({ length: 48 }, () => 'rest'),
      effectiveDuty: 'rest',
      dutyPhase: 'active',
      dutyTransitionRequestedAt: 22,
      task: { type: 'forged-task' },
      activityPhase: 'forged-phase',
      idleUntil: 23,
      carryingServiceItemId: 'legacy-item',
      carryingServiceItemIds: ['item-a', 'item-b'],
    });
    const stateBefore = JSON.stringify(state);
    const candidateBefore = JSON.stringify(candidate);

    const result = prepareStaffHire(state, candidate);

    expect(result.ok).toBe(true);
    expect(result.staff.at(-1)).toMatchObject({
      schedule: Array(48).fill('work'),
      effectiveDuty: 'work',
      dutyPhase: 'available',
      dutyTransitionRequestedAt: null,
      task: null,
      activityPhase: null,
      idleUntil: null,
      carryingServiceItemIds: [],
    });
    expect(result.staff.at(-1)).not.toHaveProperty('carryingServiceItemId');
    expect(JSON.stringify(state)).toBe(stateBefore);
    expect(JSON.stringify(candidate)).toBe(candidateBefore);
  });
});
