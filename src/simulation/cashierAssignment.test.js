import { describe, expect, it } from 'vitest';
import { prepareCashierAssignment } from './cashierAssignment';

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function makeState(overrides = {}) {
  return {
    restaurant: { gameTime: 0 },
    cashierStations: [
      { id: 'cashier1', x: 800, y: 120, w: 40, h: 40 },
      { id: 'cashier2', x: 600, y: 300, w: 40, h: 40 },
    ],
    staff: [
      { id: 'w1', name: 'Ada', role: 'waiter', task: null },
      { id: 'w2', name: 'Bea', role: 'waiter', task: null },
    ],
    customers: [],
    ...overrides,
  };
}

describe('prepareCashierAssignment', () => {
  it('assigns an eligible idle waiter without mutating frozen state or station fields', () => {
    const state = freezeDeep(makeState({
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, w: 40, h: 40, label: 'Front' },
        { id: 'cashier2', x: 600, y: 300, w: 40, h: 40, assignedStaffId: null },
      ],
    }));

    const result = prepareCashierAssignment(state, 'cashier1', 'w1');

    expect(result).toEqual({
      ok: true,
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, w: 40, h: 40, label: 'Front', assignedStaffId: 'w1' },
        { id: 'cashier2', x: 600, y: 300, w: 40, h: 40, assignedStaffId: null },
      ],
    });
    expect(result.cashierStations[1]).toBe(state.cashierStations[1]);
    expect(state.cashierStations[0]).not.toHaveProperty('assignedStaffId');
  });

  it('transfers a waiter from every source station while preserving unrelated fields', () => {
    const state = freezeDeep(makeState({
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, assignedStaffId: 'w1', label: 'A' },
        { id: 'cashier2', x: 600, y: 300, assignedStaffId: 'w2', label: 'B' },
        { id: 'cashier3', x: 400, y: 300, assignedStaffId: 'w1', label: 'C' },
      ],
    }));

    const result = prepareCashierAssignment(state, 'cashier2', 'w1');

    expect(result).toEqual({
      ok: true,
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, label: 'A' },
        { id: 'cashier2', x: 600, y: 300, label: 'B', assignedStaffId: 'w1' },
        { id: 'cashier3', x: 400, y: 300, label: 'C' },
      ],
    });
    expect(state.cashierStations[0].assignedStaffId).toBe('w1');
    expect(state.cashierStations[1].assignedStaffId).toBe('w2');
    expect(state.cashierStations[2].assignedStaffId).toBe('w1');
  });

  it('replaces an idle occupant and leaves that waiter available', () => {
    const state = makeState({
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, assignedStaffId: 'w2' },
        { id: 'cashier2', x: 600, y: 300 },
      ],
    });

    const result = prepareCashierAssignment(state, 'cashier1', 'w1');

    expect(result).toEqual({
      ok: true,
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, assignedStaffId: 'w1' },
        state.cashierStations[1],
      ],
    });
  });

  it('does not treat an ineligible current owner as an eligible re-assignment', () => {
    const state = makeState({
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, assignedStaffId: 'w1' },
      ],
      staff: [{ id: 'w1', role: 'waiter', task: { type: 'clean_table' } }],
    });

    expect(prepareCashierAssignment(state, 'cashier1', 'w1'))
      .toEqual({ ok: false, reason: 'waiter-unavailable' });
  });

  it('clears explicitly with null and preserves identity for already-clear or unchanged assignments', () => {
    const assigned = makeState({
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120, assignedStaffId: 'w1' },
        { id: 'cashier2', x: 600, y: 300 },
      ],
    });
    const cleared = prepareCashierAssignment(assigned, 'cashier1', null);
    const alreadyClear = makeState();

    expect(cleared).toEqual({
      ok: true,
      cashierStations: [
        { id: 'cashier1', x: 800, y: 120 },
        assigned.cashierStations[1],
      ],
    });
    expect(prepareCashierAssignment(alreadyClear, 'cashier1', null).cashierStations)
      .toBe(alreadyClear.cashierStations);
    expect(prepareCashierAssignment(assigned, 'cashier1', 'w1').cashierStations)
      .toBe(assigned.cashierStations);
  });

  it.each([
    ['missing staff selection', 'cashier1', undefined, 'invalid-staff-id'],
    ['empty staff identity', 'cashier1', '', 'invalid-staff-id'],
    ['whitespace-only staff identity', 'cashier1', '   ', 'invalid-staff-id'],
    ['non-finite staff identity', 'cashier1', Number.POSITIVE_INFINITY, 'invalid-staff-id'],
    ['unknown staff identity', 'cashier1', 'missing', 'staff-not-found'],
    ['strictly mismatched staff identity type', 'cashier1', '7', 'staff-not-found'],
    ['missing station selection', undefined, 'w1', 'invalid-station-id'],
    ['empty station identity', '', 'w1', 'invalid-station-id'],
    ['non-finite station identity', Number.NaN, 'w1', 'invalid-station-id'],
    ['unknown station identity', 'missing', 'w1', 'station-not-found'],
  ])('rejects %s', (_label, stationId, staffId, reason) => {
    const state = makeState({
      staff: [{ id: 7, role: 'waiter', task: null }],
    });

    expect(prepareCashierAssignment(state, stationId, staffId)).toEqual({ ok: false, reason });
  });

  it('rejects duplicate or missing cashier and selected staff identities', () => {
    const duplicateStations = makeState({
      cashierStations: [
        { id: 'cashier1' }, { id: 'cashier1' },
      ],
    });
    const missingStation = makeState({ cashierStations: [{ assignedStaffId: 'w1' }] });
    const duplicateStaff = makeState({
      staff: [
        { id: 'w1', role: 'waiter', task: null },
        { id: 'w1', role: 'waiter', task: null },
      ],
    });

    expect(prepareCashierAssignment(duplicateStations, 'cashier1', 'w1'))
      .toEqual({ ok: false, reason: 'invalid-station-identities' });
    expect(prepareCashierAssignment(missingStation, undefined, null))
      .toEqual({ ok: false, reason: 'invalid-station-identities' });
    expect(prepareCashierAssignment(duplicateStaff, 'cashier1', 'w1'))
      .toEqual({ ok: false, reason: 'duplicate-staff-id' });
  });

  it.each([
    ['a cook', { id: 'w1', role: 'cook', task: null }],
    ['a waiter with a task', { id: 'w1', role: 'waiter', task: { type: 'clean_table' } }],
    ['a carrying waiter', { id: 'w1', role: 'waiter', task: null, carryingServiceItemIds: ['item1'] }],
    ['a resting waiter', { id: 'w1', role: 'waiter', task: null, effectiveDuty: 'rest' }],
    ['a PTO waiter', { id: 'w1', role: 'waiter', task: null, effectiveDuty: 'pto' }],
    ['a schedule-ineligible waiter', { id: 'w1', role: 'waiter', task: null, schedule: Array(48).fill('rest') }],
  ])('rejects %s', (_label, worker) => {
    const state = makeState({ staff: [worker] });

    expect(prepareCashierAssignment(state, 'cashier1', 'w1'))
      .toEqual({ ok: false, reason: 'waiter-unavailable' });
  });

  it.each(['checkout_moving', 'checkout_processing', 'paying'])
  ('blocks a %s customer at the unstaffed target station', stateName => {
    const state = makeState({
      customers: [{ id: 'customer1', state: stateName, cashierStationId: 'cashier1' }],
    });

    expect(prepareCashierAssignment(state, 'cashier1', 'w1'))
      .toEqual({ ok: false, reason: 'station-busy' });
  });

  it.each(['checkout_moving', 'checkout_processing', 'paying'])
  ('blocks transfer away from a source with a %s customer', stateName => {
    const state = makeState({
      cashierStations: [
        { id: 'cashier1', assignedStaffId: 'w1' },
        { id: 'cashier2' },
      ],
      customers: [{ id: 'customer1', state: stateName, cashierStationId: 'cashier1' }],
    });

    expect(prepareCashierAssignment(state, 'cashier2', 'w1'))
      .toEqual({ ok: false, reason: 'station-busy' });
  });

  it.each(['target', 'source'])('blocks a take_payment task referencing the %s station', location => {
    const stationId = location === 'target' ? 'cashier2' : 'cashier1';
    const state = makeState({
      cashierStations: [
        { id: 'cashier1', ...(location === 'source' ? { assignedStaffId: 'w1' } : {}) },
        { id: 'cashier2' },
      ],
      staff: [
        { id: 'w1', role: 'waiter', task: null },
        { id: 'payer', role: 'waiter', task: { type: 'take_payment', stationId } },
      ],
    });

    expect(prepareCashierAssignment(state, 'cashier2', 'w1'))
      .toEqual({ ok: false, reason: 'station-busy' });
  });

  it('checks every source station holding the selected waiter before transferring', () => {
    const state = makeState({
      cashierStations: [
        { id: 'cashier1', assignedStaffId: 'w1' },
        { id: 'cashier2' },
        { id: 'cashier3', assignedStaffId: 'w1' },
      ],
      customers: [{ id: 'customer1', state: 'checkout_moving', cashierStationId: 'cashier3' }],
    });

    expect(prepareCashierAssignment(state, 'cashier2', 'w1'))
      .toEqual({ ok: false, reason: 'station-busy' });
  });
});
