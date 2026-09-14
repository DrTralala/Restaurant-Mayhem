import { describe, expect, it } from 'vitest';
import {
  copyFixtures,
  getFixtureCopyEligibility,
} from './fixtureCopies';

function makeState(overrides = {}) {
  return {
    restaurant: { expansionLevel: 1, funds: 10000 },
    tables: [{
      id: 't1', seats: 2, status: 'occupied', x: 200, y: 200,
      diningPartyId: 'party-1', diningCustomerIds: ['customer-1'],
      seatingAssignments: [{ customerId: 'customer-1', chairId: 'ch1' }],
      reservationOwnerStaffId: 'host',
    }],
    chairs: [
      { id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 },
      { id: 'ch2', tableId: 't1', x: 210, y: 240, rotation: 0 },
    ],
    doors: [
      { id: 'door1', y: 340, role: 'entrance' },
      { id: 'door2', y: 440, role: 'exit' },
    ],
    serviceTables: [{ id: 'st1', x: 140, y: 120, rotation: 1 }],
    cashierStations: [{
      id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'waiter-1',
    }],
    kitchenStations: [],
    washStations: [{
      id: 'wash1', type: 'automatic', x: 300, y: 120, w: 40, h: 40,
    }],
    staffAmenities: [],
    staff: [{ id: 'waiter-1', role: 'waiter' }],
    customers: [{ id: 'customer-1', state: 'eating', tableId: 't1', chairId: 'ch1' }],
    serviceItems: [
      { id: 'on-counter', state: 'on_service', serviceTableId: 'st1' },
      { id: 'in-washer', state: 'washing', washStationId: 'wash1' },
    ],
    movementCoordinator: {
      version: 1,
      requests: new Map([['customer-1', { id: 'customer-1' }]]),
      statuses: new Map([['customer-1', { plan: 'moving' }]]),
      claims: new Map([['customer-1', { x: 220, y: 190 }]]),
      records: new Map([['customer-1', { goal: { x: 300, y: 300 } }]]),
      plans: new Map([['customer-1', [{ from: { x: 220, y: 190 } }]]]),
      diagnostics: { waiting: new Map([['customer-1', 1]]) },
    },
    ...overrides,
  };
}

describe('fixture copy eligibility', () => {
  it('prices supported fixtures from the catalogue and expands a selected table once', () => {
    const result = getFixtureCopyEligibility(makeState(), [
      { type: 'table', id: 't1' },
      { type: 'chair', id: 'ch1' },
      { type: 'door', id: 'door1' },
      { type: 'serviceTable', id: 'st1' },
      { type: 'cashierTable', id: 'cashier1' },
      { type: 'washStation', id: 'wash1' },
    ]);

    expect(result).toMatchObject({ valid: true, price: 3400, totalPrice: 3400 });
    expect(result.items).toEqual([
      { type: 'table', id: 't1' },
      { type: 'chair', id: 'ch1' },
      { type: 'chair', id: 'ch2' },
      { type: 'door', id: 'door1' },
      { type: 'serviceTable', id: 'st1' },
      { type: 'cashierTable', id: 'cashier1' },
      { type: 'washStation', id: 'wash1' },
    ]);
  });

  it.each([
    ['unique-equipment', { kitchenStations: [{ id: 'k1', equipmentId: 'oven', x: 100, y: 120 }] }, { type: 'kitchenStation', id: 'k1' }],
    ['unpriced-kitchen-station', { kitchenStations: [{ id: 'k1', equipmentId: null, x: 100, y: 120 }] }, { type: 'kitchenStation', id: 'k1' }],
    ['unpriced-manual-sink', { washStations: [{ id: 'sink', type: 'manual', x: 300, y: 120 }] }, { type: 'washStation', id: 'sink' }],
  ])('rejects the whole selection for %s', (reason, overrides, unsupported) => {
    const state = makeState(overrides);
    const result = getFixtureCopyEligibility(state, [{ type: 'table', id: 't1' }, unsupported]);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.message).toEqual(expect.stringContaining('cannot be copied'));
  });

  it('rejects a stale source before considering its destination', () => {
    expect(getFixtureCopyEligibility(makeState(), [{ type: 'table', id: 'gone' }])).toMatchObject({
      valid: false, reason: 'missing-fixture',
    });
  });

  it('reports an unknown fixture type separately from a stale source', () => {
    expect(getFixtureCopyEligibility(makeState(), [{ type: 'mystery', id: 'm1' }])).toMatchObject({
      valid: false, reason: 'unknown-fixture-type',
    });
  });
});

describe('copyFixtures', () => {
  it('clones a table and linked chairs with fresh IDs, relative positions, and pristine runtime state', () => {
    const state = makeState({ restaurant: { expansionLevel: 1, funds: 700 } });
    const result = copyFixtures(state, [{ type: 'table', id: 't1', x: 600, y: 300 }]);

    expect(result).not.toBe(state);
    expect(result.restaurant.funds).toBe(300);
    expect(result.tables).toHaveLength(2);
    expect(result.tables[1]).toEqual({
      id: 't2', seats: 2, status: 'empty', x: 600, y: 300,
    });
    expect(result.chairs.slice(-2)).toEqual([
      { id: 'ch3', tableId: 't2', x: 610, y: 280, rotation: 2 },
      { id: 'ch4', tableId: 't2', x: 610, y: 340, rotation: 0 },
    ]);
    expect(result.tables[0]).toBe(state.tables[0]);
    expect(result.chairs.slice(0, 2)).toEqual(state.chairs);
    expect(result.tables[1]).not.toHaveProperty('diningPartyId');
    expect(result.tables[1]).not.toHaveProperty('seatingAssignments');
    expect(result.customers).toBe(state.customers);
    expect(result.serviceItems).toBe(state.serviceItems);
  });

  it('copies rotation, door roles, dimensions, and leaves runtime assignments behind', () => {
    const state = makeState({
      restaurant: { expansionLevel: 1, funds: 5000 },
      tables: [],
      chairs: [],
      doors: [{ id: 'door1', y: 340, role: 'exit' }],
      serviceTables: [{ id: 'st1', x: 140, y: 120, rotation: 1 }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'w1' }],
      washStations: [{ id: 'wash1', type: 'automatic', x: 300, y: 120, w: 60, h: 20 }],
      staff: [{ id: 'w1', role: 'waiter' }],
      serviceItems: [{ id: 'dirty', state: 'washing', washStationId: 'wash1' }],
    });
    const result = copyFixtures(state, [
      { type: 'door', id: 'door1', x: 907, y: 80 },
      { type: 'serviceTable', id: 'st1', x: 500, y: 120 },
      { type: 'cashierTable', id: 'cashier1', x: 600, y: 300 },
      { type: 'washStation', id: 'wash1', x: 500, y: 260 },
    ]);

    expect(result.restaurant.funds).toBe(2000);
    expect(result.doors[1]).toEqual({ id: 'door2', y: 80, role: 'exit' });
    expect(result.serviceTables[1]).toEqual({ id: 'st2', x: 500, y: 120, rotation: 1 });
    expect(result.cashierStations[1]).toEqual({ id: 'cashier2', x: 600, y: 300, w: 80, h: 40 });
    expect(result.washStations[1]).toEqual({
      id: 'wash2', type: 'automatic', level: 1, x: 500, y: 260, w: 60, h: 20,
    });
  });

  it('copies amenities with fresh empty slots and resets automatic dishwashers to level one', () => {
    const state = makeState({
      restaurant: { expansionLevel: 1, funds: 2400 },
      tables: [], chairs: [], serviceTables: [], cashierStations: [], kitchenStations: [],
      washStations: [{ id: 'wash1', type: 'automatic', level: 4, x: 300, y: 120, w: 40, h: 40 }],
      staffAmenities: [{
        id: 'amenity1', type: 'couch', x: 500, y: 300, rotation: 1,
        slots: [
          { index: 0, reservedBy: 'staff-1', occupiedBy: 'staff-1' },
          { index: 1, reservedBy: null, occupiedBy: null },
        ],
      }],
      serviceItems: [],
    });

    const result = copyFixtures(state, [
      { type: 'staffAmenity', id: 'amenity1', x: 700, y: 300, rotation: 2 },
      { type: 'washStation', id: 'wash1', x: 300, y: 200 },
    ]);

    expect(result.restaurant.funds).toBe(0);
    expect(result.staffAmenities).toEqual([
      state.staffAmenities[0],
      {
        id: 'amenity2', type: 'couch', x: 700, y: 300, rotation: 2,
        slots: [
          { index: 0, reservedBy: null, occupiedBy: null },
          { index: 1, reservedBy: null, occupiedBy: null },
        ],
      },
    ]);
    expect(result.washStations[1]).toEqual({
      id: 'wash2', type: 'automatic', level: 1, x: 300, y: 200, w: 40, h: 40,
    });
  });

  it.each([
    ['insufficient funds', { restaurant: { expansionLevel: 1, funds: 299 }, tables: [{ id: 't1', seats: 2, status: 'empty', x: 200, y: 200 }], chairs: [] }, 'insufficient-funds'],
    ['stale source', { restaurant: { expansionLevel: 1, funds: 10000 }, tables: [], chairs: [] }, 'missing-fixture'],
    ['occupied destination', { restaurant: { expansionLevel: 1, funds: 10000 } }, 'overlap'],
  ])('returns the original state without mutation for %s', (_label, overrides, reason) => {
    const state = makeState(overrides);
    const before = structuredClone(state);
    const items = reason === 'missing-fixture'
      ? [{ type: 'table', id: 'gone', x: 600, y: 300 }]
      : [{ type: 'table', id: 't1', x: reason === 'overlap' ? 200 : 600, y: reason === 'overlap' ? 200 : 300 }];

    expect(copyFixtures(state, items)).toBe(state);
    expect(state).toEqual(before);
  });

  it('does not accept a caller-supplied price or copy a unique equipment station', () => {
    const state = makeState({
      kitchenStations: [{ id: 'k1', equipmentId: 'oven', x: 100, y: 120 }],
    });

    expect(copyFixtures(state, [
      { type: 'table', id: 't1', x: 600, y: 300, price: 0 },
      { type: 'kitchenStation', id: 'k1', x: 500, y: 120 },
    ])).toBe(state);
  });

  it('rejects a source with an invalid rotatable fixture state', () => {
    const state = makeState({
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 4 }],
    });

    expect(copyFixtures(state, [{ type: 'table', id: 't1', x: 600, y: 300 }])).toBe(state);
  });

  it('rejects a cashier copy whose committed dimensions overlap an existing station', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      serviceTables: [],
      washStations: [],
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
      cashierStations: [{ id: 'cashier1', x: 590, y: 300, w: 100, h: 60 }],
    });

    expect(copyFixtures(state, [
      { type: 'cashierTable', id: 'cashier1', x: 500, y: 300 },
    ])).toBe(state);
  });

  it('leaves state unchanged for a copied door submitted away from its wall', () => {
    const state = makeState({
      tables: [],
      chairs: [],
      serviceTables: [],
      cashierStations: [],
      washStations: [],
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    });
    const before = structuredClone(state);

    expect(copyFixtures(state, [{ type: 'door', id: 'door1', x: 100, y: 80 }])).toBe(state);
    expect(state).toEqual(before);
  });
});
